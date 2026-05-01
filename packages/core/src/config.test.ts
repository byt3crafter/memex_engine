import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('parses a complete env', () => {
    const cfg = loadConfig({
      HEALTHLOOP_PORT: '9090',
      HEALTHLOOP_DATABASE_URL: 'file:./data/test.db',
      HEALTHLOOP_API_TOKEN: 'this-is-a-long-enough-token-x',
      HEALTHLOOP_BASE_URL: 'http://localhost:9090',
      HEALTHLOOP_DEFAULT_TIMEZONE: 'Indian/Mauritius',
      HEALTHLOOP_LOG_LEVEL: 'debug',
      NODE_ENV: 'test',
    });
    expect(cfg.port).toBe(9090);
    expect(cfg.databaseUrl).toBe('file:./data/test.db');
    expect(cfg.defaultTimezone).toBe('Indian/Mauritius');
    expect(cfg.logLevel).toBe('debug');
    expect(cfg.nodeEnv).toBe('test');
  });

  it('falls back to defaults', () => {
    const cfg = loadConfig({ HEALTHLOOP_API_TOKEN: 'this-is-a-long-enough-token-x' });
    expect(cfg.port).toBe(8787);
    expect(cfg.baseUrl).toBe('http://localhost:8787');
    expect(cfg.defaultTimezone).toBe('UTC');
    expect(cfg.logLevel).toBe('info');
  });

  it('rejects a short api token', () => {
    expect(() => loadConfig({ HEALTHLOOP_API_TOKEN: 'too-short' })).toThrow();
  });

  it('rejects a non-numeric port', () => {
    expect(() =>
      loadConfig({
        HEALTHLOOP_API_TOKEN: 'this-is-a-long-enough-token-x',
        HEALTHLOOP_PORT: 'abc',
      }),
    ).toThrow();
  });

  it('overrides win over env', () => {
    const cfg = loadConfig(
      { HEALTHLOOP_API_TOKEN: 'this-is-a-long-enough-token-x' },
      { databaseUrl: 'file::memory:' },
    );
    expect(cfg.databaseUrl).toBe('file::memory:');
  });
});
