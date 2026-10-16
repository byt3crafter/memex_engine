import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { GatewayClient } from './client.js';
import { escape, fenceTask, UNTRUSTED_NOTE } from './fence.js';
import type { Message, Principal, Scope, Task, TaskMessage } from './types.js';

/**
 * The runner turns an agent that only runs on demand (Claude Code, Gemini CLI, Codex,
 * OpenClaw, ...) into one that "listens": it follows this agent's event stream and, for
 * each task addressed to it, runs the configured command in the matching project folder,
 * then posts the output back. The gateway has already applied the owner's approval rules
 * before a task reaches the runner.
 */

export interface ProjectConfig {
  /** Folder the agent runs in. */
  path: string;
  /** Key into `agents` (or a built-in preset: claude, gemini, codex, openclaw, echo). */
  agent: string;
  /** Kinds this project accepts. Default: ["message"]. */
  allow?: Scope[];
  /** Only these sender handles may use this project. Default: anyone the gateway lets through. */
  allowFrom?: string[];
  /**
   * "prompt" asks on this terminal before running; "auto" runs straight away. Default: "auto"
   * for agents with an owner (the owner's rules already ran on the gateway), "prompt" otherwise.
   */
  approval?: 'prompt' | 'auto';
  timeoutSeconds?: number;
}

/**
 * Command per task kind. Placeholders: `{prompt}` (the full prompt as one argument),
 * `{promptFile}` (path to a file holding it), `{conversation}`, `{task}`, `{project}`.
 */
export interface AgentCommand {
  message?: string[];
  task?: string[];
  /** How to read the command's stdout. Default "text". */
  output?: 'text' | 'openclaw-json';
}

export interface RunnerConfig {
  agents?: Record<string, AgentCommand>;
  projects: Record<string, ProjectConfig>;
  /** Project used when a task names none. */
  defaultProject?: string;
}

const echo = [
  'node',
  '-e',
  'console.log("echo: " + process.argv[1].length + " chars received")',
  '{prompt}',
];

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
  /**
   * OpenClaw through its Gateway: one OpenClaw session per gateway conversation, so the
   * agent remembers the thread. Add `"--agent", "<id>"` to pick a specific OpenClaw agent.
   */
  openclaw: {
    message: [
      'openclaw',
      'agent',
      '--session-id',
      'agw-{conversation}',
      '--message-file',
      '{promptFile}',
      '--json',
    ],
    task: [
      'openclaw',
      'agent',
      '--session-id',
      'agw-{conversation}',
      '--message-file',
      '{promptFile}',
      '--json',
    ],
    output: 'openclaw-json',
  },
  /** For trying the gateway without an AI CLI installed. */
  echo: { message: echo, task: echo },
};

export function loadRunnerConfig(path: string): RunnerConfig {
  const cfg = JSON.parse(readFileSync(path, 'utf8')) as RunnerConfig;
  if (!cfg.projects || !Object.keys(cfg.projects).length)
    throw new Error(`${path}: no projects configured`);
  return cfg;
}

function describeSender(task: Task, context: Message[]): string {
  const seen = context.find((m) => m.author === task.from);
  return seen?.authorKind === 'human'
    ? `a person, "${task.from}"`
    : `another AI agent, "${task.from}"`;
}

