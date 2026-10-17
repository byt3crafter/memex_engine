import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Installs the opennodd skill (Agent Skills format: SKILL.md + references) where each
 * agent looks for skills. Paths as documented by each tool in 2026.
 */

export const SKILL_NAME = 'opennodd';
export const SKILL_DIR = fileURLToPath(
  new URL(`../integrations/skills/${SKILL_NAME}/`, import.meta.url),
);

export interface SkillTarget {
  agent: string;
  label: string;
  /** Folder (under home) whose presence means the agent is installed. */
  detect: string;
  /** Personal skills folder, relative to home. */
  user: string;
  /** Project skills folder, relative to the repo / workspace. */
  project: string;
}

export const SKILL_TARGETS: SkillTarget[] = [
  {
    agent: 'claude',
    label: 'Claude Code',
    detect: '.claude',
    user: '.claude/skills',
    project: '.claude/skills',
  },
  // Codex, OpenClaw and Gemini CLI also read the vendor-neutral .agents/skills.
  {
    agent: 'codex',
    label: 'Codex',
    detect: '.codex',
    user: '.agents/skills',
    project: '.agents/skills',
  },
  {
    agent: 'openclaw',
    label: 'OpenClaw',
    detect: '.openclaw',
    user: '.agents/skills',
    project: '.agents/skills',
  },
  {
    agent: 'gemini',
    label: 'Gemini CLI',
    detect: '.gemini',
    user: '.gemini/skills',
    project: '.gemini/skills',
  },
  {
    agent: 'antigravity',
    label: 'Antigravity',
    detect: '.gemini/antigravity',
    user: '.gemini/antigravity/skills',
    project: '.agent/skills',
  },
  {
    agent: 'cursor',
    label: 'Cursor',
    detect: '.cursor',
    user: '.cursor/skills',
    project: '.cursor/skills',
  },
  {
    agent: 'copilot',
    label: 'GitHub Copilot',
    detect: '.copilot',
    user: '.copilot/skills',
    project: '.github/skills',
  },
];

export interface InstallResult {
  agent: string;
  label: string;
  path: string;
}

/**
 * Copies the skill for the given agents (default: every agent found under `home`, plus the
 * shared ~/.agents/skills). With `project`, installs into that folder instead of `home`.
 */
export function installSkill(
  opts: { agents?: string[]; project?: string; home?: string } = {},
): InstallResult[] {
  const home = opts.home ?? homedir();
  const wanted = opts.agents?.length && !opts.agents.includes('all') ? opts.agents : null;
  for (const a of wanted ?? []) {
    if (!SKILL_TARGETS.some((t) => t.agent === a)) {
      throw new Error(
        `unknown agent "${a}"; choose from ${SKILL_TARGETS.map((t) => t.agent).join(', ')}, all`,
      );
    }
  }
  const targets = wanted
    ? SKILL_TARGETS.filter((t) => wanted.includes(t.agent))
    : SKILL_TARGETS.filter(
        (t) => opts.project || existsSync(join(home, t.detect)) || t.user === '.agents/skills',
      );

  const done = new Map<string, InstallResult>();
  for (const t of targets) {
    const base = opts.project ?? home;
    const dir = join(base, opts.project ? t.project : t.user, SKILL_NAME);
    if (done.has(dir)) continue;
    mkdirSync(dir, { recursive: true });
    cpSync(SKILL_DIR, dir, { recursive: true });
    done.set(dir, { agent: t.agent, label: t.label, path: dir });
  }
  return [...done.values()];
}

/** Files of the skill, relative to its folder (for serving it over HTTP). */
export function skillFiles(dir = SKILL_DIR): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}
