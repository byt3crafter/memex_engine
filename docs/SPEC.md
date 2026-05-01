# PantryMind — Product Specification

> Source of truth for the product. This document captures the original
> design brief verbatim, lightly reformatted for readability. Do not edit
> for style; only update when the product itself evolves, and add a
> dated note at the top of the relevant section when you do.

---

## Project name

Working name: **PantryMind** / HealthLoop / AI Health Protocol. Do not
hard-code the name everywhere; keep it easy to rename.

## Core idea

This is **not** a normal diet app.

This is an assistant-native personal health data engine. The main user
interface is an AI assistant. The assistant asks what the user feels like
eating and what food/ingredients they actually have, then recommends a
realistic meal, records what actually happened, and turns successful meals
into reusable recipe/menu knowledge.

Most food apps fail because they tell users what to eat without knowing
what is actually available in their kitchen, what they feel like eating,
and what they really ended up eating. This system starts from reality.

## Long-term vision

Build a self-hostable / open-source AI-native health backend that any AI
assistant can plug into through API / MCP.

People should be able to:

1. Install / self-host the system.
2. Connect their AI assistant via MCP or HTTP API.
3. Give the assistant an onboarding prompt from the website / docs.
4. Tell the assistant: "I feel like eating X and I have Y."
5. Get useful recommendations based on available food, health goals, past
   meals, recipes, and outcomes.
6. Automatically save structured food records.
7. Optionally save good meals as reusable recipes.
8. Generate menus and shopping lists from recipes + pantry.

## Product principles

- Assistant-first, not screen-first.
- API/MCP-first, not OpenClaw-only.
- OpenClaw is only the first adapter / integration.
- Build for our private use first, but with clean open-source architecture.
- Local / self-hosted and privacy-first.
- Data must be exportable.
- No calorie-counting prison. Calories / macros can be supported, but not
  forced.
- The system should capture reality with minimal friction.
- Every interaction should save useful structured data automatically.
- Not every meal becomes a saved recipe. Recipes are promoted explicitly
  or when user approves.

## Primary loop

1. User tells assistant what they feel like eating.
2. User tells assistant what food / ingredients are available, or uploads
   a photo / receipt later.
3. AI recommends the best realistic meal.
4. User confirms what they actually ate.
5. System automatically records food, ingredients, protein source, rough
   portions, recommendation, actual meal, calories / macros if available
   or inferred, and outcome.
6. System marks useful meals as recipe candidates.
7. User can say "save this as recipe" / "make this repeatable" / "add this
   to my menu".
8. Saved recipes power future menu suggestions and shopping lists.

## First target user workflow

The user speaks naturally to an AI assistant:

- "I have eggs, bread, rice, tuna, chicken, yogurt. I feel like something
  heavy."
- Assistant calls the MCP / API to update available food / pantry.
- Assistant calls `recommend_meal` with craving + pantry + health context.
- System returns 2–3 options with reasoning.
- Assistant shows the recommendation as a nice card.
- User says what they actually ate.
- Assistant logs actual meal / outcome.
- If meal worked well, assistant asks whether to save it as a recipe.

## AI card output

The assistant should be able to return structured cards. The backend
should provide enough structured data to render cards in OpenClaw, web
UI, or another assistant.

### Card examples

#### 1. Meal recommendation card

- title
- why this meal
- ingredients used
- protein source
- estimated calories / macros if enabled
- prep time
- confidence score
- missing ingredients, if any
- actions: log eaten, save recipe, suggest alternative, add missing to
  shopping list

#### 2. Food event card

- actual meal
- ingredients
- protein
- portion
- calories / macros estimated / unknown
- outcome fields pending
- recipe candidate yes / no

#### 3. Recipe card

- title
- ingredients
- steps
- protein / carb / fat notes
- tags
- source meal event
- personal notes / outcomes

#### 4. Menu card

- meals for today / next few days
- uses available pantry items
- shopping gaps
- prep notes

## Photo / image future support

Design for future image input, even if not fully implemented in MVP.
Future examples:

- User uploads fridge / pantry photo → AI extracts food items → update
  pantry.
- User uploads receipt → AI extracts purchased foods → update pantry and
  food purchase records.
- User uploads meal photo → AI estimates meal / components / calories →
  log food event.

For MVP, provide API data structures that can accept image metadata and
extracted items, but image analysis can be stubbed or adapter-based.

