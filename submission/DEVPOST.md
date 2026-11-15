# Devpost submission — Precedent

**Category:** Apps for Software Teams
**Bonus prizes:** Best Agents (Rovo) · Best app with Atlassian MCP · Best apps with Teamwork Graph integration · Best Marketplace published app

**Tagline:** Catch work that contradicts your team's past decisions — before it ships.

---

## Inspiration
Every engineering team has a decision it has made three times. Someone proposes Redis for sessions, someone else
remembers "we looked at that", nobody remembers *why*, and the reasoning is in a Confluence page from last spring or in
the head of someone who moved teams. Either the team re-litigates it or, worse, the work ships and quietly undoes a
decision that existed for a reason: an audit scope, an incident, a contract.

The Codegeist brief describes the Teamwork Graph as organizational memory: "what's already been decided". We wanted to
make that memory *act*: check new work against past decisions at the moment work is created.

## What it does
Precedent is a Forge app for Jira that keeps a **decision log** (statement, rationale, rejected alternatives, scope,
owner, source and a "revisit when" condition) and checks work against it.

- **Automatic checks.** Every new or edited Jira work item is compared to the log. Findings are **contradicts**,
  **revisits** (the work reopens a decision, or its revisit condition now holds) or **aligned**. A high-confidence
  contradiction gets one Jira comment quoting the decision, its owner and a next step.
- **A panel on every work item.** Rationale, rejected options, the owner's teams (from the Teamwork Graph), and actions:
  acknowledge, "not a conflict", or **change the decision** — which records a superseding decision, keeps history
  linked both ways and resolves the open conflicts.
- **Capture where decisions happen.** Jira comments that read like decisions are extracted automatically. Confluence
  pages you have worked on are found and read through the **Teamwork Graph**, as you. Meeting notes can be pasted.
- **Check a plan.** Paste an RFC or PR description and see which decisions it touches before anyone writes code.
- **Rovo agent.** *Precedent* answers "why did we…?" with the owner, date, rationale and source, and checks proposals
  in chat.
- **MCP.** The same five tools are exposed through `rovo:mcp`, so Claude, Cursor or any MCP client can check a design
  against the team's decisions from the IDE.

## How we built it
- **Forge, Runs on Atlassian.** No external servers or egress. Custom UI (React) for a `jira:issuePanel` and a
  `jira:globalPage`.
- **Event-driven.** `avi:jira:created/updated/commented:issue` triggers (with `ignoreSelf`) push jobs to an **Async
  events** queue with concurrency limits, so model calls never sit on the request path.
- **Retrieval, then judgement.** A weighted BM25 index (statement, keywords, scope, rejected alternatives) narrows the
  log to the 8 most relevant decisions. Only those go to **Claude via Forge LLMs**, which classifies each relation with a
  confidence, an explanation that quotes the conflict, and a next step. Work that touches no decision never reaches the
  model, so cost stays flat as the log grows.
- **A safety net.** If the model is unavailable or returns something unusable, a rule-based extractor and judge take
  over (rejected alternatives named in the work, prohibitions whose subject appears, revisit cues), and findings are
  labelled rule-based.
- **Teamwork Graph.** `atlassianUserRecentlyViewed` returns Confluence pages *with bodies* for import,
  `confluencePageOwners` gives the decision owner and `atlassianUserInTeams` shows which team to ask. All calls run as
  the user, so imports respect Confluence permissions. This also let Precedent stay a **Jira-only app** while reading
  Confluence.
- **Rovo.** A `rovo:agent` with five `action`s (`search-decisions`, `check-proposal`, `record-decision`,
  `decision-history`, `list-conflicts`), and a `rovo:mcp` module exposing the same actions as tools.
- **Storage.** Forge KVS custom entities (`decision`, `finding`) with partitioned indexes.
- **Trust.** Every list that shows work items is filtered by the viewer's browse permission. Admin-only settings and
  deletes. Prompts treat work item text as untrusted data. A person's "dismissed" stays dismissed across re-checks.

## Challenges we ran into
- **Rovo on a free developer site.** Agents and chat weren't available there; we moved to a Forge demo site.
- **Storage edge cases.** KVS custom entities reject empty strings, and integer attributes are 32-bit, so millisecond
  timestamps failed. We store seconds and restore milliseconds in the storage layer.
- **Self-generated events.** Work items created by the app don't fire its own triggers (by design, to prevent loops), so
  the demo data queues its checks explicitly.
