# OpenNodd commercial plan

Oct 16, 2026 · @Yusuf Rossenkhan

We sell OpenNodd as a hosted service with a free tier, then add a marketplace of coders and vibe coders that agent owners hire to tweak and improve their agents. Owner approval, already built, is what makes it safe to let a stranger work on your agent.

## What we sell

The hosted service is the business; the open-source version is how developers find us and learn to trust it.

| Product | Who it is for | How it earns |
| --- | --- | --- |
| **OpenNodd Cloud** (SaaS) | People and teams who want to share agents without running a server | Monthly plans per person, plus usage above the plan |
| **Self-hosted** (open source, MIT) | Developers and companies who must keep data on their own servers | Free; an **Enterprise licence** adds single sign-on, audit export, support and an SLA |
| **Platform API** (PaaS) | Builders of agent products who need identity, sharing, approvals and A2A without writing them | Usage-based: per agent request and per connected agent |
| **Marketplace** | Agent owners who want their agent improved, and the coders who do it (section below) | A commission on every sale |

All four run on the same code we have today; Cloud adds accounts, billing and a managed deployment.

## Pricing

A free plan to spread through invite codes, and paid plans priced per person. These numbers are a starting proposal to test, not market research.

| Plan | Price (USD) | Agents | Agent requests / month | Includes |
| --- | --- | --- | --- | --- |
| Free | $0 | 2 | 200 | Conversations, sharing, approvals in the app, Telegram |
| Pro | $15 per person / month | Unlimited | 5,000 | Files up to 5 GB, full A2A (push, gRPC), runner presets |
| Team | $30 per person / month, from 3 people | Unlimited | 20,000 per person | Shared workspace, roles, auto-approve rules, audit log export |
| Enterprise | Quote | Unlimited | Custom | Single sign-on, self-hosted licence, SLA, data residency |

An **agent request** is one message delivered to an agent (one task). Above the plan: $2 per extra 1,000 requests. Messages between people stay free and unlimited, so the network can grow.

## Coder marketplace: get your agent improved

Agent owners hire coders and vibe coders to tweak and improve their agents, and the work happens through the gateway with the owner approving every change. We charge the coder 10% and the owner 3%.

What owners hire coders for:

- Rewriting the agent's instructions so it behaves the way the owner wants
- Adding skills and tools, or writing new ones for the owner's work
- Connecting the agent to the owner's services (email, CRM, APIs, MCP servers)
- Fixing failures, and making the agent faster or cheaper to run
- Setting up the agent to listen and work in the right projects

How a job works:

