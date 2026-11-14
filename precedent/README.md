# Precedent

**Your team's decisions, why they were made, and the work that goes against them.**

Precedent is a Forge app for Jira. It keeps a log of the decisions your team has made (architecture choices,
policies, vendor choices, "we will not do X"), with the rationale, the rejected alternatives, the owner and the
conditions for revisiting them. Every new or edited Jira work item is checked against that log. When work
contradicts a past decision, Precedent says so on the work item, names the decision and the person who made it,
and suggests what to do — before anyone has written code.

> A new engineer opens *"Add Redis cache for user sessions to cut login latency."*
> Thirty seconds later Precedent comments: **Conflicts with: "Do not store user sessions in Redis" — decided by
> Priya Shah on 2026-03-12.** Session tokens are in PCI scope and our Redis cluster sits outside the audited
> environment. Next step: talk to Priya, or record a superseding decision.

## The problem

Teams forget *why*. Decisions live in a Confluence page from last spring, a comment thread on a closed ticket, or
in the head of someone who changed teams. New work quietly re-litigates them, or worse, silently undoes them. The
cost shows up as rework, failed audits and repeated incidents. Search does not help, because nobody thinks to
search for a decision they don't know exists.

Precedent turns decisions into something work is *checked against*, automatically, at the moment work is created.

## What it does

| | |
|---|---|
| **Catches contradictions automatically** | A product-event trigger checks every new or edited work item. Findings are *contradicts*, *revisits* (the work reopens the decision, or its revisit condition now holds) or *aligned*. High-confidence contradictions get one Jira comment. |
| **Explains, never just blocks** | Each finding quotes the conflict, shows the rationale and rejected options, the owner and their teams (from Teamwork Graph), and a next step. People can acknowledge, dismiss ("not a conflict") or change the decision. |
| **Decisions change on purpose** | "Change the decision…" records a superseding decision. The old one stays as history, linked both ways, and its open conflicts resolve. |
| **Captures decisions where they happen** | New Jira comments that read like a decision ("we decided…", "agreed to…") are extracted automatically. Confluence pages you work on are imported through Teamwork Graph. Meeting notes can be pasted. |
| **Check a plan before it becomes work** | Paste an RFC, design or PR description and see which decisions it touches. |
| **Rovo agent + MCP** | The *Precedent* Rovo agent answers "why did we…?" and checks proposals in chat. The same five tools are exposed over MCP, so Claude, Cursor or any MCP client can check a plan against your decisions while coding. |

## How it works

```
 Jira work item created/edited ─► trigger ─► queue ─► consumer ──────────────┐
 Jira comment added ────────────► trigger ─► queue ─► consumer ─► extract ─► │ decision log
 Confluence pages (Teamwork Graph, as user) ─► import ─► queue ─► extract ─► │ (Forge KVS)
 Rovo agent / MCP / UI ─► actions & resolvers ──────────────────────────────►│
                                                                              │
 check(work):  BM25 retrieval over the log (statement, keywords, scope,       │
               rejected alternatives weighted) ─► top 8 candidates ─► Claude  │
               judge (Forge LLMs) ─► findings ─► Jira comment / issue panel ◄─┘
```

- **Retrieval before judgement.** A weighted BM25 index narrows hundreds of decisions to the eight that matter, so the
  model sees only relevant context and cost stays flat as the log grows. Work that touches no decision never reaches
  the model.
- **Model with a safety net.** Extraction and judgement use Claude through **Forge LLMs** (data stays on Atlassian's
  platform). If the model is unavailable or answers badly, a rule-based extractor and judge take over (rejected
  alternatives named in the work, prohibitions whose subject appears, revisit cues) and findings are labelled
  *rule-based*.
- **Human decisions stick.** Re-checks keep a person's *dismissed* or *acknowledged* status. Edits that remove a
  conflict resolve it automatically. Precedent comments once per conflict and ignores its own events.
- **Dedupe.** Each captured decision is keyed by source and statement hash, and near-duplicates (Jaccard ≥ 0.75)
  are skipped, so re-importing a page or re-scanning comments is safe.

### Atlassian platform features used

| Feature | How |
|---|---|
| `jira:issuePanel`, `jira:globalPage` (Custom UI) | Findings on the work item; decision log, conflicts, plan checker, import and settings |
| `trigger` (`avi:jira:created/updated/commented:issue`, `ignoreSelf`) + `consumer` (Async events) | Automatic checks and decision capture, off the request path, with concurrency limits |
| `rovo:agent` + 5 `action` modules | The Precedent agent: `search-decisions`, `check-proposal`, `record-decision`, `decision-history`, `list-conflicts` |
| `rovo:mcp` | The same five actions served as MCP tools at `https://mcp.atlassian.com/forge/<appId>` |
| Teamwork Graph API | `atlassianUserRecentlyViewed` → Confluence pages with bodies for import; `confluencePageOwners` → decision owner; `atlassianUserInTeams` → "who to ask" teams on every conflict |
| Forge LLMs (`llm` module, Claude) | Decision extraction and conflict judgement |
| Forge KVS custom entities | `decision` and `finding` entities with partitioned indexes |

## Try it (judges)

1. Install from the installation link on the Devpost submission into a Jira Cloud site with Rovo enabled. An org admin
   must approve the Teamwork Graph scopes.
2. Open **Apps → Precedent – Decision log**. In *Get started*:
   1. **Load samples**: 10 decisions from a fictional payments team.
   2. **Create demo work items** in any project: 5 work items, 4 of which go against the samples.
3. Wait ~30 seconds and open *"Add Redis cache for user sessions…"*. You'll see Precedent's comment and the
   **Precedent** panel with the conflict, rationale, owner and next step. Try **Not a conflict**, **Change the decision…**
   and **Ask Precedent**.
4. Edit the description to *"Add an index to the Postgres sessions table"*: the conflict resolves itself.
5. Back in the Decision log: **Conflicts** lists everything open. **Check a plan**: paste *"Expose GraphQL to partners and
   log full request bodies for debugging"*. **Import** pulls decisions from Confluence pages you have recently viewed.
6. Rovo chat → **Precedent** agent: *"Why did we decide against Elasticsearch?"*, *"We plan to call Stripe directly from
   the checkout service — any problem?"*
7. MCP (optional): an admin enables external access under Atlassian Administration → Apps → Sites → *site* → Connected
   apps. Then:
   ```
   claude mcp add --transport http precedent https://mcp.atlassian.com/forge/<appId>
   ```

**To capture a decision from a comment:** comment on any work item *"We decided to keep all feature flags in
LaunchDarkly because env flags need a redeploy."* It appears in the log within a minute.

## Develop

```bash
npm install
npm run check            # typecheck + unit tests (retrieval, extraction, judging, parsing)
npm run build:ui         # build Custom UI into static/ui/build
forge register           # first time only: creates the app id
npm run deploy           # build UI + forge deploy
forge install            # pick Jira + your site
forge tunnel             # live backend reload while developing
```

Precedent is Jira-only on purpose: Confluence content arrives through Teamwork Graph, which keeps installation to one
product and one admin approval.

## Privacy

- Teamwork Graph reads run **as the current user**, so a person can only import pages they can see.
- AI runs on **Forge LLMs** inside Atlassian's platform. Nothing is sent to third-party services, and the app is
  eligible for *Runs on Atlassian*.
- Only comments with explicit decision wording are sent to the model.
- Admins can turn automatic comments and comment capture off, and limit Precedent to chosen projects.

## License

MIT