## Calorie / macro support

Implement calorie / macro support as optional / enriched data, not the
main product. Fields should allow:

- `calories_estimated`
- `protein_g_estimated`
- `carbs_g_estimated`
- `fat_g_estimated`
- `estimate_confidence`
- `estimate_source: user | ai_estimate | nutrition_database | unknown`

Do not block meal logging if calories are unknown.

## Technology

TypeScript end-to-end.

Suggested stack:

- Runtime: Node.js 22+
- API: Hono (alternatively Fastify)
- Validation: Zod
- Database: SQLite via libSQL
- ORM / query builder: Drizzle ORM
- Migrations: Drizzle migrations
- MCP server: TypeScript MCP SDK / protocol-compatible server
- Tests: Vitest
- Package manager: pnpm
- Monorepo: pnpm workspaces + Turborepo
- API docs: OpenAPI generated from schemas / routes
- Docker: Dockerfile + `docker-compose.yml`
- Optional UI later: SvelteKit preferred for lightweight self-hosted
  dashboard

## Architecture

Build core once, expose through multiple interfaces.

Suggested packages:

- `apps/api` — HTTP API server.
- `apps/mcp` — MCP server exposing assistant tools / resources / prompts.
- `apps/docs` — onboarding / docs website (minimal in MVP).
- `packages/core` — domain logic and services.
- `packages/db` — schema, migrations, repository layer.
- `packages/schemas` — shared Zod schemas / types.
- `packages/cards` — structured assistant card types / render helpers.
- `packages/cards-web` — Web Component renderers (post-MVP).

Do not make OpenClaw a dependency of the core. If adding OpenClaw
support, put it in an adapter / skill folder later.

## Database model — MVP

Create normalized but practical tables.

### 1. `user_profile`

- `id`
- `display_name`
- `timezone`
- `goals` JSON
- `dietary_preferences` JSON
- `allergies` JSON
- `health_notes` JSON
- `created_at`
- `updated_at`

### 2. `pantry_item`

- `id`
- `user_id`
- `name`
- `normalized_name`
- `category`: `protein | carb | vegetable | fruit | dairy | fat | snack |
  drink | condiment | other`
- `quantity` nullable
- `unit` nullable
- `expiry_date` nullable
- `source`: `manual | receipt | photo | import | assistant`
- `confidence` nullable
- `is_available` boolean
- `created_at`
- `updated_at`

### 3. `food_event`

Represents any food-related event. This is automatic capture.

- `id`
- `user_id`
- `event_type`: `craving | availability_update | recommendation |
  actual_meal | purchase | snack | drink | recipe_candidate | note`
- `occurred_at`
- `source`: `assistant | api | web | import | photo | receipt`
- `raw_text` nullable
- `image_refs` JSON nullable
- `craving_text` nullable
- `available_food_context` JSON nullable
- `meal_name` nullable
- `actual_eaten` boolean nullable
- `eaten_by_user` boolean nullable
- `for_person` nullable
- `notes` nullable
- `created_at`
- `updated_at`

### 4. `food_event_item`

Items / components inside an event.

- `id`
- `food_event_id`
- `name`
- `normalized_name`
- `role`: `ingredient | protein | carb | vegetable | fruit | fat | sauce
  | drink | dessert | snack | other`
- `quantity` nullable
- `unit` nullable
- `calories_estimated` nullable
- `protein_g_estimated` nullable
- `carbs_g_estimated` nullable
- `fat_g_estimated` nullable
- `estimate_confidence` nullable
- `created_at`

### 5. `recommendation`

- `id`
- `user_id`
- `food_event_id` nullable
- `requested_at`
- `craving_text` nullable
- `goal_context` JSON nullable
- `available_food_snapshot` JSON
- `recommended_title`
- `recommendation_reason`
- `options` JSON
- `selected_option` JSON nullable
- `card` JSON
- `created_at`

### 6. `meal_outcome`

- `id`
- `user_id`
- `food_event_id`
- `satisfaction_score` nullable 1–5
- `hunger_after` nullable 1–5
- `energy_after` nullable 1–5
- `cravings_after` nullable 1–5
- `mood_after` nullable
- `notes` nullable
- `recipe_candidate` boolean default false
- `created_at`

### 7. `recipe`

Only explicit / promoted saved recipes.

