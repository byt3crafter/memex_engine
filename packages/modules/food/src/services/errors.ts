export class PantryItemNotFoundError extends Error {
  readonly code = 'pantry_item_not_found' as const;
  constructor(public readonly id: string) {
    super(`pantry item ${id} not found`);
  }
}

export class FoodEventNotFoundError extends Error {
  readonly code = 'food_event_not_found' as const;
  constructor(public readonly id: string) {
    super(`food event ${id} not found`);
  }
}

export class RecipeNotFoundError extends Error {
  readonly code = 'recipe_not_found' as const;
  constructor(public readonly id: string) {
    super(`recipe ${id} not found`);
  }
}

export class MenuPlanNotFoundError extends Error {
  readonly code = 'menu_plan_not_found' as const;
  constructor(public readonly id: string) {
    super(`menu plan ${id} not found`);
  }
}

export class RecommendationNotFoundError extends Error {
  readonly code = 'recommendation_not_found' as const;
  constructor(public readonly id: string) {
    super(`recommendation ${id} not found`);
  }
}

export class InvalidRecommendationOptionError extends Error {
  readonly code = 'invalid_option_index' as const;
  constructor(
    public readonly recommendationId: string,
    public readonly optionIndex: number,
  ) {
    super(`recommendation ${recommendationId} has no option at index ${optionIndex}`);
  }
}
