# Marketplace listing — Precedent

## Basics
- **App name:** Precedent
- **Tagline (≤ 80 chars):** Catch work that contradicts your team's past decisions, before it ships.
- **Product:** Jira Cloud (Forge, Runs on Atlassian)
- **Categories:** Project management · Code quality / Dev tools · Documentation · AI
- **Pricing:** Free
- **Logo:** `precedent/static/ui/public/icon.svg` (export a 144×144 PNG for the listing)

## Summary (≤ 250 chars)
Precedent keeps your team's decisions — rationale, rejected options, owner — and checks every new Jira work item
against them. When work contradicts a decision, it says so on the work item, with the reasoning and who to ask.

## Highlights (3)

**1. Contradictions caught automatically**
Every new or edited work item is checked against your decision log. Conflicts appear in a panel and as one clear
comment that quotes the decision, its owner and the next step.

**2. Decisions captured where they happen**
Precedent pulls decisions from Jira comments and, through the Teamwork Graph, from the Confluence pages you work on,
with rationale, rejected alternatives and revisit conditions.

**3. Ask "why?" in Rovo, or from your IDE**
The Precedent Rovo agent explains past decisions and checks plans before work starts. The same tools are available over
MCP, so Claude, Cursor and other AI clients can check designs while you code.

## Full description
Teams forget why they chose things. Decisions live in old Confluence pages, closed tickets and people's heads. New work
quietly re-opens them or undoes them, and the cost shows up as rework, failed audits and repeated incidents.

Precedent makes decisions something work is *checked against*:

- **Decision log:** statement, rationale, rejected alternatives, scope, owner, source and a "revisit when" condition.
- **Automatic checks:** new and edited work items are compared to the log. Findings are *contradicts*, *revisits* (the
  work reopens the decision, or its revisit condition now holds) or *aligned*.
- **Changes on purpose:** acknowledge a conflict, dismiss it, or record a superseding decision. History is kept and
  linked both ways.
- **Capture:** from Jira comments, from Confluence pages via the Teamwork Graph, or from pasted meeting notes.
- **Check a plan:** paste an RFC or PR description and see which decisions it touches.
- **Rovo agent and MCP tools:** search decisions, explain them, check proposals, record decisions, list open conflicts.

Built on Forge and **Runs on Atlassian**: no external servers, AI through Forge LLMs, data in Forge storage.

Try it in two minutes: open **Apps → Precedent – Decision log**, load the sample decisions, and create the demo work items.

## Screenshots to capture (1840×900 recommended)
1. Work item KAN-1/PAY-1 with the Precedent comment and the panel open (the conflict, rationale, owner, next step).
2. Decision log with stats, a selected decision and its history and "Challenged by" list.
3. Conflicts tab across projects.
4. Import tab: Confluence pages found through Teamwork Graph, "Import finished. 3 decisions captured."
5. Rovo chat with the Precedent agent answering "Why did we decide against Redis for sessions?"
6. Check a plan, with the Stripe and GraphQL conflicts.

## Links required by Marketplace
- **Privacy policy:** https://github.com/Baqir376/precedent/blob/main/submission/PRIVACY.md
- **Support / contact:** ophunter073@gmail.com
- **Documentation:** the repository README.
- **Data security & privacy questionnaire:** answers are in PRIVACY.md (no egress, Forge storage only, Forge LLMs).

## Review form: scopes and why each is needed

| Scope | Why Precedent needs it |
|---|---|
| `read:jira-work` | Read the summary and description of work items when they are created or edited, to check them against recorded decisions, and read comments to capture decisions written in them. |
| `write:jira-work` | Post one comment on a work item when it contradicts a decision, and create the optional demo work items from the getting-started screen. |
| `read:jira-user` | Show the display name of the person who recorded a decision, and refresh names during personal data reporting. |
| `storage:app` | Store the decision log, findings and admin settings in Forge storage. |
| `read:graph:page:confluence` | Find and read Confluence pages the current user has recently worked on, via Teamwork Graph, when they choose to import decisions from them. |
| `read:graph:issue:jira` | Teamwork Graph queries return Jira work items alongside pages in the user's recent work. |
| `read:graph:user:atlassian` | Identify the owners of an imported Confluence page, to credit the decision to the right person. |
| `read:graph:team:atlassian` | Show which teams a decision owner belongs to, so readers know who to ask. |

**Remote hosts / egress:** none. Precedent makes no requests outside Atlassian. AI runs through Forge LLMs.

**Personal data:** stores decision owners' Atlassian account IDs and display names. A weekly scheduled job reports
them through the personal data reporting API, anonymises closed accounts and refreshes updated names.

**AI:** Forge LLMs (Anthropic Claude via Atlassian), used for decision extraction and conflict judgement. Admins can
disable AI model access for the app in Atlassian Administration; Precedent then falls back to rule-based processing.
