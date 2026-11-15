# Security Policy

## Reporting a vulnerability

Please email **ophunter073@gmail.com** with a description, the steps to reproduce and the potential impact. Do not open
a public GitHub issue for security problems.

- We acknowledge reports within **2 business days**.
- Critical issues are fixed and deployed within **7 days**; others in the next release.
- We'll tell you when a fix is deployed and credit you if you wish.

## How Precedent handles data

Precedent is a Forge app that **runs on Atlassian**: no external servers, no egress, no stored credentials.
Data stays in Atlassian-hosted Forge storage, AI runs through Forge LLMs, and every read of Jira or Teamwork Graph
data is permission-checked for the current user. See the [privacy policy](submission/PRIVACY.md) for details.

## Supported versions

Only the latest version on the Atlassian Marketplace is supported; Forge apps update automatically.
