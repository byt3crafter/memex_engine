/**
 * Runtime card schema registry. Modules contribute their own card
 * payload schemas via this registry instead of every card type living
 * inside @memex/schemas as a closed discriminated union.
 *
 * The registry is consulted by:
 *   - REST and MCP responses, to validate before returning
 *   - Future @memex/cards-web Lit renderers, to pick the right
 *     custom element by `type`
 *
 * Card schemas are versioned via cardSchemaVersion in @memex/schemas.
 */
import { baseCardSchema, CARD_SCHEMA_VERSION } from '@memex/schemas';
import type { ZodTypeAny } from 'zod';

export interface CardSchemaContribution {
  /** Discriminator value; e.g., 'meal_recommendation', 'sleep_score'. */
  type: string;
  /** Module id this card belongs to ('food', 'sleep', ...). */
  module: string;
  /** Zod schema for the card payload. Should extend baseCardSchema. */
  schema: ZodTypeAny;
}

export class CardSchemaRegistry {
  private byType = new Map<string, CardSchemaContribution>();

  register(card: CardSchemaContribution): void {
    if (this.byType.has(card.type)) {
      throw new Error(`card type already registered: ${card.type}`);
    }
    this.byType.set(card.type, card);
  }

  get(type: string): CardSchemaContribution | undefined {
    return this.byType.get(type);
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  list(): CardSchemaContribution[] {
    return [...this.byType.values()];
  }
}

export { CARD_SCHEMA_VERSION, baseCardSchema };
