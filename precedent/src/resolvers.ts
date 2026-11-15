import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import * as store from './lib/store';
import { checkWork, decisionLineage, previewCheck, recordDecision, searchDecisions, type ManualDecisionInput } from './lib/engine';
import { createIssue, getRecentComments, commentText, getUserName, getWorkItem, listProjects } from './lib/jira';
import { pageOwners, recentConfluencePages, userTeams } from './lib/twg';
import { DEMO_ISSUES, removeSampleDecisions, seedSampleDecisions } from './lib/seed';
import { enqueue, importKey, type ImportStatus, type Job } from './events';
import { DECISION_CUE, truncate } from './lib/text';
import type { Decision, DecisionStatus, Finding, FindingStatus, Settings } from './lib/types';

const resolver = new Resolver();

type Ctx = { accountId?: string; extension?: { issue?: { key?: string }; [k: string]: unknown } };
type Req<P = Record<string, unknown>> = { payload: P; context: Ctx };

function me(ctx: Ctx): string {
  if (!ctx.accountId) throw new Error('Precedent needs a signed-in user.');
  return ctx.accountId;
}

async function isAdmin(): Promise<boolean> {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  if (!res.ok) return false;
  const body = (await res.json()) as { permissions?: { ADMINISTER?: { havePermission?: boolean } } };
  return !!body.permissions?.ADMINISTER?.havePermission;
}

async function requireAdmin() {
  if (!(await isAdmin())) throw new Error('Only Jira administrators can change this.');
}

