import type { Db } from '@memex/db';
import type { Kernel } from '@memex/kernel';
import { createBotClient, type TelegramBotClient } from './bot-client';
import { createOnboardingService, type OnboardingService } from './onboarding';

export * from './bot-client';
export * from './onboarding';

export interface TelegramServices {
  bot: TelegramBotClient;
  onboarding: OnboardingService;
  /** Set on first webhook call so the onboarding can de-suffix /start@botname. */
  ensureBotIdentity(): Promise<{ id: number; username: string }>;
}

export interface BuildTelegramServicesDeps {
  db: Db;
  kernel: Kernel;
  /** From config.telegramBotToken. Module is no-op if absent. */
  botToken: string;
  baseUrl: string;
}

export function buildTelegramServices(deps: BuildTelegramServicesDeps): TelegramServices {
  const { db, kernel, botToken, baseUrl } = deps;
  const bot = createBotClient({ token: botToken });

  let identityPromise: Promise<{ id: number; username: string }> | null = null;
  let cachedUsername: string | null = null;

  // Build the onboarding lazily so botUsername is fresh
  let onboardingInstance: OnboardingService | null = null;
  function getOnboarding(): OnboardingService {
    if (onboardingInstance) return onboardingInstance;
    onboardingInstance = createOnboardingService({
      db,
      bot,
      kernel,
      baseUrl,
      botUsername: cachedUsername ?? '',
    });
    return onboardingInstance;
  }

  return {
    bot,
    get onboarding() {
      return getOnboarding();
    },
    async ensureBotIdentity() {
      if (identityPromise) return identityPromise;
      identityPromise = (async () => {
        const me = await bot.getMe();
        cachedUsername = me.username;
        // Force rebuild of onboarding now that we know the username
        onboardingInstance = createOnboardingService({
          db,
          bot,
          kernel,
          baseUrl,
          botUsername: me.username,
        });
        return { id: me.id, username: me.username };
      })();
      return identityPromise;
    },
  };
}
