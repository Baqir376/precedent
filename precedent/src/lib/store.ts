import { kvs, WhereConditions, Sort } from '@forge/kvs';
import { DEFAULT_SETTINGS, type Decision, type DecisionStatus, type Finding, type FindingStatus, type Settings } from './types';

const DECISION = 'decision';
const FINDING = 'finding';
const SETTINGS_KEY = 'settings';

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * KVS custom entities reject empty strings for declared attributes, so empty strings and empty
 * arrays are dropped on write and restored from defaults on read.
 */
const TIME_FIELDS = new Set(['createdAt', 'updatedAt']);

function pack<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== '' && v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
      // KVS "integer" is 32-bit: timestamps are stored in seconds and restored to ms on read.
      .map(([k, v]) => (TIME_FIELDS.has(k) && typeof v === 'number' ? [k, Math.floor(v / 1000)] : [k, v])),
  ) as T;
}

function restoreTimes<T extends object>(v: T): T {
  const out = { ...v } as Record<string, unknown>;
  for (const k of TIME_FIELDS) if (typeof out[k] === 'number') out[k] = (out[k] as number) * 1000;
  return out as T;
}

const decisionDefaults = (): Decision => ({
  id: '', statement: '', rationale: '', alternatives: [], keywords: [], scope: [], revisitWhen: '', status: 'active',
  ownerAccountId: '', ownerName: '', source: 'manual', sourceUrl: '', sourceRef: '', sourceTitle: '', project: '',
  confidence: 1, decidedAt: '', createdAt: 0, updatedAt: 0, supersededBy: '', supersedes: '',
});

const findingDefaults = (): Finding => ({
  id: '', issueKey: '', issueSummary: '', project: '', decisionId: '', relation: 'aligned', confidence: 0, explanation: '',
  suggestion: '', status: 'open', method: 'llm', commented: false, createdAt: 0, updatedAt: 0,
});

const unpackDecision = (v: Partial<Decision>): Decision => ({ ...decisionDefaults(), ...restoreTimes(v) });
const unpackFinding = (v: Partial<Finding>): Finding => ({ ...findingDefaults(), ...restoreTimes(v) });

async function collect<T>(
  build: () => { cursor(c: string): unknown; getMany(): Promise<{ results: { key: string; value: T }[]; nextCursor?: string }> },
  max: number,
  unpack: (v: T) => T,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const q = build() as { cursor(c: string): typeof q; getMany(): Promise<{ results: { key: string; value: T }[]; nextCursor?: string }> };
    const page = await (cursor ? q.cursor(cursor) : q).getMany();
    out.push(...page.results.map((r) => unpack(r.value)));
    cursor = page.nextCursor;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

// ---------- decisions ----------

export async function saveDecision(d: Decision): Promise<Decision> {
  d.updatedAt = Date.now();
  await kvs.entity<Decision>(DECISION).set(d.id, pack(d));
  return d;
}

export async function getDecision(id: string): Promise<Decision | undefined> {
  const v = await kvs.entity<Decision>(DECISION).get(id);
  return v ? unpackDecision(v) : undefined;
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
    unpackDecision,
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
  return res.results[0] ? unpackDecision(res.results[0].value) : undefined;
}

// ---------- findings ----------

export function findingId(issueKey: string, decisionId: string): string {
  return `${issueKey}:${decisionId}`;
}

export async function saveFinding(f: Finding): Promise<Finding> {
  f.updatedAt = Date.now();
  await kvs.entity<Finding>(FINDING).set(f.id, pack(f));
  return f;
}

export async function getFinding(id: string): Promise<Finding | undefined> {
  const v = await kvs.entity<Finding>(FINDING).get(id);
  return v ? unpackFinding(v) : undefined;
}

export async function listFindingsForIssue(issueKey: string): Promise<Finding[]> {
  return collect<Finding>(
    () => kvs.entity<Finding>(FINDING).query().index('issueKey').where(WhereConditions.equalTo(issueKey)).limit(100),
    200,
    unpackFinding,
  );
}

export async function listFindingsForDecision(decisionId: string): Promise<Finding[]> {
  return collect<Finding>(
    () => kvs.entity<Finding>(FINDING).query().index('decisionId').where(WhereConditions.equalTo(decisionId)).limit(100),
    200,
    unpackFinding,
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
    unpackFinding,
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
