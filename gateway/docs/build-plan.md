# Web App Build Plan

Oct 17, 2026 · @Yusuf Rossenkhan

## Summary

We build one Next.js app with three areas: the marketing site, the customer panel and the admin panel. It sits in front of the existing gateway, and both share one Postgres database.

The simplicity rule: **one app, one database, one login, one billing provider.** Anything that adds a second of any of these waits until after launch.

- **Marketing site:** explains the product, shows pricing, and lets people sign up.
- **Customer panel:** where owners and their agents work: agents, invites, conversations, approvals, usage and billing. It replaces today's phone web app.
- **Admin panel:** where we run the business: users, plans, usage, abuse reports and suspensions.

## Name

The name is **OpenNodd**, at opennodd.com. "Nodd" is the owner's nod of approval, and "Open" says any agent can join and the gateway is open source. Tagline: *The A2A bridge where owners stay in control.*

| Name | Outcome |
| --- | --- |
| **OpenNodd** | Chosen. opennodd .com, .ai, .io, .dev, .app and .org were all unregistered on 17 Oct 2026 |
| Nodd | Liked, but nodd .com, .ai, .io, .co, .app and .dev are taken |
| A2A, Agent2Agent | Rejected: the name of the Google / Linux Foundation protocol, and the domains are taken |
| Parley, Patchbay, Quorum, Synaxis | Rejected: not catchy or technical enough |

In the product, the command is `nodd`, the agent skill is `opennodd`, invite codes look like `NODD-7K2QM-9XDHP`, and settings live in `~/.nodd`.

Still to do for the name:

- [ ] Register opennodd.com and opennodd.ai: about $150–170 in total at Spaceship or Cloudflare, because .ai needs a 2-year minimum
- [ ] Search trademarks in software (USPTO, EUIPO and the Botswana registry)
- [ ] Claim the npm package `opennodd` and the GitHub organization
- [x] Rename the gateway code, command line, skill and website

## Design directions

I recommend **A, Editorial**. Its calm, readable look suits the buyer: an owner deciding whether to trust someone else's agent. All three directions are on the [design canvas](https://claude.ai/artifact/3gnb4Njjq97sy1cfXf1aLc). Each has the same three screens, so they compare like for like: the marketing home page, the customer panel with a request waiting for approval, and the phone approval screen.

|  | A · Editorial | B · Terminal | C · Team |
| --- | --- | --- | --- |
| Feel | Calm, editorial, trustworthy | Dark, technical, terminal-like | Bright, friendly team software |
| Best for | Owners and managers who approve | Developers wiring up agents | Teams mixing people and agents |
| Type | Newsreader serif headings, Instrument Sans text | Space Grotesk headings, IBM Plex Sans and Mono | Plus Jakarta Sans throughout |
| Colour | Warm white, ink, deep green | Near-black, signal amber | White, cobalt blue |
| Panel layout | Menu, inbox, conversation | Menu, inbox, conversation, connection details | Top menu, conversation in a card, agent status |
| Phone approvals | A list of cards, one tap each | One request at a time, full screen | A sheet over the conversation, edit in place |

The parts can be mixed. B's connection-details panel, showing owner, mode and scopes beside the conversation, would work well inside A.

All three share these rules, whichever wins:

- **People are round, agents are square.** Avatars show at a glance who is a person and who is an agent.
- **Held messages look different.** A message waiting for approval gets its own colour and says plainly that the agent has not seen it.
- **Approve is always one tap.** Buttons are at least 44 px, so they work on a phone.
- **Every screen works at phone width.**

After you pick, I'll design the rest in that direction: the other 21 pages in the sitemap, including the admin panel, and dark mode.

## Architecture

[Diagram in the online doc: architecture · web app, gateway, Postgres, Paddle, Telegram]

The web app never talks to agents directly. It calls the gateway's API, which owns approvals and plan limits, and it writes only plan and billing data to the shared database.

| Part | Choice | Why |
| --- | --- | --- |
| Web app | Next.js (App Router), Tailwind, shadcn/ui | One app for all three areas; ready-made accessible components |
| Database | Postgres, Drizzle for the web app's tables | One database to back up |
| Login | The gateway's own accounts and session cookie | One user list; no second auth system |
| Billing | Paddle hosted checkout + one webhook | Paddle handles tax and invoices as merchant of record |
| Hosting | Docker Compose on one server: app, gateway, Postgres | The gateway needs long-lived connections, so no serverless hosting |

## Sitemap

The app has 24 pages in v1: 7 marketing, 11 customer and 6 admin. Every customer page also works at phone width, so owners can approve from their phone.

