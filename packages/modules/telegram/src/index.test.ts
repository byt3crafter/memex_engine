import { describe, expect, it } from 'vitest';
import { defineTelegramModule } from './index';

describe('module-telegram (Iris)', () => {
  it('manifest exposes the expected metadata', () => {
    const m = defineTelegramModule({
      botToken: '0000000000:fake-test-token-not-real-32',
      webhookSecret: 'test-secret-at-least-16-chars',
    });
    expect(m.manifest.id).toBe('telegram');
    expect(m.manifest.codename).toBe('Iris');
    expect(m.manifest.routePrefix).toBe('telegram');
    expect(m.manifest.icon).toBeDefined();
    expect(m.manifest.tagline).toBeDefined();
    expect((m.manifest.features ?? []).length).toBeGreaterThan(0);
  });

  it('contributes a webhook router but no /api/v1 routes', () => {
    const m = defineTelegramModule({
      botToken: '0000000000:fake-test-token-not-real-32',
      webhookSecret: 'test-secret-at-least-16-chars',
    });
    expect(m.buildWebhookRoutes).toBeTypeOf('function');
    expect(m.buildRoutes).toBeUndefined();
  });
});
