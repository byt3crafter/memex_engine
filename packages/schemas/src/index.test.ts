import { describe, expect, it } from 'vitest';
import {
  CARD_SCHEMA_VERSION,
  baseCardSchema,
  connectionSchema,
  createUserSchema,
  moduleManifestSchema,
  pairStartInputSchema,
  pairStartResultSchema,
  userSchema,
} from './index.js';

describe('memex kernel schemas', () => {
  it('user requires displayName and timezone', () => {
    const valid = createUserSchema.safeParse({
      displayName: 'Dovik',
      timezone: 'Indian/Mauritius',
    });
    const invalid = createUserSchema.safeParse({ displayName: '', timezone: '' });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it('user role defaults to member', () => {
    const parsed = createUserSchema.parse({ displayName: 'X', timezone: 'UTC' });
    expect(parsed.role).toBe('member');
  });

  it('connection scopes match the kebab regex', () => {
    const ok = connectionSchema.shape.scopes.safeParse(['food:read', 'food:write']);
    const bad = connectionSchema.shape.scopes.safeParse(['Food:Write']);
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });

  it('pair-start has a 10-minute default expiry', () => {
    const parsed = pairStartInputSchema.parse({ clientName: 'Claude Desktop' });
    expect(parsed.clientKind).toBe('mcp_stdio');
    expect(parsed.expiresInSeconds).toBe(600);
  });

  it('pair-start result requires a qrPayload and config snippets map', () => {
    const result = pairStartResultSchema.parse({
      pairingCode: 'ABCD-1234',
      qrPayload: 'memex://pair?code=ABCD-1234&host=https%3A%2F%2Flocalhost%3A8787',
      configSnippets: {
        claude_desktop: '{"mcpServers": {"memex": {"command": "node", "args": ["..."]}}}',
        rest_curl: 'curl -H "Authorization: Bearer ..." ...',
      },
      expiresAt: '2026-05-01T12:10:00.000Z',
      baseUrl: 'http://localhost:8787',
    });
    expect(Object.keys(result.configSnippets)).toContain('claude_desktop');
  });

  it('module manifest enforces id kebab-case', () => {
    const ok = moduleManifestSchema.safeParse({
      id: 'food',
      codename: 'Demeter',
      version: '0.1.0',
      description: 'Pantry, meals, recipes, menus, recommendations.',
      domain: 'food',
      dependsOn: [],
      scopes: ['food:read', 'food:write'],
    });
    const bad = moduleManifestSchema.safeParse({
      id: 'Food Module',
      codename: 'Demeter',
      version: '0.1.0',
      description: 'x',
      domain: 'food',
    });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });

  it('cards must include the module + version discriminator', () => {
    const ok = baseCardSchema.safeParse({
      cardSchemaVersion: CARD_SCHEMA_VERSION,
      type: 'meal_recommendation',
      module: 'food',
      actions: [],
    });
    const missing = baseCardSchema.safeParse({
      cardSchemaVersion: CARD_SCHEMA_VERSION,
      type: 'meal_recommendation',
      actions: [],
    });
    expect(ok.success).toBe(true);
    expect(missing.success).toBe(false);
  });

  it('user schema round-trips a full row', () => {
    const result = userSchema.parse({
      id: 'usr_abc',
      email: 'dovik@example.com',
      displayName: 'Dovik',
      timezone: 'Indian/Mauritius',
      role: 'founder',
      isActive: true,
      preferences: { unitSystem: 'metric' },
      enabledModules: ['food'],
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(result.role).toBe('founder');
    expect(result.enabledModules).toEqual(['food']);
  });
});
