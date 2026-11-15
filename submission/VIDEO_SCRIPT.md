# Demo video — Precedent (target 3:45, hard limit < 5:00)

**Setup before recording** (demo site one-atlas-cbqf):
- Decision log with samples loaded plus the 3 decisions imported from the Confluence page. Delete leftover demo
  work items so the board is clean.
- Browser at 1920×1080, zoom 110%, notifications off, bookmarks bar hidden.
- Tabs ready: Jira board (Payments), Decision log, Confluence "Architecture sync" page, a terminal with Claude Code.
- Record with OBS or Loom. Record the voice-over separately if that's easier, and keep sentences short.

| # | Time | Screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:20 | Title card: "Precedent — your team's decisions, checked against every new piece of work." Then the Confluence page with a decision highlighted. | "Every team makes decisions — and then forgets why. The reasoning lives in a Confluence page from March, or in the head of someone who changed teams. So new work quietly undoes it." |
| 2 | 0:20–0:35 | The Jira board. | "Precedent is a Forge app that remembers your decisions and checks every new work item against them. Let me show you." |
| 3 | 0:35–1:20 | Create a work item live: "Add Redis cache for user sessions to cut login latency" plus the description. Cut ahead ~30 s. Refresh and show the Precedent comment, then open the panel. | "A new engineer wants to cut login latency by moving sessions into Redis. Reasonable — but a few seconds later Precedent comments: this conflicts with a decision Priya made in March. Session tokens are in PCI scope and Redis sits outside the audited environment. It shows the rejected options, who to ask, their team from the Teamwork Graph, and a next step — it even notices the decision's revisit condition." |
| 4 | 1:20–1:50 | Click "Change the decision…" and fill a superseding decision, or show "Not a conflict". Show the history timeline in the Decision log. | "Precedent never blocks. You can dismiss it, acknowledge it, or change the decision on purpose — the old one is kept as history and linked to the new one." |
| 5 | 1:50–2:15 | Show the PAY-4 Elasticsearch item: "Revisits" finding. | "It also knows when a decision is due. We chose Postgres search until the catalog hit five million rows. This work item says we're at six — so Precedent flags the decision for review rather than calling it a conflict." |
| 6 | 2:15–2:45 | Decision log → Import → Find pages → Extract. "3 decisions captured." Show them in the list. Then add a Jira comment "We decided to …" and show it captured. | "Where do decisions come from? Precedent reads them where they already happen. Through the Teamwork Graph it finds the Confluence pages you've worked on — with your permissions — and extracts each decision with its rationale and owner. Decisions written in Jira comments are captured automatically." |
| 7 | 2:45–3:15 | Rovo chat → Precedent agent: "We plan to call Stripe directly from the checkout service. Any problem?" | "In Rovo, the Precedent agent answers why we decided something, and checks a plan before it becomes work." |
| 8 | 3:15–3:35 | Terminal: Claude Code connected to the Precedent MCP server. Ask "Check this plan against our decisions: expose a GraphQL API for partners." | "And because the same tools are exposed over MCP, your coding agent can check a design against your team's decisions while you code." |
| 9 | 3:35–3:50 | Architecture slide: trigger → queue → BM25 retrieval → Claude judge via Forge LLMs → findings; Runs on Atlassian badge. | "Under the hood: Forge triggers and queues, a retrieval step so the model only sees the decisions that matter, Claude through Forge LLMs with a rule-based fallback, and Forge storage. No external servers — it runs on Atlassian." |
| 10 | 3:50–4:00 | End card: name, tagline, "Rovo agent · MCP · Teamwork Graph · Marketplace". | "Precedent. Decisions should change on purpose — not by accident." |

## Checklist
- [ ] Every bonus prize is visible on screen: Rovo agent (7), MCP (8), Teamwork Graph (3 teams, 6 import), Marketplace (end card + listing link in the description).
- [ ] Under 5 minutes.
- [ ] Uploaded to YouTube as **Public**.
- [ ] No personal data, tokens or other people's names on screen (the sample owners are fictional).