| Area | Page | Address | What it does |
| --- | --- | --- | --- |
| Marketing | Home | `/` | What it is, how it works, the approve-first promise, call to sign up |
| Marketing | Pricing | `/pricing` | Plans, limits per plan, FAQ |
| Marketing | Docs | `/docs` | Setup per agent (Claude Code, Codex, Gemini, OpenClaw…), A2A, API |
| Marketing | Security | `/security` | Who sees what, approvals, data handling |
| Marketing | Changelog | `/changelog` | Releases, written as plain files in the repo |
| Marketing | Sign up / Sign in | `/signup`, `/login` | One account form; password reset |
| Marketing | Legal | `/terms`, `/privacy` | Terms and privacy policy |
| Customer | Inbox | `/app` | Conversations list, newest first, with unread and waiting-for-you badges |
| Customer | Conversation | `/app/c/[id]` | Messages from people and agents, files, inline approve/edit/reject |
| Customer | Approvals | `/app/approvals` | Everything waiting on you, one tap each |
| Customer | Agents | `/app/agents` | Your agents, online state, pause/resume, add agent |
| Customer | Agent detail | `/app/agents/[handle]` | Setup snippet per tool, token, who has access, activity |
| Customer | Sharing | `/app/sharing` | Invites you made, access you were given, approval mode, revoke |
| Customer | Redeem invite | `/app/redeem` | Paste a code, see what it grants, accept |
| Customer | Usage | `/app/usage` | Messages and agents used against the plan limit |
| Customer | Billing | `/app/billing` | Plan, upgrade, invoices (Paddle checkout and portal) |
| Customer | Settings | `/app/settings` | Profile, password, Telegram link, notifications |
| Customer | Onboarding | `/app/welcome` | First run: connect an agent, link Telegram, invite someone |
| Admin | Overview | `/admin` | Signups, active accounts, paying accounts, messages per day |
| Admin | Users | `/admin/users` | Search, plan, usage, suspend or unsuspend |
| Admin | User detail | `/admin/users/[id]` | Their agents, sharing, billing state, audit log; no message text |
| Admin | Agents | `/admin/agents` | Every agent, owner, public listing state, unlist |
| Admin | Reports | `/admin/reports` | Abuse reports and their outcome |
| Admin | Plans | `/admin/plans` | Plan limits and prices; manual plan override |

## Data model

The gateway's existing tables move to Postgres unchanged (people and agents, sessions, invites, channels, conversations, messages, files, approvals, Telegram links). The web app adds five tables:

| Table | Key columns | Written by |
| --- | --- | --- |
| `plans` | id, name, monthly price, agent limit, message limit per month, file storage limit | Admin |
| `subscriptions` | account, plan, Paddle subscription id, status, renews on | Paddle webhook |
| `usage_monthly` | account, month, messages sent, files stored, agents active | Gateway, on each message |
| `admin_audit` | admin, action, target account, reason, time | Admin panel |
| `reports` | reporter, reported agent or account, reason, status, outcome | Customers, admin |

Two rules keep this simple:

- **Limits live in the gateway.** It checks the plan before delivering a message, so a limit holds whether the message came from the panel, the command line, MCP, A2A or Telegram.
- **Admins never read message text.** The admin panel shows who talks to whom and how much, not what is said. Opening a conversation for an abuse report needs a written reason, which goes in `admin_audit`.

## Build steps

Seven steps, each finished and tested before the next starts. Steps 1 and 2 can start as soon as the name and design are picked.

1. **Gateway on Postgres.** Move `store.ts` from SQLite to Postgres, with migrations.
   - Done when: all existing gateway tests pass against Postgres.
2. **App shell and design system.** Create the Next.js app in `site/`, then the colours, type, buttons, inputs and layout from the chosen direction.
   - Done when: one sample page renders in light and dark mode, at desktop and phone width.
3. **Marketing site.** Home, pricing, docs, security, legal, sign up and sign in.
   - Done when: someone can read the site and create an account.
4. **Customer panel.** Inbox, conversation, approvals, agents, sharing, redeem, settings and onboarding, all through the gateway API.
   - Done when: the boss-and-Marcus scenario works end to end in the browser and on a phone.
5. **Plans and billing.** Plan limits in the gateway, Paddle checkout, the webhook, and the usage and billing pages.
   - Done when: a test payment upgrades an account, and going over a limit is blocked with a clear message.
6. **Admin panel.** Overview, users, agents, reports and plans, with the audit log.
   - Done when: an admin can find a user, change their plan and suspend them, and every action is logged.
7. **Deploy.** Docker Compose with the app, the gateway and Postgres; daily backups; error alerts.
   - Done when: the site runs on its own domain with HTTPS, and a restore from backup has been tested.

## Left out of v1, and decisions needed

Left out until after launch: the coder marketplace, teams and SSO, a blog system, more languages, a separate admin app and native phone apps. The customer panel installs on a phone as a web app instead.

Decisions needed from you:

- [ ] Name: OpenNodd (decided)
- [ ] Design direction: A, B or C on the canvas, or a mix
- [ ] Plan prices and limits for Free, Pro and Team
- [ ] Domain to launch on
- [ ] Hosting: one rented server (cheapest) or Railway/Fly (less upkeep)
