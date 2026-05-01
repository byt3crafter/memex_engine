/**
 * Card builders. Phase 4 expands these with full payload mapping for
 * every card type. For now, only the version constant is re-exported so
 * services can stamp the right `cardSchemaVersion` on placeholder
 * payloads.
 */
export { CARD_SCHEMA_VERSION } from '@pantrymind/schemas';
export type {
  Card,
  CardAction,
  FoodEventCard,
  InsightCard,
  MealRecommendationCard,
  MenuCard,
  RecipeCard,
  WeeklyReviewCard,
} from '@pantrymind/schemas';
