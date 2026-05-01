/**
 * Pattern engine — Demeter's outcome→insight loop.
 *
 * Crunches recent food_event + meal_outcome data into actionable
 * insights without ML. The output is what makes Memex more useful the
 * longer you use it: the system surfaces personal patterns the user
 * couldn't see by glancing at a week of meals.
 *
 * Phase 4 ships deterministic statistical insights:
 *   - protein → energy correlation
 *   - unpromoted recipe candidates
 *   - variety drop / repeats
 *   - top satisfying meals
 *   - cravings → outcomes
 *
 * Phase 4b will add semantic recall via sqlite-vec.
 */
import type { Db } from '@memex/db';
import { isoDateOnly, type Clock, systemClock } from '@memex/kernel';
import type { FoodEventService, FoodEventWithDetails } from './food-event';
import type { RecipeService } from './recipe';

export interface Insight {
  /** Stable id derived from (kind, scope) so repeat runs replace, not duplicate. */
  id: string;
  kind:
    | 'protein_energy_correlation'
    | 'unpromoted_recipe_candidates'
    | 'variety_drop'
    | 'top_satisfying_meals'
    | 'craving_outcomes'
    | 'activity_dropoff';
  headline: string;
  detail: string;
  evidenceCount: number;
  confidence: number;
  tags: string[];
  data?: Record<string, unknown>;
}

export interface WeeklyReview {
  weekStart: string; // YYYY-MM-DD
  weekEnd: string;
  summary: string;
  highlights: string[];
  insights: Insight[];
  recipeCandidateMealNames: string[];
}

export interface PatternService {
  recentInsights(userId: string, days?: number): Promise<Insight[]>;
  weeklyReview(userId: string): Promise<WeeklyReview>;
}

