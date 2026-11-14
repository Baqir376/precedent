import { kvs, WhereConditions, Sort } from '@forge/kvs';
import { DEFAULT_SETTINGS, type Decision, type DecisionStatus, type Finding, type FindingStatus, type Settings } from './types';

const DECISION = 'decision';
const FINDING = 'finding';
const SETTINGS_KEY = 'settings';

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

async function collect<T>(
  build: () => { cursor(c: string): unknown; getMany(): Promise<{ results: { key: string; value: T }[]; nextCursor?: string }> },
  max: number,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const q = build() as { cursor(c: string): typeof q; getMany(): Promise<{ results: { key: string; value: T }[]; nextCursor?: string }> };
    const page = await (cursor ? q.cursor(cursor) : q).getMany();
    out.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

// ---------- decisions ----------

export async function saveDecision(d: Decision): Promise<Decision> {
  d.updatedAt = Date.now();
  await kvs.entity<Decision>(DECISION).set(d.id, d);
  return d;
}

export async function getDecision(id: string): Promise<Decision | undefined> {
  return (await kvs.entity<Decision>(DECISION).get(id)) ?? undefined;
}

export async function deleteDecision(id: string): Promise<void> {
  await kvs.entity(DECISION).delete(id);
}

export async function listDecisionsByStatus(status: DecisionStatus, max = 1000): Promise<Decision[]> {
  return collect<Decision>(
    () =>
      kvs
        .entity<Decision>(DECISION)
        .query()
        .index('by-status-created', { partition: [status] })
        .where(WhereConditions.greaterThan(0))
        .sort(Sort.DESC)
        .limit(100),
    max,
  );
}

export async function listAllDecisions(max = 2000): Promise<Decision[]> {
  const statuses: DecisionStatus[] = ['active', 'proposed', 'superseded', 'reversed'];
  const lists = await Promise.all(statuses.map((s) => listDecisionsByStatus(s, max)));
  return lists.flat().sort((a, b) => b.createdAt - a.createdAt);
}

export async function findDecisionBySourceRef(sourceRef: string): Promise<Decision | undefined> {
  const res = await kvs
    .entity<Decision>(DECISION)
    .query()
    .index('sourceRef')
    .where(WhereConditions.equalTo(sourceRef))
    .limit(1)
    .getMany();
  return res.results[0]?.value;
}

// ---------- findings ----------

export function findingId(issueKey: string, decisionId: string): string {
  return `${issueKey}:${decisionId}`;
}

export async function saveFinding(f: Finding): Promise<Finding> {
  f.updatedAt = Date.now();
  await kvs.entity<Finding>(FINDING).set(f.id, f);
  return f;
}

export async function getFinding(id: string): Promise<Finding | undefined> {
  return (await kvs.entity<Finding>(FINDING).get(id)) ?? undefined;
}

export async function listFindingsForIssue(issueKey: string): Promise<Finding[]> {
  return collect<Finding>(
    () => kvs.entity<Finding>(FINDING).query().index('issueKey').where(WhereConditions.equalTo(issueKey)).limit(100),
    200,
  );
}

export async function listFindingsForDecision(decisionId: string): Promise<Finding[]> {
  return collect<Finding>(
    () => kvs.entity<Finding>(FINDING).query().index('decisionId').where(WhereConditions.equalTo(decisionId)).limit(100),
    200,
  );
}

export async function listFindingsByStatus(status: FindingStatus, max = 300): Promise<Finding[]> {
  return collect<Finding>(
    () =>
      kvs
        .entity<Finding>(FINDING)
        .query()
        .index('by-status-created', { partition: [status] })
        .where(WhereConditions.greaterThan(0))
        .sort(Sort.DESC)
        .limit(100),
    max,
  );
}

export async function deleteFinding(id: string): Promise<void> {
  await kvs.entity(FINDING).delete(id);
}

// ---------- settings ----------

export async function getSettings(): Promise<Settings> {
  const s = (await kvs.get<Settings>(SETTINGS_KEY)) ?? {};
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  next.minConfidence = Math.max(0.3, Math.min(0.95, Number(next.minConfidence) || DEFAULT_SETTINGS.minConfidence));
  next.projects = (next.projects ?? []).map((p) => String(p).trim().toUpperCase()).filter(Boolean);
  await kvs.set(SETTINGS_KEY, next);
  return next;
}
