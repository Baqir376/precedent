# Incident Response Plan — Precedent

Owner and security contact: Baqir Raza, ophunter073@gmail.com

Based on Atlassian's guidance: https://developer.atlassian.com/platform/marketplace/preparing-for-a-security-incident/

## 1. Detect
- Sources: vulnerability reports by email (see SECURITY.md), Atlassian Marketplace security tickets (AMS/ECOHELP),
  GitHub Dependabot and CodeQL alerts, Forge logs and alerts in the developer console.

## 2. Assess (within 24 hours)
- Confirm the issue and its severity (Atlassian security bug fix policy: critical / high / medium / low).
- Identify affected versions, installations and data (decisions, findings, account IDs, display names).

## 3. Contain
- Deploy a fix or a kill switch: disable the affected module/feature and redeploy to production (`forge deploy -e production`).
- If needed, revoke Forge CLI API tokens and rotate GitHub credentials.

## 4. Notify
- Atlassian: comment on the Marketplace security ticket / ecosystem.atlassian.net within 24 hours of confirming a
  security incident affecting customer data.
- Customers: use Atlassian's incident communication template, via the Marketplace listing and support channels.

## 5. Fix and recover
- Fix within the timelines of Atlassian's security bug fix policy. Add a regression test. Deploy to all environments
  (judges' app and Marketplace app via `scripts/sync-marketplace.sh`).

## 6. Review
- Write a short post-incident review: cause, impact, timeline, what changes. Keep it with this plan.
