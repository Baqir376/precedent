# Marketplace security & privacy — reference answers

Facts to answer the Privacy & Security tab and the Forge security questionnaire. Everything here is verifiable from
`precedent/manifest.yml` and the source.

## Architecture
- **Platform:** Atlassian Forge, Runs on Atlassian. Custom UI frontend, Forge functions backend.
- **Egress / remote hosts:** none. The manifest declares no `external` fetch permissions and no `remotes`.
- **Data storage:** Forge KVS (custom entities `decision`, `finding`, and one settings key). Hosted by Atlassian.
- **Data residency:** all data is in Forge storage, so it follows Atlassian's Forge data residency. No data is held
  outside Atlassian.
- **AI:** Forge LLMs (Anthropic Claude through Atlassian). No third-party AI provider is called directly. Admins can
  disable AI model access for the app in Atlassian Administration.
- **Authentication:** handled by Forge (no app-managed credentials, tokens, passwords or API keys).
- **Secrets:** none stored. No environment variables with credentials.

## Data handled
| Data | Stored? | Purpose |
|---|---|---|
| Atlassian account ID of decision owners | Yes | Credit decisions to their owner |
| Display name of decision owners | Yes | Show who made a decision |
| Work item key and summary for findings | Yes | Show which work items conflict with a decision |
| Extracted decision text (statement, rationale, alternatives) | Yes | The decision log |
| Full work item descriptions, comments, Confluence page bodies | No, processed in memory only | Extraction and checks |
| Email addresses, phone numbers, IP addresses, location | No | — |

- **Personal data reporting:** a weekly `scheduledTrigger` calls the Forge personal data reporting API
  (`privacy.reportPersonalData`), anonymises closed accounts and refreshes updated names.
- **Deletion:** users can delete decisions. Uninstalling deletes all Forge storage data per Atlassian's retention
  process.
- **Logging:** logs contain issue keys and counts (e.g. "checked PAY-1: 1 findings"), no user content or personal data.
- **Third parties / subprocessors:** none beyond Atlassian.
- **Data sale / sharing / tracking:** none. No analytics or tracking scripts in the UI.

## Access control
- Teamwork Graph reads run as the current user (respect Confluence and Jira permissions).
- Every list shown to a user is filtered by that user's browse permission on the work items (bulk permission check).
- Settings changes, deleting decisions and removing sample data require Jira administrator permission (checked server
  side).
- Rovo actions read the invoking user's account from the platform context, never from inputs.
- Text from work items is treated as untrusted in AI prompts (prompt-injection guard). Model output is validated
  against a fixed schema and known decision ids before use.

## Security practices
- Dependencies: official `@forge/*` packages, React, Vite, all on their latest versions. `npm audit` (15 Nov 2026)
  reports moderate/high advisories only in transitive dependencies of Atlassian's own latest SDKs (`glob`/`minimatch`
  via `@forge/manifest`, `prosemirror-view` via `@forge/bridge`). None is in Precedent's own code, npm's suggested
  fixes are downgrades to older SDK majors, and they will be picked up as Atlassian releases updated SDKs.
- Code: public at https://github.com/Baqir376/precedent with automated tests (`npm run check`).
- Vulnerability reports: ophunter073@gmail.com. Acknowledge within 2 business days. Critical fixes are deployed within
  7 days.
- No penetration test has been performed (small free app). Can be arranged if required.
- Security contact: ophunter073@gmail.com.