export interface PatternServiceDeps {
  db: Db;
  foodEvents: FoodEventService;
  recipes: RecipeService;
  clock?: Clock;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createPatternService(deps: PatternServiceDeps): PatternService {
  const clock = deps.clock ?? systemClock;
  const { foodEvents, recipes } = deps;

  async function loadEvents(userId: string, days: number): Promise<FoodEventWithDetails[]> {
    const fromIso = new Date(clock().getTime() - days * DAY_MS).toISOString();
    return await foodEvents.list(userId, { from: fromIso, limit: 1_000 });
  }

  function pct(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : numerator / denominator;
  }

  function proteinEnergyCorrelation(events: FoodEventWithDetails[]): Insight | null {
    const meals = events.filter(
      (e) => e.eventType === 'actual_meal' && e.outcome?.energyAfter != null,
    );
    if (meals.length < 4) return null;

    const proteinMeals = meals.filter((m) => m.items.some((i) => i.role === 'protein'));
    const nonProteinMeals = meals.filter((m) => !m.items.some((i) => i.role === 'protein'));

    const proteinHighEnergy = proteinMeals.filter((m) => (m.outcome?.energyAfter ?? 0) >= 4).length;
    const nonProteinHighEnergy = nonProteinMeals.filter(
      (m) => (m.outcome?.energyAfter ?? 0) >= 4,
    ).length;

    const proteinRate = pct(proteinHighEnergy, proteinMeals.length);
    const nonProteinRate = pct(nonProteinHighEnergy, nonProteinMeals.length);
    const lift = proteinRate - nonProteinRate;

    if (proteinMeals.length < 3 || lift < 0.15) return null;

    return {
      id: 'protein_energy_correlation',
      kind: 'protein_energy_correlation',
      headline: `Protein meals leave you with high energy ${Math.round(proteinRate * 100)}% of the time`,
      detail:
        `Of your last ${proteinMeals.length} meals with a protein source, ${proteinHighEnergy} ` +
        `had energy_after ≥ 4. Non-protein meals: ${nonProteinHighEnergy}/${nonProteinMeals.length} ` +
        `(${Math.round(nonProteinRate * 100)}%). Lift: +${Math.round(lift * 100)} points.`,
      evidenceCount: proteinMeals.length + nonProteinMeals.length,
      confidence: Math.min(0.9, 0.4 + lift),
      tags: ['protein', 'energy'],
      data: {
        proteinMeals: proteinMeals.length,
        proteinHighEnergy,
        nonProteinMeals: nonProteinMeals.length,
        nonProteinHighEnergy,
      },
    };
  }

  async function unpromotedRecipeCandidates(
    userId: string,
    events: FoodEventWithDetails[],
  ): Promise<Insight | null> {
    const candidates = events.filter(
      (e) => e.eventType === 'actual_meal' && e.outcome?.recipeCandidate === true,
    );
    if (candidates.length === 0) return null;

    const promoted = await recipes.list(userId, { includeInactive: true });
    const promotedSourceIds = new Set(
      promoted.map((r) => r.sourceFoodEventId).filter((id): id is string => id != null),
    );
    const unpromoted = candidates.filter((c) => !promotedSourceIds.has(c.id));
    if (unpromoted.length === 0) return null;

    const titles = unpromoted
      .map((c) => c.mealName ?? 'Untitled')
      .filter((t, i, a) => a.indexOf(t) === i)
      .slice(0, 5);

    return {
      id: 'unpromoted_recipe_candidates',
      kind: 'unpromoted_recipe_candidates',
      headline: `${unpromoted.length} meal${unpromoted.length === 1 ? '' : 's'} flagged worth saving — not yet a recipe`,
      detail:
        `You marked these meals recipeCandidate=true but never promoted them: ${titles.join(', ')}. ` +
        `Use save_recipe to lock them in.`,
      evidenceCount: unpromoted.length,
      confidence: 0.95,
      tags: ['recipe', 'action_required'],
      data: { foodEventIds: unpromoted.map((c) => c.id), titles },
    };
  }

  function varietyDrop(events: FoodEventWithDetails[]): Insight | null {
    const meals = events.filter((e) => e.eventType === 'actual_meal' && e.mealName != null);
    if (meals.length < 6) return null;

    const counts = new Map<string, number>();
    for (const m of meals) {
      const key = m.mealName!.trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const repeats = [...counts.entries()].filter(([, n]) => n >= 3);
    if (repeats.length === 0) return null;

    repeats.sort((a, b) => b[1] - a[1]);
    const [topMeal, topCount] = repeats[0]!;

    return {
      id: 'variety_drop',
      kind: 'variety_drop',
      headline: `${topMeal} appeared ${topCount}× recently`,
      detail:
        `${repeats.length} meal${repeats.length === 1 ? '' : 's'} repeated 3+ times in the window. ` +
        `Variety is dropping — consider a different protein or a saved-recipe rotation via suggest_menu.`,
      evidenceCount: meals.length,
      confidence: 0.7,
      tags: ['variety', 'rotation'],
      data: { repeats: repeats.slice(0, 5) },
    };
  }

  function topSatisfyingMeals(events: FoodEventWithDetails[]): Insight | null {
    const fives = events.filter(
      (e) =>
        e.eventType === 'actual_meal' && e.outcome?.satisfactionScore === 5 && e.mealName != null,
    );
    if (fives.length < 2) return null;

    const titles = fives
      .map((e) => e.mealName!.trim())
      .filter((t, i, a) => a.indexOf(t) === i)
      .slice(0, 5);

    return {
      id: 'top_satisfying_meals',
      kind: 'top_satisfying_meals',
      headline: `${fives.length} meal${fives.length === 1 ? '' : 's'} scored a perfect 5 for satisfaction`,
      detail: `Your top hits in this window: ${titles.join(', ')}.`,
      evidenceCount: fives.length,
      confidence: 0.85,
      tags: ['satisfaction', 'best_of'],
      data: { titles },
    };
  }

  function cravingOutcomes(events: FoodEventWithDetails[]): Insight | null {
    const meals = events.filter(
      (e) =>
        e.eventType === 'actual_meal' &&
        e.cravingText != null &&
        e.outcome?.satisfactionScore != null,
    );
    if (meals.length < 3) return null;

    const avg =
      meals.reduce((acc, m) => acc + (m.outcome?.satisfactionScore ?? 0), 0) / meals.length;

    return {
      id: 'craving_outcomes',
      kind: 'craving_outcomes',
      headline: `Craving-driven meals average ${avg.toFixed(1)}/5 satisfaction`,
      detail:
        `Across ${meals.length} meals where you logged a craving first, the post-meal ` +
        `satisfaction averaged ${avg.toFixed(2)}/5. ${avg >= 4 ? 'Going with the craving is working.' : avg <= 3 ? 'Consider talking to the assistant before acting on cravings — outcomes are mediocre.' : 'Mixed results; worth tracking what differentiates the highs from the lows.'}`,
      evidenceCount: meals.length,
      confidence: 0.7,
      tags: ['cravings', 'satisfaction'],
      data: { avgSatisfaction: avg },
    };
  }

  function activityDropoff(events: FoodEventWithDetails[], days: number): Insight | null {
    if (days < 4) return null;
    const now = clock().getTime();
    const halfMs = (days * DAY_MS) / 2;
    const recent = events.filter(
      (e) => e.eventType === 'actual_meal' && now - new Date(e.occurredAt).getTime() <= halfMs,
    ).length;
    const older = events.filter(
      (e) => e.eventType === 'actual_meal' && now - new Date(e.occurredAt).getTime() > halfMs,
    ).length;
    if (older < 3 || recent >= older / 2) return null;
    return {
      id: 'activity_dropoff',
      kind: 'activity_dropoff',
      headline: `Logging dropped ${Math.round((1 - recent / Math.max(older, 1)) * 100)}% in the recent half of the window`,
      detail:
        `${recent} meals logged in the last ${Math.floor(days / 2)} days vs ${older} in the prior ${Math.floor(days / 2)}. ` +
        `Less data = weaker pattern detection. Nudge the user to keep logging.`,
      evidenceCount: recent + older,
      confidence: 0.6,
      tags: ['activity', 'data_quality'],
      data: { recent, older },
    };
  }

  return {
    async recentInsights(userId, days = 30) {
      const events = await loadEvents(userId, days);
      const insights: Insight[] = [];
      const protein = proteinEnergyCorrelation(events);
      if (protein) insights.push(protein);
      const candidates = await unpromotedRecipeCandidates(userId, events);
      if (candidates) insights.push(candidates);
      const variety = varietyDrop(events);
      if (variety) insights.push(variety);
      const satisfying = topSatisfyingMeals(events);
      if (satisfying) insights.push(satisfying);
      const cravings = cravingOutcomes(events);
      if (cravings) insights.push(cravings);
      const dropoff = activityDropoff(events, days);
      if (dropoff) insights.push(dropoff);
      return insights;
    },

    async weeklyReview(userId) {
      const now = clock();
      const weekEnd = isoDateOnly(now);
      const weekStartD = new Date(now.getTime() - 7 * DAY_MS);
      const weekStart = isoDateOnly(weekStartD);

      const events = await loadEvents(userId, 7);
      const insights = await this.recentInsights(userId, 7);
      const meals = events.filter((e) => e.eventType === 'actual_meal');
      const withOutcomes = meals.filter((m) => m.outcome != null);

      const candidates = events.filter(
        (e) => e.eventType === 'actual_meal' && e.outcome?.recipeCandidate === true,
      );
      const promoted = await recipes.list(userId, { includeInactive: true });
      const promotedSourceIds = new Set(
        promoted.map((r) => r.sourceFoodEventId).filter((id): id is string => id != null),
      );
      const recipeCandidateMealNames = candidates
        .filter((c) => !promotedSourceIds.has(c.id))
        .map((c) => c.mealName ?? 'Untitled')
        .filter((t, i, a) => a.indexOf(t) === i);

      const highlights: string[] = [];
      if (meals.length > 0)
        highlights.push(`${meals.length} meal${meals.length === 1 ? '' : 's'} logged`);
      if (withOutcomes.length > 0) highlights.push(`${withOutcomes.length} with outcomes`);
      if (recipeCandidateMealNames.length > 0)
        highlights.push(
          `${recipeCandidateMealNames.length} recipe candidate${recipeCandidateMealNames.length === 1 ? '' : 's'}`,
        );

      const summary =
        meals.length === 0
          ? 'No meals logged this week — get the assistant to log_actual_meal for you next time.'
          : `${meals.length} meal${meals.length === 1 ? '' : 's'}, ${insights.length} insight${insights.length === 1 ? '' : 's'} surfaced.`;

      return {
        weekStart,
        weekEnd,
        summary,
        highlights,
        insights,
        recipeCandidateMealNames,
      };
    },
  };
}