- `id`
- `user_id`
- `title`
- `description` nullable
- `source_food_event_id` nullable
- `ingredients` JSON
- `steps` JSON
- `protein_source` nullable
- `tags` JSON
- `estimated_calories` nullable
- `estimated_protein_g` nullable
- `estimated_carbs_g` nullable
- `estimated_fat_g` nullable
- `personal_rating` nullable
- `is_active` boolean
- `created_at`
- `updated_at`

### 8. `menu_plan`

- `id`
- `user_id`
- `title`
- `start_date` nullable
- `end_date` nullable
- `generated_from`: `recipes | pantry | assistant | manual`
- `items` JSON
- `shopping_gaps` JSON
- `card` JSON
- `created_at`
- `updated_at`

### 9. `measurement`

- `id`
- `user_id`
- `type`: `weight | waist | blood_pressure | other`
- `value`
- `unit`
- `measured_at`
- `notes` nullable
- `created_at`

### 10. `exercise_event`

For future gym / home exercise tracking.

- `id`
- `user_id`
- `occurred_at`
- `type`: `home | gym | walk | other`
- `title`
- `duration_minutes` nullable
- `details` JSON
- `difficulty` nullable 1–5
- `pain_flag` boolean default false
- `notes` nullable
- `created_at`

## HTTP API — MVP endpoints

Implement versioned routes under `/api/v1`.

### Health / system

- `GET /health`
- `GET /api/v1/version`

### Profile

- `GET /api/v1/profile`
- `PUT /api/v1/profile`

### Pantry

- `GET /api/v1/pantry`
- `POST /api/v1/pantry/items`
- `PATCH /api/v1/pantry/items/:id`
- `DELETE /api/v1/pantry/items/:id`
- `POST /api/v1/pantry/bulk-update`

### Food events

- `GET /api/v1/food-events?from=&to=&type=`
- `POST /api/v1/food-events`
- `GET /api/v1/food-events/:id`
- `PATCH /api/v1/food-events/:id`
- `POST /api/v1/food-events/:id/items`
- `POST /api/v1/food-events/:id/outcome`

### Recommendations

- `POST /api/v1/recommendations/meal`
- `GET /api/v1/recommendations/:id`
- `POST /api/v1/recommendations/:id/select`

### Recipes

- `GET /api/v1/recipes`
- `POST /api/v1/recipes`
- `POST /api/v1/recipes/from-food-event/:foodEventId`
- `GET /api/v1/recipes/:id`
- `PATCH /api/v1/recipes/:id`
- `DELETE /api/v1/recipes/:id`

### Menus

- `POST /api/v1/menus/suggest`
- `GET /api/v1/menus`
- `GET /api/v1/menus/:id`

### Measurements / exercise

- `POST /api/v1/measurements`
- `GET /api/v1/measurements`
- `POST /api/v1/exercise-events`
- `GET /api/v1/exercise-events`

### Cards

- `GET /api/v1/cards/recent`
- `GET /api/v1/cards/food-event/:id`
- `GET /api/v1/cards/recommendation/:id`
- `GET /api/v1/cards/recipe/:id`

### Export

- `GET /api/v1/export/json`

## MCP server — MVP tools

### Tools

1. **`log_checkin`** — Input: mood, energy, hunger, cravings, sleep,
   alcohol_yes_no, smoking_count_optional, notes. Output: structured card
   + saved record id.
2. **`update_pantry`** — Input: items array (name, quantity, unit,
   category, source, expiry). Output: pantry summary card.
3. **`list_available_food`** — Input: filters optional. Output: available
   items grouped by category / protein / carb / vegetable / etc.
4. **`recommend_meal`** — Input: craving_text, available_food (optional),
   goal (optional), constraints (optional). Behavior: use pantry +
   history + recipes + outcomes to recommend realistic meals. Output:
   1–3 recommendation cards.
5. **`log_food_event`** — Input: raw_text, event_type, items, meal_name,
   image_refs (optional), for_person (optional), eaten_by_user
   (optional). Output: saved food_event card.
6. **`log_actual_meal`** — Input: recommendation_id (optional),
   meal_name, items, portion notes, calories / macros (optional), notes.
   Output: saved food event + outcome prompt / card.
7. **`log_meal_outcome`** — Input: food_event_id, satisfaction,
   hunger_after, energy_after, cravings_after, notes. Output: outcome
   saved + recipe_candidate suggestion.
