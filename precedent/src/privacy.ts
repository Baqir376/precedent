import { privacy } from '@forge/api';
import { getUserName } from './lib/jira';
import { listAllDecisions, saveDecision } from './lib/store';
import type { Decision } from './lib/types';

const BATCH = 90; // Atlassian's per-request limit for the personal data reporting API

/**
 * Weekly personal data reporting (Atlassian user privacy guidelines). Precedent stores the account id and
 * display name of decision owners. Closed accounts are anonymised; updated accounts get a fresh name.
 */
export async function reportPersonalData() {
  const decisions = await listAllDecisions();
  const byAccount = new Map<string, Decision[]>();
  for (const d of decisions) {
    if (!d.ownerAccountId) continue;
    const list = byAccount.get(d.ownerAccountId) ?? [];
    list.push(d);
    byAccount.set(d.ownerAccountId, list);
  }
  const accounts = [...byAccount.entries()].map(([accountId, list]) => ({
    accountId,
    updatedAt: new Date(Math.max(...list.map((d) => d.updatedAt || d.createdAt))).toISOString(),
  }));

  let closed = 0;
  let updated = 0;
  for (let i = 0; i < accounts.length; i += BATCH) {
    const results = (await privacy.reportPersonalData(accounts.slice(i, i + BATCH))) ?? [];
    for (const r of results) {
      const owned = byAccount.get(r.accountId) ?? [];
      if (r.status === 'closed') {
        for (const d of owned) {
          d.ownerAccountId = '';
          d.ownerName = 'Former user';
          await saveDecision(d);
        }
        closed++;
      } else if (r.status === 'updated') {
        const name = await getUserName(r.accountId);
        if (name) {
          for (const d of owned) {
            d.ownerName = name;
            await saveDecision(d);
          }
        }
        updated++;
      }
    }
  }
  console.log(`[precedent] personal data report: ${accounts.length} accounts, ${closed} closed, ${updated} updated`);
}