/** Wrap handlers so the UI always gets { ok, data | error } instead of an opaque failure. */
function define<P>(name: string, fn: (req: Req<P>) => Promise<unknown>) {
  resolver.define(name, async (req) => {
    try {
      return { ok: true, data: await fn(req as unknown as Req<P>) };
    } catch (err) {
      console.error(`[precedent] ${name} failed`, String(err));
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

async function withDecisions(findings: Finding[]) {
  const ids = [...new Set(findings.map((f) => f.decisionId))];
  const decisions = await Promise.all(ids.map((id) => store.getDecision(id)));
  const map = new Map(decisions.filter((d): d is Decision => !!d).map((d) => [d.id, d]));
  return findings.filter((f) => map.has(f.decisionId)).map((f) => ({ finding: f, decision: map.get(f.decisionId)! }));
}

// ---------- issue panel ----------

define<{ issueKey?: string }>('getIssueView', async ({ payload, context }) => {
  const issueKey = payload.issueKey ?? context.extension?.issue?.key;
  if (!issueKey) throw new Error('No issue in context.');
  const findings = (await store.listFindingsForIssue(issueKey)).filter((f) => f.status !== 'resolved');
  const items = await withDecisions(findings);
  const order = { contradicts: 0, revisits: 1, aligned: 2 } as const;
  items.sort((a, b) => order[a.finding.relation] - order[b.finding.relation] || b.finding.confidence - a.finding.confidence);
  // Teamwork Graph: who to ask. Teams of the owners of conflicting decisions.
  const owners = [...new Set(items.filter((i) => i.finding.relation !== 'aligned').map((i) => i.decision.ownerAccountId).filter(Boolean))];
  const teams: Record<string, string[]> = {};
  await Promise.all(owners.slice(0, 4).map(async (o) => (teams[o] = await userTeams(o))));
  const recorded = (await store.listDecisionsByStatus('active')).filter((d) => d.sourceRef.includes(`:${issueKey}:`));
  return { issueKey, items, teams, recorded, totalDecisions: (await store.listDecisionsByStatus('active', 2000)).length };
});

define<{ issueKey: string }>('recheckIssue', async ({ payload }) => {
  const work = await getWorkItem(payload.issueKey, true);
  return checkWork(work, { allowComment: false, respectProjectFilter: false });
});

define<{ id: string; status: FindingStatus }>('setFindingStatus', async ({ payload }) => {
  const allowed: FindingStatus[] = ['open', 'acknowledged', 'dismissed'];
  if (!allowed.includes(payload.status)) throw new Error('Invalid status.');
  const f = await store.getFinding(payload.id);
  if (!f) throw new Error('Finding not found.');
  f.status = payload.status;
  return store.saveFinding(f);
});

/** Scan this issue's comments for decisions (on demand, as the user). */
define<{ issueKey: string }>('scanIssueComments', async ({ payload }) => {
  const comments = await getRecentComments(payload.issueKey, 50);
  const jobs: Job[] = comments
    .filter((c) => DECISION_CUE.test(commentText(c)))
    .map((c) => ({ kind: 'capture-comment', issueKey: payload.issueKey, commentId: c.id }));
  if (jobs.length) await enqueue(jobs);
  return { queued: jobs.length, scanned: comments.length };
});

// ---------- decisions ----------

async function whoAmI(ctx: Ctx) {
  const accountId = me(ctx);
  return { accountId, name: (await getUserName(accountId)) || 'You' };
}

define<{ input: ManualDecisionInput }>('recordDecision', async ({ payload, context }) => {
  return recordDecision(payload.input, await whoAmI(context), 'manual');
});

define<{ query?: string; status?: DecisionStatus | 'all' }>('listDecisions', async ({ payload }) => {
  const status = payload.status ?? 'all';
  let decisions = status === 'all' ? await store.listAllDecisions() : await store.listDecisionsByStatus(status);
  if (payload.query?.trim()) {
    const hits = await searchDecisions(payload.query, { includeInactive: status !== 'active', limit: 50 });
    const allowed = new Set(decisions.map((d) => d.id));
    decisions = hits.filter((d) => allowed.has(d.id));
  }
  const open = await store.listFindingsByStatus('open');
  const counts: Record<string, number> = {};
  for (const f of open) if (f.relation !== 'aligned') counts[f.decisionId] = (counts[f.decisionId] ?? 0) + 1;
  return { decisions, openConflicts: counts };
});

define<{ id: string }>('getDecision', async ({ payload }) => {
  const decision = await store.getDecision(payload.id);
  if (!decision) throw new Error('Decision not found.');
  const [lineage, findings, teams] = await Promise.all([
    decisionLineage(payload.id),
    store.listFindingsForDecision(payload.id),
    userTeams(decision.ownerAccountId),
  ]);
  return { decision, lineage, findings: findings.sort((a, b) => b.updatedAt - a.updatedAt), teams };
});

define<{ id: string; patch: Partial<Decision> }>('updateDecision', async ({ payload }) => {
  const d = await store.getDecision(payload.id);
  if (!d) throw new Error('Decision not found.');
  const editable: Array<keyof Decision> = ['statement', 'rationale', 'alternatives', 'keywords', 'scope', 'revisitWhen', 'status', 'project', 'decidedAt', 'ownerName'];
  for (const k of editable) if (k in payload.patch) (d as unknown as Record<string, unknown>)[k] = payload.patch[k];
  if (!['active', 'proposed', 'superseded', 'reversed'].includes(d.status)) throw new Error('Invalid status.');
  return store.saveDecision(d);
});

define<{ id: string; input: ManualDecisionInput }>('supersedeDecision', async ({ payload, context }) => {
  return recordDecision({ ...payload.input, supersedes: payload.id }, await whoAmI(context), 'manual');
});

define<{ id: string }>('deleteDecision', async ({ payload }) => {
  for (const f of await store.listFindingsForDecision(payload.id)) await store.deleteFinding(f.id);
  await store.deleteDecision(payload.id);
  return { deleted: payload.id };
});

define<{ status?: FindingStatus }>('listFindings', async ({ payload }) => {
  const findings = await store.listFindingsByStatus(payload.status ?? 'open');
  return withDecisions(findings);
});

define<{ text: string }>('previewCheck', async ({ payload }) => {
  if (!payload.text?.trim()) throw new Error('Describe the change you are planning.');
  return previewCheck(payload.text);
});

// ---------- Teamwork Graph import ----------

define<{ since?: string }>('scanGraph', async ({ payload, context }) => {
  const since = /^P\d+D$/.test(payload.since ?? '') ? payload.since! : 'P90D';
  const { pages, errors } = await recentConfluencePages(me(context), since);
  const imported = new Set((await store.listAllDecisions()).filter((d) => d.source === 'confluence').map((d) => d.sourceRef.split('#')[0]));
  return {
    errors,
    pages: pages
      .map((p) => ({
        ari: p.ari,
        pageId: p.pageId,
        title: p.title,
        url: p.url,
        lastUpdatedAt: p.lastUpdatedAt,
        excerpt: truncate(p.text, 220),
        chars: p.text.length,
        looksLikeDecision: p.looksLikeDecision,
        imported: imported.has(`confluence:${p.pageId}`),
      }))
      .sort((a, b) => Number(b.looksLikeDecision) - Number(a.looksLikeDecision)),
  };
});

define<{ pageIds: string[]; since?: string }>('importPages', async ({ payload, context }) => {
  const accountId = me(context);
  const want = new Set(payload.pageIds ?? []);
  if (!want.size) throw new Error('Pick at least one page.');
  const { pages } = await recentConfluencePages(accountId, payload.since ?? 'P90D');
  const chosen = pages.filter((p) => want.has(p.pageId)).slice(0, 20);
  const importId = store.newId('imp');
  const jobs: Job[] = [];
  for (const p of chosen) {
    const owner = (await pageOwners(p.ari))[0];
    jobs.push({
      kind: 'capture-text',
      importId,
      text: truncate(p.text, 24000),
      source: 'confluence',
      sourceRef: `confluence:${p.pageId}`,
      sourceUrl: p.url,
      sourceTitle: p.title,
      project: '',
      ownerAccountId: owner?.accountId ?? '',
      ownerName: owner?.name ?? '',
      date: p.lastUpdatedAt.slice(0, 10),
    });
  }
  const status: ImportStatus = { total: jobs.length, done: 0, created: 0, skipped: 0, method: '', startedAt: Date.now() };
  await kvs.set(importKey(importId), status);
  await enqueue(jobs);
  return { importId, ...status };
});

define<{ importId: string }>('importStatus', async ({ payload }) => {
  return (await kvs.get<ImportStatus>(importKey(payload.importId))) ?? null;
});

/** Paste any text (meeting notes, an ADR) and extract decisions from it. */
define<{ text: string; title?: string }>('importText', async ({ payload, context }) => {
  const who = await whoAmI(context);
  if (!payload.text?.trim()) throw new Error('Paste some text first.');
  const importId = store.newId('imp');
  const status: ImportStatus = { total: 1, done: 0, created: 0, skipped: 0, method: '', startedAt: Date.now() };
  await kvs.set(importKey(importId), status);
  await enqueue([
    {
      kind: 'capture-text',
      importId,
      text: truncate(payload.text, 24000),
      source: 'manual',
      sourceRef: `paste:${importId}`,
      sourceUrl: '',
      sourceTitle: payload.title?.trim() || 'Pasted notes',
      project: '',
      ownerAccountId: who.accountId,
      ownerName: who.name,
      date: new Date().toISOString().slice(0, 10),
    },
  ]);
  return { importId, ...status };
});

// ---------- setup / admin ----------

define('getSetup', async () => {
  const [settings, admin, active, all] = await Promise.all([
    store.getSettings(),
    isAdmin(),
    store.listDecisionsByStatus('active'),
    store.listAllDecisions(),
  ]);
  let projects: Array<{ key: string; name: string }> = [];
  try {
    projects = (await listProjects()).map((p) => ({ key: p.key, name: p.name }));
  } catch {
    /* user may lack browse permission on all projects */
  }
  return {
    settings,
    isAdmin: admin,
    projects,
    counts: {
      active: active.length,
      total: all.length,
      samples: all.filter((d) => d.source === 'sample').length,
    },
  };
});

define<{ patch: Partial<Settings> }>('saveSettings', async ({ payload }) => {
  await requireAdmin();
  return store.saveSettings(payload.patch);
});

define('seedSamples', async () => ({ added: await seedSampleDecisions() }));

define('removeSamples', async () => {
  await requireAdmin();
  return { removed: await removeSampleDecisions() };
});

define<{ projectKey: string; count?: number }>('createDemoIssues', async ({ payload }) => {
  if (!payload.projectKey) throw new Error('Pick a project.');
  const n = Math.max(1, Math.min(DEMO_ISSUES.length, payload.count ?? DEMO_ISSUES.length));
  const keys: string[] = [];
  for (const issue of DEMO_ISSUES.slice(0, n)) keys.push(await createIssue(payload.projectKey, issue.summary, issue.description));
  // Jira marks events caused by this app as self-generated and the trigger ignores them (to avoid
  // loops), so queue the checks for the demo work items explicitly.
  await enqueue(keys.map((issueKey) => ({ kind: 'check', issueKey, allowComment: true })), 5);
  return { keys };
});

export const handler = resolver.getDefinitions();
