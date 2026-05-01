/**
 * pnpm demo:dry-run — proves the assistant-native food loop end-to-end
 * without an HTTP server or any UI.
 *
 * Each step prints PASS/FAIL with a short explanation. Exits 0 when
 * every step passes; non-zero otherwise. This is the no-GUI acceptance
 * test the spec calls out.
 */
import { setupTestHarness } from '@pantrymind/core/test-support';

interface Step {
  name: string;
  run: () => Promise<string>;
}

const log = (line: string) => process.stdout.write(line + '\n');

async function main(): Promise<void> {
  const h = await setupTestHarness();
  const { services } = h;
  let passed = 0;
  let failed = 0;

  const checks: Step[] = [
    {
      name: 'profile auto-created',
      async run() {
        const profile = await services.profile.getCurrentProfile();
        if (!profile.id.startsWith('usr_')) throw new Error('bad profile id');
        return profile.id;
      },
    },
    {
      name: 'profile updated',
      async run() {
        const updated = await services.profile.updateCurrentProfile({
          displayName: 'Dovik',
          timezone: 'Indian/Mauritius',
        });
        if (updated.displayName !== 'Dovik') throw new Error('displayName not updated');
        return `${updated.displayName} (${updated.timezone})`;
      },
    },
    {
      name: 'pantry stocked (3 items)',
      async run() {
        const a = await services.pantry.create({
          name: 'Chicken breast',
          category: 'protein',
          quantity: 500,
          unit: 'g',
        });
        const b = await services.pantry.create({
          name: 'Rice',
          category: 'carb',
          quantity: 1000,
          unit: 'g',
        });
        const c = await services.pantry.create({ name: 'Broccoli', category: 'vegetable' });
        const list = await services.pantry.list();
        if (list.length !== 3) throw new Error(`expected 3, got ${list.length}`);
        return [a.name, b.name, c.name].join(', ');
      },
    },
    {
      name: 'recommend_meal returns at least one option',
      async run() {
        const rec = await services.recommendation.recommendMeal({
          cravingText: 'something heavy',
          preferredProtein: 'Chicken breast',
          maxOptions: 3,
        });
        if (rec.options.length === 0) throw new Error('no options returned');
        const top = rec.options[0]!;
        return `top="${top.title}" (confidence ${top.confidence?.toFixed(2)})`;
      },
    },
    {
      name: 'log actual meal',
      async run() {
        const ev = await services.foodEvent.create({
          eventType: 'actual_meal',
          source: 'assistant',
          mealName: 'Chicken rice bowl',
          items: [
            { name: 'Chicken breast', role: 'protein', quantity: 200, unit: 'g' },
            { name: 'Rice', role: 'carb', quantity: 150, unit: 'g' },
            { name: 'Broccoli', role: 'vegetable' },
          ],
        });
        if (ev.items.length !== 3) throw new Error('items not recorded');
        return `event=${ev.id}`;
      },
    },
    {
      name: 'log meal outcome',
      async run() {
        const events = await services.foodEvent.list({ eventType: 'actual_meal', limit: 1 });
        const ev = events[0];
        if (!ev) throw new Error('no actual_meal event found');
        const outcome = await services.foodEvent.logOutcome(ev.id, {
          foodEventId: ev.id,
          satisfactionScore: 5,
          energyAfter: 4,
          hungerAfter: 1,
          recipeCandidate: true,
        });
        if (outcome.satisfactionScore !== 5) throw new Error('satisfaction not 5');
        return `outcome=${outcome.id} sat=${outcome.satisfactionScore} energy=${outcome.energyAfter}`;
      },
    },
    {
      name: 'promote meal to recipe',
      async run() {
        const events = await services.foodEvent.list({ eventType: 'actual_meal', limit: 1 });
        const ev = events[0];
        if (!ev) throw new Error('no actual_meal event found');
        const recipe = await services.recipe.promoteFromFoodEvent(ev.id, {
          tags: ['quick', 'protein'],
        });
        if (recipe.sourceFoodEventId !== ev.id) throw new Error('source link missing');
        if (recipe.personalRating !== 5) throw new Error('personal rating not lifted');
        return `recipe=${recipe.id} title="${recipe.title}"`;
      },
    },
    {
      name: 'suggest menu',
      async run() {
        const menu = await services.menu.suggest({ days: 2, useAvailableFood: true });
        if (menu.items.length === 0) throw new Error('empty menu');
        return `menu=${menu.id} items=${menu.items.length} gaps=${menu.shoppingGaps.length}`;
      },
    },
    {
      name: 'export bundle is complete',
      async run() {
        const bundle = await services.export.exportAll();
        if (bundle.profile.id == null) throw new Error('no profile');
        if (bundle.pantry.length === 0) throw new Error('empty pantry');
        if (bundle.foodEvents.length === 0) throw new Error('no events');
        if (bundle.recipes.length === 0) throw new Error('no recipes');
        if (bundle.recommendations.length === 0) throw new Error('no recommendations');
        if (bundle.menus.length === 0) throw new Error('no menus');
        return [
          `pantry=${bundle.pantry.length}`,
          `events=${bundle.foodEvents.length}`,
          `recipes=${bundle.recipes.length}`,
          `recommendations=${bundle.recommendations.length}`,
          `menus=${bundle.menus.length}`,
        ].join(', ');
      },
    },
  ];

  log('PantryMind demo:dry-run');
  log('========================');
  for (const step of checks) {
    try {
      const detail = await step.run();
      log(`PASS  ${step.name.padEnd(38)} ${detail}`);
      passed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`FAIL  ${step.name.padEnd(38)} ${msg}`);
      failed++;
    }
  }
  log('========================');
  log(`${passed} passed, ${failed} failed`);

  await h.cleanup();
  if (failed > 0) {
    process.exit(1);
  }
}

await main();
