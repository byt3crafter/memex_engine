import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import type { GatewayClient } from './client.js';
import { fenceTask, UNTRUSTED_NOTE } from './fence.js';
import type { Scope, Task } from './types.js';

/**
 * The runner turns an agent CLI that only runs on demand into one that "listens": it follows
 * this agent's event stream and, for each task addressed to it, starts the configured CLI
 * headless in the matching project folder, then posts the output back as the task result.
 */

export interface ProjectConfig {
  /** Folder the agent runs in. */
  path: string;
  /** Key into `agents` (or a built-in preset: claude, gemini, codex, echo). */
  agent: string;
  /** Kinds this project accepts. Default: ["message"]. */
  allow?: Scope[];
  /** Only these sender handles may use this project. Default: anyone with a channel. */
  allowFrom?: string[];
  /** "prompt" asks on this terminal before running; "auto" runs straight away. Default: "prompt". */
  approval?: 'prompt' | 'auto';
  timeoutSeconds?: number;
}

/** Command per task kind; `{prompt}` is replaced with the full prompt as a single argument. */
export type AgentCommand = Partial<Record<Scope, string[]>>;

export interface RunnerConfig {
  agents?: Record<string, AgentCommand>;
  projects: Record<string, ProjectConfig>;
  /** Project used when a task names none. */
  defaultProject?: string;
}

/**
 * Starting points. Messages run read-only; tasks get each CLI's "may edit files in this folder"
 * mode but nothing broader. Override any of these in runner.json.
 */
export const PRESETS: Record<string, AgentCommand> = {
  claude: {
    // In -p mode, tools that need approval are refused, so this can read but not edit or run commands.
    message: ['claude', '-p', '{prompt}'],
    task: ['claude', '-p', '{prompt}', '--permission-mode', 'acceptEdits'],
  },
  gemini: {
    message: ['gemini', '-p', '{prompt}'],
    task: ['gemini', '-p', '{prompt}', '--approval-mode', 'auto_edit'],
  },
  codex: {
    message: ['codex', 'exec', '--sandbox', 'read-only', '{prompt}'],
    task: ['codex', 'exec', '--sandbox', 'workspace-write', '{prompt}'],
  },
  /** For trying the gateway without an AI CLI installed. */
  echo: {
    message: [
      'node',
      '-e',
      'console.log("echo: " + process.argv[1].length + " chars received")',
      '{prompt}',
    ],
    task: [
      'node',
      '-e',
      'console.log("echo: " + process.argv[1].length + " chars received")',
      '{prompt}',
    ],
  },
};

export function loadRunnerConfig(path: string): RunnerConfig {
  const cfg = JSON.parse(readFileSync(path, 'utf8')) as RunnerConfig;
  if (!cfg.projects || !Object.keys(cfg.projects).length)
    throw new Error(`${path}: no projects configured`);
  return cfg;
}

export function buildPrompt(task: Task, thread: Parameters<typeof fenceTask>[1]): string {
  return [
    `You are receiving a ${task.kind === 'task' ? 'task' : 'message'} from another AI agent, "${task.from}", ` +
      `through Agent Gateway. You are working in the "${task.project ?? 'default'}" project.`,
    UNTRUSTED_NOTE,
    task.kind === 'message'
      ? 'This is a message, not a task: answer it, but do not modify files or run commands with side effects.'
      : 'Do the work if it is reasonable and within this project. Do not touch anything outside this folder.',
    fenceTask(task, thread),
    'Your final output is sent back to the other agent as the result. Keep it concise and do not include secrets. ' +
      'If you cannot continue without more information from the sender, start your output with "NEEDS_INPUT:" followed by your question.',
  ].join('\n\n');
}

export type Approver = (task: Task, project: string) => Promise<boolean>;

