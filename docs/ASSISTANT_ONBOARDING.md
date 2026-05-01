# Connecting your AI assistant to PantryMind

PantryMind exposes two adapters: a **REST API** (good for scripts, web
clients, and assistants that prefer HTTP) and an **MCP server** (good
for desktop assistants that speak the
[Model Context Protocol](https://modelcontextprotocol.io/)). Both are
backed by the same domain core, so behavior is identical.

This guide shows how to connect the most common assistants. Substitute
your own host and bearer token where appropriate.

---

## 1. The system prompt

Paste this into the assistant's system / personality / custom-instruction
slot once you have wired the connection. It teaches the assistant **how
to use** PantryMind, not just that it exists.

```text
You are connected to my personal PantryMind backend through MCP / API.
Your job is to help me make realistic food and health decisions based
on what I feel like eating, what I actually have available, and what
worked for me before. Do not create rigid meal plans unless I ask.
Always start from reality.

When I mention food, meals, cravings, groceries, receipts, pantry items,
or what I ate, use the health tools to record structured data. Every
food interaction should be logged automatically, including ingredients,
protein source, rough portion, calories / macros if available,
recommendation, actual meal, and outcome.

Do not save every meal as a recipe. A meal becomes a saved recipe only
when I explicitly say to save it, or when you suggest it and I approve.

When I ask what to eat, check available food, recent patterns, goals,
and saved recipes, then recommend 1–3 realistic options with a clear
reason. Prefer low-friction advice over perfect plans.
```

You can also fetch this prompt at runtime by calling the MCP tool
`get_onboarding_prompt` with your assistant type, or `GET
/api/v1/onboarding-prompt?assistant=<type>` over REST. (Endpoint lands
in Phase 3.)

---

## 2. MCP — Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "pantrymind": {
      "command": "node",
      "args": ["/absolute/path/to/pantrymind/apps/mcp/dist/index.js"],
      "env": {
        "HEALTHLOOP_DATABASE_URL": "file:/absolute/path/to/pantrymind/data/pantrymind.db",
        "HEALTHLOOP_DEFAULT_TIMEZONE": "Indian/Mauritius"
      }
    }
  }
}
```

Restart Claude Desktop. The `pantrymind` server should appear in the
tool list.

---

## 3. MCP — OpenClaw

In your OpenClaw MCP configuration directory, add:

```json
{
  "name": "pantrymind",
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/pantrymind/apps/mcp/dist/index.js"],
  "env": {
    "HEALTHLOOP_DATABASE_URL": "file:/absolute/path/to/pantrymind/data/pantrymind.db"
  }
}
```

---

## 4. MCP — Cursor

In Cursor's settings, under **MCP Servers**, add a new server with the
same `command` / `args` / `env` shape as Claude Desktop above.

---

## 5. REST — generic assistant or curl

Start the API:

```bash
pnpm dev          # or: docker compose up
```

Health check:

```bash
curl -H "Authorization: Bearer $HEALTHLOOP_API_TOKEN" \
  http://localhost:8787/health
```

Add a pantry item:

```bash
curl -X POST http://localhost:8787/api/v1/pantry/items \
  -H "Authorization: Bearer $HEALTHLOOP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"chicken breast","category":"protein","quantity":500,"unit":"g"}'
```

Ask for a recommendation:

```bash
curl -X POST http://localhost:8787/api/v1/recommendations/meal \
  -H "Authorization: Bearer $HEALTHLOOP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"craving_text":"something heavy and protein-rich"}'
```

The response includes a `card` field — that is the rendered
recommendation. Pass it directly into a Web Component renderer (Phase 6) or into the assistant's UI as structured content.

---

## 6. What happens during a typical conversation

1. **You**: "I have eggs, bread, rice, tuna, chicken, yogurt. I feel
   like something heavy."
2. **Assistant** → calls `update_pantry` with the listed items.
3. **Assistant** → calls `recommend_meal` with the craving text.
4. **Assistant** receives 1–3 recommendation cards and shows them.
5. **You**: "I had the chicken rice bowl."
6. **Assistant** → calls `log_actual_meal` with the chosen
   recommendation id and any portion notes.
7. _Later, after you've eaten:_
8. **You**: "Felt great, full but not heavy, energy is good."
9. **Assistant** → calls `log_meal_outcome` with satisfaction,
   `hunger_after`, `energy_after`.
10. **Assistant**: "This worked well — want to save it as a recipe?"
11. **You**: "Yes."
12. **Assistant** → calls `save_recipe` from the food event id.

Over weeks the system accumulates the only thing that actually matters:
**which meals work for you**.