- **Precision over recall.** A conflict checker that cries wolf gets uninstalled. Retrieval thresholds, a strict judge
  prompt, a 70% bar for comments and one comment per conflict keep it quiet unless it matters.

## Accomplishments we're proud of
- The first live test caught the conflict on a fresh work item and wrote a next step that used the decision's own
  revisit condition ("check whether Redis Enterprise in the CDE now has PCI attestation").
- A Teamwork Graph import that turned a meeting-notes page into three structured decisions in one click.
- One set of actions serving the issue panel, the Rovo agent and external MCP clients.

## What we learned
Context is only useful at the moment of action. The Teamwork Graph and Rovo make the context available. The product
work is deciding *when* to bring it up and how to say it so people listen.

## What's next
- Pull request checks through Bitbucket and GitHub, so conflicts show up in code review.
- Watching revisit conditions with live metrics ("catalog > 5M rows") and opening a review automatically.
- A Teamwork Graph connector that publishes decisions as first-class graph objects for every Rovo agent.

---

## How we meet the main technology requirement
Precedent is a Forge app (Runs on Atlassian) integrating **Jira** (issue panel, global page, product-event triggers,
REST), **Rovo** (`rovo:agent`, 5 `action` modules, `rovo:mcp`), the **Teamwork Graph API** (Confluence pages, page
owners, user teams) and **Forge platform services** (Async events, KVS custom entities, Forge LLMs).

## Testing instructions for judges
1. Install with the installation link below into a Jira Cloud site with Rovo enabled (a Forge demo site works). An org
   admin approves the Teamwork Graph scopes.
2. **Apps → Precedent – Decision log** → *Get started*: **Load samples**, then **Create demo work items** in any project.
3. After about 30 seconds, open "Add Redis cache for user sessions…": you'll see the Precedent comment. Open the panel
   from the Apps button (⚙) under the title.
4. Try **Not a conflict**, **Change the decision…** and **Re-check**. Edit the description to "Add an index to the
   Postgres sessions table": the conflict resolves.
5. Decision log → **Check a plan**: "Call Stripe directly from checkout and log full request bodies."
6. Rovo → **Precedent** agent: "Why did we decide against Elasticsearch?"
7. Optional MCP: enable external access for the app in Atlassian Administration, then
   `claude mcp add --transport http precedent https://mcp.atlassian.com/forge/ca7f8b07-7edf-4029-a78f-04011f510a7c`.

**Installation link:** https://developer.atlassian.com/console/install/ca7f8b07-7edf-4029-a78f-04011f510a7c?signature=AYABeMo8HfeQmWr8bNqGA4aQpBQAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBWkVw%2Fj%2BjZA6bsXKhXl3aGQAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDH%2Bhs8vSWdvuLwaJBAIBEIA7Fa%2FKXXH1%2FSXDDgEgyO73UZ5KZXbWvm7iyxzcEMEX6J5vFnGX06ACUZxA41%2BxNOJYGpe8HUKRV1QFvtwAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgFGOX36zfzgtXG16MzMLjuFAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMB5b%2BvCqCKj37e8ORAgEQgDv79LVsLzhjLIJIOpx%2FRDbkbRyBa7DJ3sHBnw6T4cI41u%2B5EfYcRz6ZN5cTa2%2BwF2O9fqRrjZpZUi93eQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAdhVEfXhOEzoOZ2E4LFvbbwAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAyvbXrb5Gatcd0%2FWUICARCAO%2FZ1bfq%2FUbtxrUGqSv%2F1FNbReUIVDGL3ryUiewQoqIuVLvVCnicxQJnV9HYZFkftnLM2owYauE4t1FVDAgAAAAAMAAAQAAAAAAAAAAAAAAAAAItrmazh2bq4E7iRxh3wQ7n%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLk1jPQOFv2o%2BEl29IsVNptGDYqNuwbWgOkQBrmPWNe%2BSGoMiHHqAJkOAXx6GISSYpUGqamVd%2F1csxHSjsG%2FQIO4VM%3D&product=jira
**Demo video:** _to be added_
**Marketplace review ticket:** https://ecosystem.atlassian.net/servicedesk/customer/portal/34/ECOHELP-185743 (app "Precedent - Decision Memory for Jira", submitted 15 Nov 2026, pending approval)
**Source:** https://github.com/Baqir376/precedent
