import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installSkill, SKILL_DIR, skillFiles } from '../src/skills.js';
import { startGateway, stopAll } from './helpers.js';
import type { TestGateway } from './helpers.js';

const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const front = Object.fromEntries(
  /^---\n([\s\S]*?)\n---\n/
    .exec(skill)![1]!
    .split('\n')
    .filter((l) => /^[a-z-]+:/.test(l))
    .map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]),
);

describe('agent-gateway skill', () => {
  it('follows the Agent Skills spec', () => {
    expect(front.name).toBe('agent-gateway');
    expect(front.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(front.description!.length).toBeGreaterThan(50);
    expect(front.description!.length).toBeLessThanOrEqual(1024);
    expect(front.compatibility!.length).toBeLessThanOrEqual(500);
    expect(skill.split('\n').length).toBeLessThan(500);
    // Every file the skill links to exists.
    for (const [, link] of skill.matchAll(/\]\((references\/[^)]+)\)/g)) {
      expect(existsSync(join(SKILL_DIR, link!))).toBe(true);
    }
  });

  it('installs into every agent found, sharing ~/.agents/skills', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    for (const d of ['.claude', '.codex', '.openclaw', '.gemini/antigravity'])
      mkdirSync(join(home, d), { recursive: true });
    const results = installSkill({ home });
    const paths = results.map((r) => r.path.slice(home.length + 1));
    expect(paths).toEqual([
      '.claude/skills/agent-gateway',
      '.agents/skills/agent-gateway',
      '.gemini/skills/agent-gateway',
      '.gemini/antigravity/skills/agent-gateway',
    ]);
    for (const p of paths) {
      expect(readFileSync(join(home, p, 'SKILL.md'), 'utf8')).toBe(skill);
      expect(existsSync(join(home, p, 'references', 'setup.md'))).toBe(true);
    }
  });

  it('installs for named agents, or into a project', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    expect(
      installSkill({ home, agents: ['copilot'] }).map((r) => r.path.slice(home.length + 1)),
    ).toEqual(['.copilot/skills/agent-gateway']);
    const repo = mkdtempSync(join(tmpdir(), 'repo-'));
    const inRepo = installSkill({ project: repo, agents: ['claude', 'antigravity', 'copilot'] });
    expect(inRepo.map((r) => r.path.slice(repo.length + 1))).toEqual([
      '.claude/skills/agent-gateway',
      '.agent/skills/agent-gateway',
      '.github/skills/agent-gateway',
    ]);
    expect(() => installSkill({ home, agents: ['nope'] })).toThrow(/unknown agent/);
  });
});

describe('skill over HTTP', () => {
  let gw: TestGateway;
  beforeAll(async () => {
    gw = await startGateway();
  });
  afterAll(stopAll);

  it('serves the skill files so any agent can read them', async () => {
    expect(skillFiles()).toEqual(['SKILL.md', 'references/commands.md', 'references/setup.md']);
    const res = await fetch(`${gw.url}/skills/agent-gateway/SKILL.md`);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(await res.text()).toBe(skill);
    expect((await fetch(`${gw.url}/skills/agent-gateway/references/setup.md`)).status).toBe(200);
    expect((await fetch(`${gw.url}/skills/agent-gateway/../package.json`)).status).toBe(404);
  });
});