/** Approve on the controlling terminal. Without a terminal, nothing is approved. */
export const terminalApprover: Approver = async (task, project) => {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\n[agw] ${task.kind} from ${task.from} for project "${project}":`);
    console.log(indent(`${task.title ? task.title + '\n' : ''}${task.body}`.slice(0, 2000)));
    const answer = await rl.question('[agw] Run it? [y/N] ');
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
};

const indent = (s: string) => s.replace(/^/gm, '    ');

export interface RunnerOptions {
  approver?: Approver;
  log?: (msg: string) => void;
  signal?: AbortSignal;
}

export class Runner {
  private queue: string[] = [];
  private queued = new Set<string>();
  private busy = false;
  private readonly log: (msg: string) => void;
  private readonly approver: Approver;

  constructor(
    private readonly client: GatewayClient,
    private readonly config: RunnerConfig,
    private readonly opts: RunnerOptions = {},
  ) {
    this.log = opts.log ?? ((m) => console.log(`[agw] ${m}`));
    this.approver = opts.approver ?? terminalApprover;
  }

  async start(): Promise<void> {
    const { agent } = await this.client.me();
    this.log(
      `listening as "${agent.handle}" for projects: ${Object.keys(this.config.projects).join(', ')}`,
    );
    await this.client.subscribe(
      (event) => {
        if (event.type !== 'task.created' && event.type !== 'task.updated') return;
        const task = event.data as Task;
        if (task.to === agent.handle && task.status === 'submitted') this.enqueue(task.id);
      },
      {
        ...(this.opts.signal ? { signal: this.opts.signal } : {}),
        // On every (re)connect, pick up anything that arrived while we were away.
        onConnect: async () => {
          const { tasks } = await this.client.list('inbox', ['submitted'], 200);
          for (const t of tasks.reverse()) this.enqueue(t.id);
        },
        onError: (err) => this.log(`stream error: ${(err as Error).message}; reconnecting`),
      },
    );
  }

  private enqueue(id: string): void {
    if (this.queued.has(id)) return;
    this.queued.add(id);
    this.queue.push(id);
    void this.drain();
  }

  /** One task at a time: agents working in the same folder shouldn't race each other. */
  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      let id: string | undefined;
      while ((id = this.queue.shift())) {
        try {
          await this.handle(id);
        } catch (err) {
          this.log(`task ${id}: ${(err as Error).message}`);
        } finally {
          this.queued.delete(id);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  async handle(id: string): Promise<void> {
    const { task, messages } = await this.client.get(id);
    if (task.status !== 'submitted') return;

    const projectName = task.project ?? this.config.defaultProject;
    const project = projectName ? this.config.projects[projectName] : undefined;
    const reject = async (why: string) => {
      this.log(`rejected ${task.id} from ${task.from}: ${why}`);
      await this.client.setStatus(task.id, 'rejected', why);
    };
    if (!projectName || !project) return reject(`unknown project "${task.project ?? ''}"`);
    if (!(project.allow ?? ['message']).includes(task.kind))
      return reject(`project does not accept ${task.kind}s`);
    if (project.allowFrom && !project.allowFrom.includes(task.from))
      return reject('sender not allowed for this project');
    const command = (this.config.agents?.[project.agent] ?? PRESETS[project.agent])?.[task.kind];
    if (!command?.length)
      return reject(`no command configured for agent "${project.agent}" and kind ${task.kind}`);

    if ((project.approval ?? 'prompt') === 'prompt' && !(await this.approver(task, projectName))) {
      return reject('declined by owner');
    }

    await this.client.setStatus(task.id, 'working');
    this.log(
      `running ${task.id} (${task.kind} from ${task.from}) in ${project.path} with ${project.agent}`,
    );
    const prompt = buildPrompt(task, messages);
    const out = await execute(
      command,
      prompt,
      project.path,
      (project.timeoutSeconds ?? 900) * 1000,
    );

    if (out.code === 0) {
      const result = out.stdout.trim() || '(no output)';
      if (result.startsWith('NEEDS_INPUT:')) {
        await this.client.setStatus(
          task.id,
          'input_required',
          result.slice('NEEDS_INPUT:'.length).trim(),
        );
        this.log(`${task.id} needs input from ${task.from}`);
      } else {
        await this.client.setStatus(task.id, 'completed', result);
        this.log(`${task.id} completed`);
      }
    } else {
      const why = out.timedOut ? 'timed out' : `exit code ${out.code}`;
      await this.client.setStatus(task.id, 'failed', `${why}\n${out.stderr.slice(-4000)}`.trim());
      this.log(`${task.id} failed: ${why}`);
    }
  }
}

const MAX_OUTPUT = 60 * 1024;

function execute(
  command: string[],
  prompt: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const [bin, ...args] = command.map((a) => (a === '{prompt}' ? prompt : a));
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(bin!, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const cap = (cur: string, chunk: Buffer) =>
      cur.length < MAX_OUTPUT ? cur + chunk.toString() : cur;
    child.stdout.on('data', (c: Buffer) => (stdout = cap(stdout, c)));
    child.stderr.on('data', (c: Buffer) => (stderr = cap(stderr, c)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.slice(0, MAX_OUTPUT), stderr, timedOut });
    });
  });
}