8. **`save_recipe`** — Input: food_event_id or recipe object, title,
   ingredients, steps, tags. Output: saved recipe card.
9. **`list_recipes`** — Input: filters / tags / ingredients. Output:
   recipe cards.
10. **`suggest_menu`** — Input: days, use_available_food boolean,
    preferences / goals (optional). Output: menu card + shopping gaps.
11. **`get_recent_patterns`** — Input: days default 7. Output: summary of
    meals, cravings, protein consistency, outcomes, recipe candidates.
12. **`get_onboarding_prompt`** — Input: assistant_type optional
    (`openclaw | claude | chatgpt | cursor | generic_mcp`). Output:
    prompt text and setup instructions for connecting an AI assistant.

### Resources

- `health://profile`
- `health://pantry`
- `health://recent-food-events`
- `health://recipes`
- `health://weekly-summary`
- `health://openapi`

### Prompts

- `onboarding_assistant_prompt`
- `meal_recommendation_prompt`
- `recipe_extraction_prompt`
- `weekly_review_prompt`
- `pantry_photo_extraction_prompt` (stub / future)

## Website / docs requirement

Build a minimal website / docs section. It does not need to be fancy, but
it must explain the product clearly.

Pages:

1. **Home** — "AI-native food and health memory for your assistant."
   Explain the loop: what you feel like + what you have + what worked
   before → recommendation → record → recipe → menu.
2. **How it works** — assistant-first workflow; food records vs saved
   recipes; pantry-aware recommendations; optional calorie / macros.
3. **Connect your AI assistant** — explain API and MCP; show generic MCP
   server configuration; show example prompts for assistants; include
   OpenClaw example, but do not make it OpenClaw-only.
4. **API docs** — link to OpenAPI spec; examples with curl.
5. **MCP tools** — list tools and sample calls.
6. **Privacy / self-hosting** — local-first / self-hosted; data export;
   no cloud requirement.

## Assistant onboarding prompt

The website must include a copyable prompt similar to this:

> You are connected to my personal HealthLoop backend through MCP / API.
> Your job is to help me make realistic food and health decisions based
> on what I feel like eating, what I actually have available, and what
> worked for me before. Do not create rigid meal plans unless I ask.
> Always start from reality. When I mention food, meals, cravings,
> groceries, receipts, pantry items, or what I ate, use the health tools
> to record structured data. Every food interaction should be logged
> automatically, including ingredients, protein source, rough portion,
> calories / macros if available, recommendation, actual meal, and
> outcome. Do not save every meal as a recipe. A meal becomes a saved
> recipe only when I explicitly say to save it, or when you suggest it
> and I approve. When I ask what to eat, check available food, recent
> patterns, goals, and saved recipes, then recommend 1–3 realistic
> options with a clear reason. Prefer low-friction advice over perfect
> plans.

## Recommendation engine — MVP

Do not overbuild ML. Start with deterministic + LLM-assisted logic.

Inputs:

- craving / request
- available pantry items
- user goals / preferences
- recent meals and outcomes
- saved recipes
- time of day

Output:

- 1–3 options
- reasoning
- ingredients used
- missing ingredients
- protein note
- calorie / macro estimates if available
- confidence
- card JSON

MVP logic can be simple:

- Prioritize meals using available protein.
- Prefer meals with ingredients already available.
- Avoid repeating poor-outcome meals.
- Boost saved recipes that had good outcomes.
- If craving is unhealthy, suggest a better version rather than rejecting
  it.

## Image / receipt ingestion design

MVP can accept extracted items manually. Add interfaces for future
adapters.

Implement:

- `image_refs` fields on `food_event`.
- `source` enum includes `photo` and `receipt`.
- Endpoint `POST /api/v1/ingest/extracted-items`.
- MCP tool `log_food_event` can accept items extracted by the assistant
  from an image.

Do **not** require the backend to run computer vision in MVP. The
assistant can do image extraction and send structured items.

## Security / privacy

- Single-user / self-hosted MVP.
- API token auth from day one.
- Store config in env vars.
- Do not log raw API tokens.
- Health / food data is private.
- Provide export endpoint.
- Keep cloud / LLM provider optional; the user's assistant can handle
  reasoning.

## Configuration

Environment variables:

