/**
 * Pure recommendation engine v1 — deterministic, no LLM, no I/O.
 *
 * Inputs: pantry snapshot, saved recipes, recent food-event history with
 * outcomes, optional craving / preferred protein.
 *
 * Output: 1..maxOptions ranked candidate meals with reasoning. Every
 * option carries the score that produced its rank so future engine
 * versions can be A/B-replayed against the same inputs.
 */
import type {
  CreateFoodEventItem,
  FoodEvent,
  FoodEventItem,
  MealOutcome,
  PantryItem,
  Recipe,
  RecipeIngredient,
} from '../../schemas/index';
import { normalizeName } from '@memex/kernel';

export interface RecentFoodEventForRec {
  event: FoodEvent;
  items: FoodEventItem[];
  outcome: MealOutcome | null;
}

export interface RecommendationContext {
  cravingText: string | null;
  preferredProtein: string | null;
  goalContext: Record<string, unknown> | null;
  pantry: PantryItem[];
  recipes: Recipe[];
  recentEvents: RecentFoodEventForRec[];
  maxOptions: number;
  now: Date;
}

export interface ScoredOption {
  title: string;
  reason: string;
  proteinSource: string | null;
  ingredientsUsed: string[];
  ingredientsMissing: string[];
  prepTimeMinutes: number | null;
  caloriesEstimated: number | null;
  proteinGEstimated: number | null;
  carbsGEstimated: number | null;
  fatGEstimated: number | null;
  confidence: number;
  recipeId: string | null;
  items: CreateFoodEventItem[];
  score: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface PantryIndex {
  byNorm: Map<string, PantryItem>;
  byCategory: Map<string, PantryItem[]>;
}

function indexPantry(pantry: PantryItem[]): PantryIndex {
  const byNorm = new Map<string, PantryItem>();
  const byCategory = new Map<string, PantryItem[]>();
  for (const item of pantry) {
    if (!item.isAvailable) continue;
    byNorm.set(item.normalizedName, item);
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  return { byNorm, byCategory };
}

function recentRecipeUsage(ctx: RecommendationContext): {
  byRecipeId: Map<string, number>;
  daysAgoByRecipe: Map<string, number>;
} {
  const byRecipeId = new Map<string, number>();
  const daysAgoByRecipe = new Map<string, number>();
  for (const ev of ctx.recentEvents) {
    if (ev.event.eventType !== 'actual_meal') continue;
    const recipeId = (ev.event.notes && parseRecipeIdFromNotes(ev.event.notes)) ?? null;
    if (!recipeId) continue;
    byRecipeId.set(recipeId, (byRecipeId.get(recipeId) ?? 0) + 1);
    const daysAgo = (ctx.now.getTime() - new Date(ev.event.occurredAt).getTime()) / DAY_MS;
    const prev = daysAgoByRecipe.get(recipeId);
    if (prev === undefined || daysAgo < prev) daysAgoByRecipe.set(recipeId, daysAgo);
  }
  return { byRecipeId, daysAgoByRecipe };
}

function parseRecipeIdFromNotes(notes: string): string | null {
  // Convention: services/recommendation persists `recipeId` in food_event.notes
  // as JSON tag {"recipeId":"rcp_..."} when an actual_meal is logged from a
  // selected recommendation. Best-effort parse only.
  const m = notes.match(/"recipeId"\s*:\s*"([^"]+)"/);
  return m ? (m[1] ?? null) : null;
}

function avgSatisfactionByRecipe(ctx: RecommendationContext): Map<string, number> {
  const sum = new Map<string, { total: number; count: number }>();
  for (const ev of ctx.recentEvents) {
    const recipeId = ev.event.notes ? parseRecipeIdFromNotes(ev.event.notes) : null;
    if (!recipeId) continue;
    const score = ev.outcome?.satisfactionScore;
    if (score == null) continue;
    const cur = sum.get(recipeId) ?? { total: 0, count: 0 };
    cur.total += score;
    cur.count += 1;
    sum.set(recipeId, cur);
  }
  const avg = new Map<string, number>();
  for (const [k, v] of sum) avg.set(k, v.total / v.count);
  return avg;
}

function ingredientStringsFromRecipe(recipe: Recipe): RecipeIngredient[] {
  return recipe.ingredients;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function scoreRecipe(recipe: Recipe, ctx: RecommendationContext, idx: PantryIndex): ScoredOption {
  const ingredients = ingredientStringsFromRecipe(recipe);
  const ingredientsUsed: string[] = [];
  const ingredientsMissing: string[] = [];
  for (const ing of ingredients) {
    if (idx.byNorm.has(normalizeName(ing.name))) {
      ingredientsUsed.push(ing.name);
    } else if (!ing.optional) {
      ingredientsMissing.push(ing.name);
    }
  }

  const total = ingredients.filter((i) => !i.optional).length || 1;
  const overlap = ingredientsUsed.length / total;
  let score = 0.4 + overlap * 0.4;

  const proteinAvailable =
    recipe.proteinSource != null && idx.byNorm.has(normalizeName(recipe.proteinSource));
  if (proteinAvailable) score += 0.1;

  if (
    ctx.preferredProtein != null &&
    recipe.proteinSource != null &&
    normalizeName(ctx.preferredProtein) === normalizeName(recipe.proteinSource)
  ) {
    score += 0.15;
  }

  const usage = recentRecipeUsage(ctx);
  const daysAgo = usage.daysAgoByRecipe.get(recipe.id);
  if (daysAgo !== undefined && daysAgo < 7) {
    score -= 0.2;
  }

  const avgs = avgSatisfactionByRecipe(ctx);
  const avg = avgs.get(recipe.id);
  if (avg !== undefined) {
    score += ((avg - 3) / 5) * 0.2;
  } else if (recipe.personalRating != null) {
    score += ((recipe.personalRating - 3) / 5) * 0.1;
  }

  if (ctx.cravingText != null) {
    const norm = normalizeName(ctx.cravingText);
    const tokens = norm.split(/\s+/).filter((t) => t.length > 2);
    const recipeText = `${recipe.title} ${recipe.tags.join(' ')}`.toLowerCase();
    if (tokens.some((t) => recipeText.includes(t))) score += 0.1;
  }

  const confidence = clamp(score);
  const reasonBits: string[] = [];
  if (ingredientsUsed.length > 0) {
    reasonBits.push(`uses your ${ingredientsUsed.join(', ')}`);
  }
  if (avg !== undefined) {
    reasonBits.push(`you rated this avg ${avg.toFixed(1)}/5`);
  } else if (recipe.personalRating != null) {
    reasonBits.push(`you rated this ${recipe.personalRating}/5`);
  }
  if (proteinAvailable && recipe.proteinSource) {
    reasonBits.push(`${recipe.proteinSource} on hand`);
  }
  if (daysAgo !== undefined && daysAgo < 7) {
    reasonBits.push(`eaten ${Math.round(daysAgo)} day(s) ago — penalty applied`);
  }
  if (ingredientsMissing.length > 0) {
    reasonBits.push(`missing ${ingredientsMissing.join(', ')}`);
  }
  const reason = reasonBits.length > 0 ? reasonBits.join('; ') : 'saved recipe';

  return {
    title: recipe.title,
    reason,
    proteinSource: recipe.proteinSource,
    ingredientsUsed,
    ingredientsMissing,
    prepTimeMinutes: null,
    caloriesEstimated: recipe.estimatedCalories,
    proteinGEstimated: recipe.estimatedProteinG,
    carbsGEstimated: recipe.estimatedCarbsG,
    fatGEstimated: recipe.estimatedFatG,
    confidence,
    recipeId: recipe.id,
    items: ingredients.map((ing) => ({
      name: ing.name,
      role: 'ingredient',
      ...(ing.quantity != null ? { quantity: ing.quantity } : {}),
      ...(ing.unit != null ? { unit: ing.unit } : {}),
    })),
    score,
  };
}

const FREESTYLE_TEMPLATES: { protein: boolean; carb: boolean; veg: boolean; suffix: string }[] = [
  { protein: true, carb: true, veg: true, suffix: 'bowl' },
  { protein: true, carb: false, veg: true, suffix: 'plate' },
  { protein: true, carb: true, veg: false, suffix: 'sandwich' },
];

function generateFreestyle(ctx: RecommendationContext, idx: PantryIndex): ScoredOption[] {
  const proteins = idx.byCategory.get('protein') ?? [];
  const carbs = idx.byCategory.get('carb') ?? [];
  const veg = idx.byCategory.get('vegetable') ?? [];

  const candidates: ScoredOption[] = [];

  for (const tmpl of FREESTYLE_TEMPLATES) {
    if (tmpl.protein && proteins.length === 0) continue;
    if (tmpl.carb && carbs.length === 0) continue;
    if (tmpl.veg && veg.length === 0) continue;

    let p: PantryItem | null = null;
    if (tmpl.protein) {
      p = pickProtein(ctx.preferredProtein, proteins);
    }
    const c = tmpl.carb ? carbs[0] : null;
    const v = tmpl.veg ? veg[0] : null;

    const titleParts = [p?.name, c?.name, v?.name].filter(Boolean) as string[];
    const title = `${titleParts.join(' & ')} ${tmpl.suffix}`;

    const used = titleParts.slice();

    let score = 0.45;
    if (
      ctx.preferredProtein != null &&
      p != null &&
      normalizeName(ctx.preferredProtein) === p.normalizedName
    ) {
      score += 0.15;
    }
    if (ctx.cravingText != null) {
      const tokens = normalizeName(ctx.cravingText)
        .split(/\s+/)
        .filter((t) => t.length > 2);
      const matched = tokens.some((t) => title.toLowerCase().includes(t));
      if (matched) score += 0.05;
    }

    const reasonBits = [`built from your ${used.join(', ')}`];
    if (p) reasonBits.push(`protein: ${p.name}`);

    candidates.push({
      title,
      reason: reasonBits.join('; '),
      proteinSource: p?.name ?? null,
      ingredientsUsed: used,
      ingredientsMissing: [],
      prepTimeMinutes: 15,
      caloriesEstimated: null,
      proteinGEstimated: null,
      carbsGEstimated: null,
      fatGEstimated: null,
      confidence: clamp(score),
      recipeId: null,
      items: [
        ...(p ? [{ name: p.name, role: 'protein' as const }] : []),
        ...(c ? [{ name: c.name, role: 'carb' as const }] : []),
        ...(v ? [{ name: v.name, role: 'vegetable' as const }] : []),
      ],
      score,
    });
  }
  return candidates;
}

function pickProtein(preferred: string | null, proteins: PantryItem[]): PantryItem | null {
  if (proteins.length === 0) return null;
  if (preferred) {
    const norm = normalizeName(preferred);
    const match = proteins.find((p) => p.normalizedName === norm);
    if (match) return match;
  }
  return proteins[0] ?? null;
}

export function generateOptions(ctx: RecommendationContext): ScoredOption[] {
  const idx = indexPantry(ctx.pantry);
  const recipeOptions = ctx.recipes.map((r) => scoreRecipe(r, ctx, idx));
  const freestyle = generateFreestyle(ctx, idx);
  const all = [...recipeOptions, ...freestyle];
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, Math.max(1, ctx.maxOptions));
}
