# Precedent — Privacy Policy

_Last updated: 15 November 2026_

Precedent is an Atlassian Forge app for Jira. This policy explains what data it reads, what it stores, and where.

## Where Precedent runs

Precedent **runs entirely on Atlassian's Forge platform** ("Runs on Atlassian"). It has no servers of its own, makes no
calls to external services and has no egress permissions. All code, storage and AI processing happen inside Atlassian
Cloud, in the same infrastructure and region controls as your Jira site.

## Data Precedent reads

| Data | Why | How |
|---|---|---|
| Jira work item summary and description | To check new or edited work against recorded decisions | Jira REST API, when a work item is created or edited, or when a user clicks **Re-check** |
| Jira comments | To capture decisions written in comments ("we decided…") | Only comments that contain explicit decision wording are processed |
| Confluence pages you have recently viewed | To import decisions when **you** choose pages on the Import screen | Teamwork Graph API, **as you**, so only pages you can already see |
| Page owners and team membership | To show who made a decision and which team to ask | Teamwork Graph API, as the current user |
| Your Atlassian account ID and display name | To record who made a decision | Jira REST API |

## Data Precedent stores

Stored in Forge storage (Atlassian-hosted, per installation):

- **Decisions:** statement, rationale, rejected alternatives, keywords, scope, revisit condition, owner name and account
  ID, source title and link, dates and status.
- **Findings:** the work item key and summary, the related decision, the relationship (contradicts / revisits / aligned),
  an explanation, and its status.
- **Settings:** the admin's automation preferences.

Precedent does **not** store full work item descriptions, full comments or full Confluence pages. It keeps only the
extracted decisions and findings above.

Decisions are shared with everyone who can use Precedent on the site. When you import a Confluence page, its decisions
become visible to your team in the decision log. The source page itself remains protected by Confluence permissions.
Findings and work item summaries are only shown to users who can browse that work item.

## AI processing

Precedent uses **Forge LLMs** (Anthropic Claude models hosted through Atlassian's platform) to extract decisions from
text and to judge whether work conflicts with them. Requests are subject to the same moderation and data handling as
Atlassian's own AI features. Content is not used by Precedent to train any model. If the model is unavailable,
Precedent uses a built-in rule-based reader instead.

## Retention and deletion

- Admins and users can delete decisions at any time. Deleting a decision deletes its findings.
- Uninstalling Precedent deletes all of its stored data, following Atlassian's Forge data-retention process.
- Precedent keeps no backups of its own.

## Sharing

Precedent does not sell, share or transfer data to anyone. The developer has no access to customer data stored by the
app.

## Contact

Questions about this policy: **ophunter073@gmail.com**.