- `HEALTHLOOP_PORT`
- `HEALTHLOOP_DATABASE_URL`
- `HEALTHLOOP_API_TOKEN`
- `HEALTHLOOP_BASE_URL`
- `HEALTHLOOP_DEFAULT_TIMEZONE`

## Deliverables

A working repository with:

1. README.md
2. docs/architecture.md
3. docs/assistant-onboarding.md
4. docs/api.md or generated OpenAPI
5. docker-compose.yml
6. .env.example
7. TypeScript monorepo structure
8. SQLite schema + migrations
9. API server
10. MCP server
11. Seed / demo data
12. Tests for core services and API routes
13. Example assistant prompts
14. Example curl calls
15. Example MCP client config

## Acceptance criteria

A developer should be able to:

1. Clone the repo.
2. Copy `.env.example` to `.env`.
3. Run `pnpm install`.
4. Run migrations.
5. Start API server.
6. Start MCP server.
7. Add pantry items.
8. Ask for a meal recommendation through API.
9. Log actual meal.
10. Log outcome.
11. Promote the meal to a recipe.
12. Suggest a simple menu from pantry / recipes.
13. Export all data as JSON.
14. Read website / docs explaining how to connect an assistant.

## First implementation plan

- **Phase 1 — Skeleton**: monorepo, schemas, db, api, tests.
- **Phase 2 — Food loop**: pantry CRUD, food event logging, items,
  recommendation endpoint, outcome logging, recipe promotion.
- **Phase 3 — MCP**: MCP server exposing tools / resources / prompts;
  example MCP config.
- **Phase 4 — Cards / docs**: structured card schemas; API returns card
  JSON; build docs / onboarding website.
- **Phase 5 — Polish**: Docker compose, export endpoint, seed data,
  README walkthrough.

## Quality bar

- Keep code simple and modular.
- Prefer clear domain services over giant controllers.
- Use strict TypeScript.
- Validate all inputs with Zod.
- Add meaningful tests.
- Document decisions.
- Do not add public SaaS / multi-tenant complexity yet.
- Do not overbuild calorie math; make it optional and confidence-scored.
- Do not require UI for the first useful workflow.

## Git / project management

- Use git from the beginning.
- Make small, meaningful commits after each completed phase.
- Conventional Commit style messages
  (`feat: …`, `fix: …`, `chore: …`, `docs: …`, `test: …`, `refactor:
  …`).
- Maintain `CHANGELOG.md` summarizing each phase.
- Before declaring any phase complete, run the relevant tests and
  include the command / output summary in the implementation log.

## Testing / dry-run requirements

Required tests / checks:

1. `pnpm typecheck` must pass.
2. `pnpm lint` and / or `pnpm format:check` must pass.
3. **Unit tests** — recommendation logic, pantry service, food event
   service, recipe promotion, menu suggestion.
4. **API tests** — health endpoint, pantry CRUD, food event create /
   read, recommendation creation, actual meal logging, outcome logging,
   recipe promotion, export endpoint.
5. **MCP tool tests** — at least one happy-path test per tool; validate
   I/O schemas; ensure tools call the correct core services.
6. **Schema / migration tests** — fresh migration works, seed data
   loads, basic read / write after migration works.
7. **OpenAPI / contract tests** — generated spec is valid; documented
   examples match real shapes.
8. **Docker smoke test** — `docker compose up` should start API / MCP
   services; health endpoint should respond.
9. **Dry-run demo** — `pnpm demo:dry-run` walks the full loop with no
   GUI and prints clear PASS / FAIL output.
10. **End-to-end no-GUI acceptance test** — one automated test proving
    the complete assistant-native loop works without any UI.

Root package scripts should include at minimum:

```text
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:unit
pnpm test:api
pnpm test:mcp
pnpm test:e2e
pnpm db:migrate
pnpm db:seed
pnpm demo:dry-run
pnpm verify   # typecheck + lint + tests + build
```

### Definition of done

- No phase is done unless `git status` is clean, changes are committed,
  and `pnpm verify` (or the phase-relevant subset) has passed.
- If a test cannot be written yet, document why and add a TODO issue in
  the implementation log.

## Final note

The product is **not** "an app that tells people what to eat."

The product is **AI-accessible health memory that knows what food you
actually have, what you actually eat, and what works for you — then
turns that into recipes and menus over time.**

Build the first useful, self-hosted version of that.