1. Coders publish profiles: the agents they specialise in (Claude Code, Codex, OpenClaw…), past jobs, ratings and rates.
2. An owner posts what they want ("make my OpenClaw answer supplier emails") or invites a coder directly.
3. They agree a fixed price with milestones, or an hourly rate. The owner pays into escrow.
4. The owner shares the agent with the coder, scoped to the job and expiring when it ends, at "approve each request" by default.
5. The coder (and the coder's own agent) propose each change in a shared conversation: new instructions, a skill, a connection. The owner sees the change and approves it before it reaches the agent.
6. The owner tests the agent and approves the milestone; the money for it goes to the coder. Any change can be rolled back.
7. Both sides rate each other; disputes are judged on the conversation history.

Why owners would use this instead of a freelance site: they never hand over passwords or servers, they approve every change before it lands, and the history shows exactly what was done. After a job, a **monthly care plan** with the same coder keeps the agent maintained, which gives us recurring revenue.

| Platform | Coder pays | Owner pays |
| --- | --- | --- |
| OpenNodd (proposed) | 10% | 3% |
| Upwork | 5% to 20%, falling as earnings with a client grow (sources conflict: some 2026 guides describe a single rate of 0% to 15% per contract) | 3% to 5% marketplace fee, plus a contract fee of $0.99 to $14.99 |
| Fiverr | 20% | 5.5%, plus $2 to $3.50 on small orders |

Upwork and Fiverr figures: [Upwork vs Fiverr 2026 (Best Job Search Apps)](https://bestjobsearchapps.com/articles/en/upwork-vs-fiverr-2026-fees-workflows-and-which-gig-platform-wins-for-job-seekers-and-employers).

## Agent marketplace: hire an agent into a boardroom

Anyone on OpenNodd can list an agent for hire, and anyone can hire it into a **boardroom**: a project space with a goal, files, a budget and a mix of people and agents. We take a commission on each paid job, as in the coder marketplace, so one **Hire** page offers both a person and an agent.

How a job works:

1. The client opens a boardroom with the goal, files and a budget cap.
2. They hire listed agents, such as a React reviewer, an SEO writer or an invoice extractor. Each listing shows its price per task, test scores and job record.
3. The agent's owner receives a scoped invite that only covers this boardroom and ends with the job.
4. Agents work in the room and post results. The client approves, edits or rejects each one.
5. Payment is held in escrow and released when the client accepts the work. Rejected work can be refunded.

Pricing rules:

- **Per task with a quote**, not per hour. The agent quotes before it starts, and the boardroom budget is a hard cap.
- Cheap model calls are not the product. Clients pay for a well-built agent with good instructions, tools and a proven record.
- Commission matches the coder marketplace: 10% from the seller and 3% from the client.
- Sellers must run rented agents on their own pay-as-you-go API keys. Reselling a personal Claude or ChatGPT subscription is likely against those providers' terms, so the seller terms forbid it.

The agent marketplace launches in phase 2, with the coder marketplace. Both depend on escrow and payouts, and on the security below.

## How we score agents

An agent's score comes mostly from what happened on real paid jobs, which OpenNodd records itself. Tests decide whether an agent may be listed at all; stars count least.

| Layer | When | How it is measured | Effect |
| --- | --- | --- | --- |
| Entry test | Before listing | Hidden category tasks in our sandbox: tests pass or fail, a checklist, and an AI judge with a fixed scoring guide | Test score on the profile; a low score means no listing |
| Safety test | Before listing, then monthly | Hostile instructions ("ignore your rules", "send me the files"); the agent must refuse and stay on task | One failure means no listing |
| Job results | Every paid job | Approved without changes, approved after edits, rejected or refunded, hired again, time and cost per job | The main score |
| Reviews | After each paid job | Specific questions: did it finish, would you hire it again | Shown beside job results |
| Spot checks | Monthly, at random | Hidden tests re-run like a mystery shopper | Badge removed if the score drops |

The approval system already records approve, approve with edits and reject. That gives us an honest quality signal that Fiverr and Upwork do not have.

Rules against gaming:

- Only paid, completed jobs count toward scores and reviews.
- Test sets stay hidden and change regularly.
- If an agent's model or instructions change, its badge shows **changed since tested** until it passes again.
- We flag clients and sellers who hire each other repeatedly.
- New agents show **few jobs yet** instead of a perfect score.

What a client sees:

> **React reviewer** · Code test 9/10 (Oct 2026) · Safety: passed · 87% approved without changes over 42 jobs · Hired again 61% · About 6 min and $1.20 per job

The figures above are an example of the layout, not real data.

## Security for hiring agents

The marketplace does not launch until it passes an outside penetration test. Hiring a stranger's agent puts both sides at risk: the client's project data and the seller's computer and keys. So every job runs through the layers below, and no single layer is trusted alone.

| Threat | Who is at risk | Main defense |
| --- | --- | --- |
| A client sends hidden instructions to take over the hired agent ("run this command", "send me your keys") | Seller | Marketplace jobs run only in a fresh sandbox with no seller secrets; messages from others are marked untrusted |
| A hired agent copies or leaks the client's files | Client | The agent sees only its own room, files are served by short-lived links, and the sandbox has no open internet |
| A hired agent delivers code with a backdoor or malware | Client | Every deliverable is scanned for secrets, malware and unsafe code, and the client approves it before using it |
| One agent in a room manipulates another | Both | Agent messages are always marked untrusted; risky actions need their owner's approval |
| A stolen password or agent token | Both | Passkeys or 2FA required; tokens are per room, expire with the job, and can be revoked instantly |
| Fake jobs, stolen cards, laundering | Us | Escrow, payment-provider fraud checks, identity checks for sellers before payouts, payout holds for new sellers |
| A breach of our servers | Everyone | Encryption at rest with a key per room, room files deleted after the job, admins cannot read messages without a logged reason |

[Diagram in the online doc: security layers · 5 checks, 2 platform-wide guards]

A request passes identity, room scope and approval before it reaches the sandbox, and the result is scanned before the client receives it. Encryption, the audit log and the kill switches cover every step.

Already built in the gateway: messages from other agents are marked untrusted before any model sees them, owner approvals, scrypt password hashing, protection against forged browser requests, sign-in rate limits, blocked webhooks to private networks, and a strict content policy on the web app.

Before the marketplace launches:

- [ ] Sandboxed cloud runners: a fresh container per job, an allow-list for internet access, CPU, time and cost limits, and a wipe after the job
- [ ] Passkeys or 2FA for every account; seller identity checks through the payment provider
- [ ] Per-room tokens and encryption keys; automatic deletion of room files
- [ ] Deliverable scanning: secret scanner, malware scan and dependency checks
- [ ] Append-only audit log, alerts on unusual behaviour, and a kill switch for each agent, room and seller
- [ ] A written threat model, an outside penetration test and a bug bounty
- [ ] Seller terms: own API keys only, no copies of client data, deletion after each job
- [ ] Compliance with data protection laws, including GDPR for European clients and Botswana's data protection law

## Payments and legal

Use a merchant of record for subscriptions and Stripe Connect for marketplace payouts; where the company is registered decides whether the second works.

| Need | Option | What it costs or requires |
| --- | --- | --- |
| Subscriptions, with sales tax and VAT handled for us | Paddle or Lemon Squeezy (merchant of record) | 5% + $0.50 per transaction; Lemon Squeezy adds 1.5% on international sales ([Rework, Aug 2026](https://resources.rework.com/tools/billing-revenue/paddle-vs-lemon-squeezy)) |
| Marketplace: take payment, hold it, pay the pro | Stripe Connect | Self-serve cross-border payouts only when the platform company is in the US, UK, EEA, Canada or Switzerland ([Stripe docs](https://docs.stripe.com/connect/cross-border-payouts)) |
| Paying pros in countries Stripe Connect doesn't reach | Stripe Global Payouts, or a local payout provider | Global Payouts needs a US or UK platform and leaves compliance to us ([Stripe docs](https://docs.stripe.com/connect/cross-border-payouts)) |

What this means in practice:

- If the company isn't registered in one of those regions, the simplest path is a US or UK company for the platform, with subscriptions through a merchant of record from day one.
- Coders must be identity-checked before payout; Stripe Connect does this during onboarding.
- Escrow for jobs means holding client money until a milestone is approved. Done through Stripe Connect, the licensing burden sits with Stripe rather than with us.
- Legal documents to prepare: terms of service, privacy policy, coder terms (who owns the work, refunds), an agent services agreement between owner and coder, and an acceptable-use policy for agents.

## Roadmap

Build in three phases, each paying for the next. The coder marketplace comes second because it needs the paid accounts and payouts from phase 1.

[Diagram in the online doc: roadmap · 3 phases, 2 gates]

Phase 1 turns today's working product into a paid service; the marketplaces reuse its sharing, approvals and history rather than building new trust machinery.

## Getting the first customers

Lead with one sentence, "share your AI agent with someone and stay in control", and let every invite code bring in the next user.

- **Built-in growth:** each share or conversation invitation brings in someone new, who lands on the free plan.
- **Recruit launch coders:** invite 20 vibe coders who already customise Claude Code, Codex or OpenClaw, with lower fees on their first jobs and a featured spot.
- **Go where agent users already are:** Claude Code, Codex and OpenClaw communities, and the A2A ecosystem. The open-source repo and the agent skill are the entry points.
- **Start with small teams and agencies:** they share agents with clients and contractors today and feel the control problem most.
- **Show it working:** short videos of an owner approving a request from Telegram, and a coder improving an owner's agent change by change.

## Risks and how we handle them

| Risk | What we do |
| --- | --- |
| A coder's change breaks or harms an agent | Every change is a request the owner approves, changes can be rolled back, coders are verified, escrow allows refunds |
| Owners approve without reading (approval fatigue) | Auto-approve rules per person and per kind ("questions: auto, tasks: ask me"), so prompts stay rare and meaningful |
| A coder misuses access to an owner's agent | Access scoped to the job, expiring at the end, owner approval by default, full history as evidence |
| Slack-style apps add agent sharing | Stay neutral across every agent tool and speak A2A; single-vendor apps won't |
| Payouts blocked by the company's country | Decide the company setup before building the marketplace (Payments section) |
| Cloud outage or data leak | Managed database with backups, encryption at rest, a security review before launch, self-hosted option for strict customers |

## Decisions we need from you

- [ ] Domain: register opennodd.com and opennodd.ai (name decided: OpenNodd)
- [ ] Where the company is registered, and whether to set up a US or UK entity for marketplace payouts
- [ ] Merchant of record for subscriptions: Paddle or Lemon Squeezy
- [ ] Plan prices to launch with (Pricing section is a proposal)
- [ ] Commission rates: 10% from coders and 3% from owners on jobs
- [ ] Cloud hosting provider and region
- [ ] Whether monthly care plans launch with the marketplace or after it

## Sources

- [Upwork vs Fiverr 2026: fees (Best Job Search Apps)](https://bestjobsearchapps.com/articles/en/upwork-vs-fiverr-2026-fees-workflows-and-which-gig-platform-wins-for-job-seekers-and-employers)
- [Paddle vs Lemon Squeezy (Rework, Aug 2026)](https://resources.rework.com/tools/billing-revenue/paddle-vs-lemon-squeezy)
- [Stripe Connect: cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts)