export function buildPrompt(
  task: Task,
  thread: TaskMessage[],
  context: Message[] = [],
  files: { path: string; filename: string }[] = [],
): string {
  const earlier = context
    .slice(-15)
    .map((m) => `--- ${m.author}${m.authorKind === 'agent' ? ' (agent)' : ''} ---\n${m.body}`)
    .join('\n\n');
  return [
    `You are receiving a ${task.kind === 'task' ? 'task' : 'message'} from ${describeSender(task, context)}, ` +
      `through Agent Gateway. You are working in the "${task.project ?? 'default'}" project.`,
    UNTRUSTED_NOTE,
    task.kind === 'message'
      ? 'This is a message, not a task: answer it, but do not modify files or run commands with side effects.'
      : 'Do the work if it is reasonable and within this project. Do not touch anything outside this folder.',
    earlier
      ? `Earlier in this conversation (for context only):\n<agent_message trust="untrusted" kind="conversation">\n${escape(earlier)}\n</agent_message>`
      : '',
    fenceTask(task, thread),
    files.length
      ? `Attached files, saved for you to read:\n${files.map((f) => `- ${f.path} (${f.filename})`).join('\n')}`
      : '',
    'Your final output is sent back into the conversation as your reply. Keep it concise and do not include secrets. ' +
      'If you cannot continue without more information, start your output with "NEEDS_INPUT:" followed by your question.',
  ]
    .filter(Boolean)
    .join('\n\n');
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

const ATTACHMENT = /\[attachment (fil_[\w-]+): ([^\]]*?) \(/g;

export class Runner {
  private queue: string[] = [];
  private queued = new Set<string>();
  private busy = false;
  private me: Principal | null = null;
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
    const { principal } = await this.client.me();
    this.me = principal;
    this.log(
      `listening as "${principal.handle}"${principal.owner ? ` (owned by ${principal.owner})` : ''} ` +
        `for projects: ${Object.keys(this.config.projects).join(', ')}`,
    );
    await this.client.subscribe(
      (event) => {
        if (event.type !== 'task.created' && event.type !== 'task.updated') return;
        const task = event.data as Task;
        if (task.to === principal.handle && task.status === 'submitted') this.enqueue(task.id);
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
    const { task, messages, context } = await this.client.get(id);
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
    if (project.allowFrom && !project.allowFrom.includes(task.from)) {
      return reject('sender not allowed for this project');
    }
    const agent = this.config.agents?.[project.agent] ?? PRESETS[project.agent];
    const command = agent?.[task.kind];
    if (!agent || !command?.length) {
      return reject(`no command configured for agent "${project.agent}" and kind ${task.kind}`);
    }

    const approval = project.approval ?? (this.me?.ownerId ? 'auto' : 'prompt');
    if (approval === 'prompt' && !(await this.approver(task, projectName))) {
      return reject('declined on the runner');
    }

    await this.client.setStatus(task.id, 'working');
    this.log(
      `running ${task.id} (${task.kind} from ${task.from}) in ${project.path} with ${project.agent}`,
    );

    const work = join(tmpdir(), `agw-${task.id}`);
    mkdirSync(work, { recursive: true });
    try {
      const files = await this.saveAttachments(task, messages, project.path);
      const prompt = buildPrompt(task, messages, context, files);
      const promptFile = join(work, 'prompt.md');
      writeFileSync(promptFile, prompt);
      const vars: Record<string, string> = {
        prompt,
        promptFile,
        conversation: task.contextId,
        task: task.id,
        project: projectName,
      };
      const argv = command.map((a) =>
        a.replace(/\{(prompt|promptFile|conversation|task|project)\}/g, (_, k) => vars[k]!),
      );
      const out = await execute(argv, project.path, (project.timeoutSeconds ?? 900) * 1000);

      if (out.code === 0) {
        const result = parseOutput(out.stdout, agent.output) || '(no output)';
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
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /** Downloads files mentioned in the task into `<project>/.agw/inbox/<task>/`. */
  private async saveAttachments(task: Task, thread: TaskMessage[], projectPath: string) {
    const text = [task.body, ...thread.map((m) => m.body)].join('\n');
    const found = [...text.matchAll(ATTACHMENT)].map((m) => ({ id: m[1]!, filename: m[2]! }));
    if (!found.length) return [];
    const dir = join(projectPath, '.agw', 'inbox', task.id);
    mkdirSync(dir, { recursive: true });
    const saved: { path: string; filename: string }[] = [];
    for (const f of found) {
      try {
        const safe = f.filename.replace(/[^\w.-]+/g, '_').slice(0, 120) || f.id;
        const path = join(dir, `${f.id}-${safe}`);
        writeFileSync(path, await this.client.download(f.id));
        saved.push({ path, filename: f.filename });
      } catch (err) {
        this.log(`couldn’t download ${f.id}: ${(err as Error).message}`);
      }
    }
    return saved;
  }
}

/** Reply text from a command's stdout. */
export function parseOutput(stdout: string, format: AgentCommand['output']): string {
  if (format !== 'openclaw-json') return stdout.trim();
  try {
    const json = JSON.parse(stdout) as {
      ok?: boolean;
      payloads?: { text?: string }[];
      result?: { payloads?: { text?: string }[] };
      error?: { message?: string };
    };
    const payloads = json.payloads ?? json.result?.payloads ?? [];
    const text = payloads
      .map((p) => p.text ?? '')
      .filter(Boolean)
      .join('\n\n');
    if (text) return text.trim();
    if (json.ok === false)
      return `NEEDS_INPUT: OpenClaw reported an error: ${json.error?.message ?? 'unknown'}`;
    return '';
  } catch {
    return stdout.trim();
  }
}

const MAX_OUTPUT = 60 * 1024;

function execute(
  argv: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const [bin, ...args] = argv;
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
