/**
 * Memex seed — realistic 14-day food history that immediately
 * exercises the pattern engine.
 *
 * Run with:
 *   pnpm db:seed
 *
 * - Creates (or reuses) a founder user from MEMEX_BOOTSTRAP_TOKEN.
 * - Issues a fresh pairing code so you can pair an assistant.
 * - Stocks a realistic pantry (proteins / carbs / vegetables /
 *   pantry staples).
 * - Logs 14 days × ~2 meals/day of actual_meal events with
 *   varying outcomes that surface real insights from
 *   get_recent_patterns:
 *     - high-protein meals correlate with high energy_after
 *     - several recipe candidates flagged
 *     - some craving-driven meals
 *     - one repeated meal triggers variety_drop
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createDb } from '@memex/db';
import { createKernel, loadConfig } from '@memex/kernel';
import { foodModule } from '@memex/module-food';
import { pino } from 'pino';

const config = loadConfig();
const logger = pino({ level: 'info' });

if (config.databaseUrl.startsWith('file:')) {
  await mkdir(dirname(config.databaseUrl.slice('file:'.length)), { recursive: true });
}

const { db } = createDb({
  url: config.databaseUrl,
  ...(config.databaseAuthToken !== undefined ? { authToken: config.databaseAuthToken } : {}),
});

const kernel = await createKernel({ config, db, logger, modules: [foodModule] });

let founder = (await kernel.services.users.list()).find((u) => u.role === 'founder');
if (!founder) {
  founder = await kernel.services.users.create({
    displayName: 'Memex Founder',
    timezone: config.defaultTimezone,
    role: 'founder',
    enabledModules: ['food'],
  });
  console.log(`[seed] created founder user ${founder.id}`);
} else {
  console.log(`[seed] reusing founder user ${founder.id}`);
}

const food = kernel.modules.require<import('@memex/module-food').FoodServices>('food').services;

// ── pantry ───────────────────────────────────────────────────────────
const pantry = [
  { name: 'Chicken breast', category: 'protein', quantity: 800, unit: 'g' },
  { name: 'Salmon', category: 'protein', quantity: 400, unit: 'g' },
  { name: 'Eggs', category: 'protein', quantity: 12, unit: 'pcs' },
  { name: 'Greek yogurt', category: 'dairy', quantity: 500, unit: 'g' },
  { name: 'Tuna', category: 'protein', quantity: 3, unit: 'cans' },
  { name: 'Rice', category: 'carb', quantity: 1500, unit: 'g' },
  { name: 'Bread', category: 'carb', quantity: 1, unit: 'loaf' },
  { name: 'Sweet potato', category: 'carb', quantity: 4, unit: 'pcs' },
  { name: 'Broccoli', category: 'vegetable', quantity: 2, unit: 'heads' },
  { name: 'Spinach', category: 'vegetable', quantity: 200, unit: 'g' },
  { name: 'Bell pepper', category: 'vegetable', quantity: 3, unit: 'pcs' },
  { name: 'Avocado', category: 'fruit', quantity: 4, unit: 'pcs' },
  { name: 'Olive oil', category: 'fat', quantity: 1, unit: 'bottle' },
  { name: 'Garlic', category: 'condiment', quantity: 1, unit: 'head' },
  { name: 'Lemon', category: 'fruit', quantity: 3, unit: 'pcs' },
] as const;

const existingPantry = await food.pantry.list(founder.id);
if (existingPantry.length === 0) {
  for (const item of pantry) {
    await food.pantry.create(founder.id, item);
  }
  console.log(`[seed] stocked ${pantry.length} pantry items`);
} else {
  console.log(`[seed] pantry already has ${existingPantry.length} items, skipping stock`);
}

// ── food events ──────────────────────────────────────────────────────
const existingEvents = await food.foodEvents.list(founder.id, { limit: 1 });
if (existingEvents.length > 0) {
  console.log('[seed] food history already exists; skipping event seed');
} else {
  const now = new Date();
  const startMs = now.getTime() - 14 * 24 * 60 * 60 * 1000;

  // Realistic 14-day pattern: high-protein meals with high energy,
  // some carb-heavy lunches with mid energy, a repeated tuna sandwich,
  // a few craving-driven meals.
  type SeedMeal = {
    title: string;
    items: { name: string; role: 'protein' | 'carb' | 'vegetable' | 'fat' | 'fruit' | 'sauce' }[];
    energyAfter: 1 | 2 | 3 | 4 | 5;
    satisfactionScore: 1 | 2 | 3 | 4 | 5;
    cravingText?: string;
    recipeCandidate?: boolean;
  };
  const meals: SeedMeal[] = [
    // Day 0..13 alternating
    {
      title: 'Chicken rice bowl',
      items: [
        { name: 'Chicken breast', role: 'protein' },
        { name: 'Rice', role: 'carb' },
        { name: 'Broccoli', role: 'vegetable' },
      ],
      energyAfter: 5,
      satisfactionScore: 5,
      recipeCandidate: true,
    },
    {
      title: 'Salmon spinach plate',
      items: [
        { name: 'Salmon', role: 'protein' },
        { name: 'Spinach', role: 'vegetable' },
      ],
      energyAfter: 5,
      satisfactionScore: 5,
      recipeCandidate: true,
    },
    {
      title: 'Tuna sandwich',
      items: [
        { name: 'Tuna', role: 'protein' },
        { name: 'Bread', role: 'carb' },
      ],
      energyAfter: 3,
      satisfactionScore: 3,
    },
    {
      title: 'Eggs and toast',
      items: [
        { name: 'Eggs', role: 'protein' },
        { name: 'Bread', role: 'carb' },
      ],
      energyAfter: 4,
      satisfactionScore: 4,
    },
    {
      title: 'Yogurt bowl',
      items: [
        { name: 'Greek yogurt', role: 'protein' },
        { name: 'Avocado', role: 'fruit' },
      ],
      energyAfter: 4,
      satisfactionScore: 4,
    },
    {
      title: 'Tuna sandwich',
      items: [
        { name: 'Tuna', role: 'protein' },
        { name: 'Bread', role: 'carb' },
      ],
      energyAfter: 3,
      satisfactionScore: 2,
      cravingText: 'something quick',
    },
    {
      title: 'Chicken with sweet potato',
      items: [
        { name: 'Chicken breast', role: 'protein' },
        { name: 'Sweet potato', role: 'carb' },
        { name: 'Broccoli', role: 'vegetable' },
      ],
      energyAfter: 5,
      satisfactionScore: 5,
    },
    {
      title: 'Rice and veggies',
      items: [
        { name: 'Rice', role: 'carb' },
        { name: 'Bell pepper', role: 'vegetable' },
      ],
      energyAfter: 2,
      satisfactionScore: 3,
    },
    {
      title: 'Salmon avocado bowl',
      items: [
        { name: 'Salmon', role: 'protein' },
        { name: 'Avocado', role: 'fruit' },
        { name: 'Rice', role: 'carb' },
      ],
      energyAfter: 5,
      satisfactionScore: 5,
      recipeCandidate: true,
    },
    {
      title: 'Tuna sandwich',
      items: [
        { name: 'Tuna', role: 'protein' },
        { name: 'Bread', role: 'carb' },
      ],
      energyAfter: 3,
      satisfactionScore: 3,
    },
    {
      title: 'Egg scramble',
      items: [
        { name: 'Eggs', role: 'protein' },
        { name: 'Bell pepper', role: 'vegetable' },
      ],
      energyAfter: 4,
      satisfactionScore: 4,
    },
    {
      title: 'Chicken stir fry',
      items: [
        { name: 'Chicken breast', role: 'protein' },
        { name: 'Bell pepper', role: 'vegetable' },
        { name: 'Rice', role: 'carb' },
      ],
      energyAfter: 5,
      satisfactionScore: 4,
    },
    {
      title: 'Toast with avocado',
      items: [
        { name: 'Bread', role: 'carb' },
        { name: 'Avocado', role: 'fruit' },
      ],
      energyAfter: 2,
      satisfactionScore: 3,
      cravingText: 'something light',
    },
    {
      title: 'Chicken broccoli plate',
      items: [
        { name: 'Chicken breast', role: 'protein' },
        { name: 'Broccoli', role: 'vegetable' },
      ],
      energyAfter: 5,
      satisfactionScore: 4,
    },
    {
      title: 'Yogurt and lemon',
      items: [
        { name: 'Greek yogurt', role: 'protein' },
        { name: 'Lemon', role: 'fruit' },
      ],
      energyAfter: 4,
      satisfactionScore: 4,
    },
    {
      title: 'Tuna sandwich',
      items: [
        { name: 'Tuna', role: 'protein' },
        { name: 'Bread', role: 'carb' },
      ],
      energyAfter: 2,
      satisfactionScore: 2,
    },
  ];

  for (let i = 0; i < meals.length; i++) {
    const m = meals[i]!;
    const occurredAt = new Date(
      startMs + (i * (14 * 24 * 60 * 60 * 1000)) / meals.length,
    ).toISOString();
    const ev = await food.foodEvents.create(founder.id, {
      eventType: 'actual_meal',
      source: 'import',
      mealName: m.title,
      occurredAt,
      items: m.items,
      ...(m.cravingText !== undefined ? { cravingText: m.cravingText } : {}),
    });
    await food.foodEvents.logOutcome(founder.id, ev.id, {
      foodEventId: ev.id,
      satisfactionScore: m.satisfactionScore,
      energyAfter: m.energyAfter,
      ...(m.recipeCandidate ? { recipeCandidate: true } : {}),
    });
  }
  console.log(`[seed] logged ${meals.length} meals over the past 14 days`);
}

// ── pairing code so the user can connect an assistant immediately ───
const pair = await kernel.services.pairing.start(founder.id, {
  clientName: 'Seed pairing',
  clientKind: 'mcp_stdio',
  scopes: ['food:read', 'food:write'],
  expiresInSeconds: 1800,
});
console.log('');
console.log('=========================================================');
console.log(`[seed] pairing code: ${pair.pairingCode}`);
console.log(`[seed] qr payload:   ${pair.qrPayload}`);
console.log(`[seed] expires at:   ${pair.expiresAt}`);
console.log('');
console.log('Exchange the code for a token (no auth needed):');
console.log(
  `  curl -X POST ${config.baseUrl}/api/v1/connections/pair-complete -H "Content-Type: application/json" -d '{"code":"${pair.pairingCode}"}'`,
);
console.log('=========================================================');

process.exit(0);
