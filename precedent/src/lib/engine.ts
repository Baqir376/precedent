import type { Decision, DecisionSource, Finding, Judgement, WorkItem } from './types';
import { extractDecisions, type ExtractMeta } from './extract';
import { judge, retrieveCandidates } from './judge';
import { forgeLlm, type LlmFn } from './llm';
import { hash, tokenize } from './text';
import * as store from './store';
import { postConflictComment } from './jira';

let llm: LlmFn | undefined = forgeLlm;
/** Tests and the "offline" setting can swap the model out. */
export function setLlm(fn: LlmFn | undefined) {
  llm = fn;
}

export interface CheckResult {
  issueKey: string;
  method: 'llm' | 'heuristic' | 'none';
  candidates: number;
  findings: Finding[];
  commented: boolean;
}

const COMMENT_MIN = 0.7;

/**
 * Check one piece of work against the decision log: retrieve candidates (BM25), judge them (LLM with a
 * rule-based fallback), upsert findings, resolve findings that no longer apply, and optionally comment.
 */
export async function checkWork(work: WorkItem, opts: { allowComment: boolean; respectProjectFilter: boolean }): Promise<CheckResult> {
  const settings = await store.getSettings();
  const empty: CheckResult = { issueKey: work.key, method: 'none', candidates: 0, findings: [], commented: false };
  if (opts.respectProjectFilter && settings.projects.length && !settings.projects.includes(work.project)) return empty;

  const active = await store.listDecisionsByStatus('active');
  // A decision recorded from this very issue cannot conflict with it.
  const pool = active.filter((d) => !d.sourceRef.includes(`:${work.key}:`) && !d.sourceRef.endsWith(`:${work.key}`));
  const candidates = retrieveCandidates(work, pool, 8);

  const existing = await store.listFindingsForIssue(work.key);
  const byId = new Map(existing.map((f) => [f.id, f]));

  let judgements: Judgement[] = [];
  let method: CheckResult['method'] = 'none';
  if (candidates.length) {
    const res = await judge(work, candidates.map((c) => c.decision), llm);
    judgements = res.judgements;
    method = res.method;
  }

  const now = Date.now();
  const kept = new Set<string>();
  const fresh: Finding[] = [];
  for (const j of judgements) {
    if (j.relation === 'unrelated') continue;
    const threshold = j.relation === 'aligned' ? 0.5 : settings.minConfidence;
    if (j.confidence < threshold) continue;
    const id = store.findingId(work.key, j.decisionId);
    kept.add(id);
    const prev = byId.get(id);
    const f: Finding = {
      id,
      issueKey: work.key,
      issueSummary: work.summary,
      project: work.project,
      decisionId: j.decisionId,
      relation: j.relation,
      confidence: j.confidence,
      explanation: j.explanation,
      suggestion: j.suggestion,
      // A human's dismissal or acknowledgement sticks across re-checks.
      status: prev && prev.status !== 'resolved' ? prev.status : 'open',
      method: method === 'llm' ? 'llm' : 'heuristic',
      commented: prev?.commented ?? false,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    await store.saveFinding(f);
    fresh.push(f);
  }

  // Work that was edited so it no longer conflicts resolves its old findings.
  for (const f of existing) {
    if (!kept.has(f.id) && f.status === 'open') {
      f.status = 'resolved';
      await store.saveFinding(f);
    }
  }

  let commented = false;
  const settingsAllow = settings.autoComment && opts.allowComment;
  const toComment = fresh.filter((f) => f.status === 'open' && !f.commented && f.relation !== 'aligned' && f.confidence >= Math.max(COMMENT_MIN, settings.minConfidence));
  if (settingsAllow && toComment.length) {
    const decisions = new Map(candidates.map((c) => [c.decision.id, c.decision]));
    try {
      await postConflictComment(
        work.key,
        toComment.map((finding) => ({ finding, decision: decisions.get(finding.decisionId)! })).filter((x) => x.decision),
      );
      for (const f of toComment) {
        f.commented = true;
        await store.saveFinding(f);
      }
      commented = true;
    } catch (err) {
      console.error('[precedent] comment failed', String(err));
    }
  }

  const order = { contradicts: 0, revisits: 1, aligned: 2 } as const;
  fresh.sort((a, b) => order[a.relation] - order[b.relation] || b.confidence - a.confidence);
  return { issueKey: work.key, method, candidates: candidates.length, findings: fresh, commented };
}

export interface CaptureMeta extends ExtractMeta {
  source: DecisionSource;
  /** Base reference, e.g. "jira-comment:PAY-12:10042"; a statement hash is appended per decision. */
  sourceRef: string;
  sourceUrl: string;
  sourceTitle: string;
  project: string;
  ownerAccountId: string;
  ownerName: string;
}

function jaccard(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface CaptureResult {
  method: 'llm' | 'heuristic';
  created: Decision[];
  skipped: Array<{ statement: string; reason: string }>;
}

/** Extract decisions from text and persist the new ones (deduplicated by source and by meaning). */
export async function captureDecisions(text: string, meta: CaptureMeta, existingActive?: Decision[]): Promise<CaptureResult> {
  const { decisions, method } = await extractDecisions(text, { title: meta.title ?? meta.sourceTitle, author: meta.ownerName, date: meta.date }, llm);
  const active = existingActive ?? (await store.listDecisionsByStatus('active'));
  const created: Decision[] = [];
  const skipped: CaptureResult['skipped'] = [];

  for (const x of decisions) {
    if (x.confidence < 0.45) {
      skipped.push({ statement: x.statement, reason: 'Not clearly an agreed decision' });
      continue;
    }
    const sourceRef = `${meta.sourceRef}#${hash(x.statement.toLowerCase())}`;
    if (await store.findDecisionBySourceRef(sourceRef)) {
      skipped.push({ statement: x.statement, reason: 'Already captured from this source' });
      continue;
    }
    const dup = [...active, ...created].find((d) => jaccard(d.statement, x.statement) >= 0.75);
    if (dup) {
      skipped.push({ statement: x.statement, reason: `Duplicate of "${dup.statement}"` });
      continue;
    }
    const now = Date.now();
    const d: Decision = {
      id: store.newId('dec'),
      statement: x.statement,
      rationale: x.rationale,
      alternatives: x.alternatives,
      keywords: x.keywords,
      scope: x.scope,
      revisitWhen: x.revisitWhen,
      status: x.confidence >= 0.75 ? 'active' : 'proposed',
      ownerAccountId: meta.ownerAccountId,
      ownerName: x.ownerName || meta.ownerName,
      source: meta.source,
      sourceUrl: meta.sourceUrl,
      sourceRef,
      sourceTitle: meta.sourceTitle,
      project: meta.project,
      confidence: x.confidence,
      decidedAt: x.decidedAt || meta.date || new Date().toISOString().slice(0, 10),
      createdAt: now,
      updatedAt: now,
      supersededBy: '',
      supersedes: '',
    };
    await store.saveDecision(d);
    created.push(d);
  }
  return { method, created, skipped };
}

export interface ManualDecisionInput {
  statement: string;
  rationale?: string;
  alternatives?: string[] | string;
  scope?: string[] | string;
  revisitWhen?: string;
  keywords?: string[] | string;
  project?: string;
  issueKey?: string;
  sourceUrl?: string;
  supersedes?: string;
  status?: Decision['status'];
}

const list = (v: string[] | string | undefined) =>
  (Array.isArray(v) ? v : (v ?? '').split(/[,;\n]/)).map((s) => String(s).trim()).filter(Boolean);

/** Record a decision a human stated explicitly (UI form, Rovo action, MCP tool). */
export async function recordDecision(input: ManualDecisionInput, who: { accountId: string; name: string }, source: DecisionSource): Promise<Decision> {
  const statement = String(input.statement ?? '').trim();
  if (statement.length < 8) throw new Error('A decision needs a statement of at least 8 characters.');
  const now = Date.now();
  const keywords = list(input.keywords);
  const issueRef = input.issueKey ? `:${input.issueKey}:` : ':';
  const d: Decision = {
    id: store.newId('dec'),
    statement,
    rationale: String(input.rationale ?? '').trim(),
    alternatives: list(input.alternatives),
    keywords: keywords.length ? keywords : [...new Set(tokenize(`${statement} ${list(input.scope).join(' ')}`))].slice(0, 15),
    scope: list(input.scope),
    revisitWhen: String(input.revisitWhen ?? '').trim(),
    status: input.status ?? 'active',
    ownerAccountId: who.accountId,
    ownerName: who.name,
    source,
    sourceUrl: input.sourceUrl ?? '',
    sourceRef: `${source}${issueRef}${hash(statement.toLowerCase())}`,
    sourceTitle: input.issueKey ? `Recorded on ${input.issueKey}` : 'Recorded manually',
    project: (input.project || input.issueKey?.split('-')[0] || '').toUpperCase(),
    confidence: 1,
    decidedAt: new Date().toISOString().slice(0, 10),
    createdAt: now,
    updatedAt: now,
    supersededBy: '',
    supersedes: input.supersedes ?? '',
  };
  if (d.supersedes) {
    const old = await store.getDecision(d.supersedes);
    if (!old) throw new Error(`Decision ${d.supersedes} not found.`);
    old.status = 'superseded';
    old.supersededBy = d.id;
    await store.saveDecision(old);
    for (const f of await store.listFindingsForDecision(old.id)) {
      if (f.status === 'open') {
        f.status = 'resolved';
        await store.saveFinding(f);
      }
    }
  }
  await store.saveDecision(d);
  return d;
}

/** Full lineage of a decision: what it replaced and what replaced it. */
export async function decisionLineage(id: string): Promise<Decision[]> {
  const chain: Decision[] = [];
  const seen = new Set<string>();
  let cur = await store.getDecision(id);
  while (cur && cur.supersedes && !seen.has(cur.supersedes)) {
    seen.add(cur.id);
    const prev = await store.getDecision(cur.supersedes);
    if (!prev) break;
    chain.unshift(prev);
    cur = prev;
  }
  const self = await store.getDecision(id);
  if (self) chain.push(self);
  cur = self;
  while (cur && cur.supersededBy && !seen.has(cur.supersededBy)) {
    seen.add(cur.id);
    const next = await store.getDecision(cur.supersededBy);
    if (!next) break;
    chain.push(next);
    cur = next;
  }
  return chain;
}

export interface PreviewItem {
  decision: Decision;
  judgement: Judgement;
}

/** Judge free text (a proposal, a PR description) against the log without persisting anything. */
export async function previewCheck(text: string, limit = 8): Promise<{ method: 'llm' | 'heuristic' | 'none'; items: PreviewItem[] }> {
  const active = await store.listDecisionsByStatus('active');
  const candidates = retrieveCandidates(text, active, limit, 0.8);
  if (!candidates.length) return { method: 'none', items: [] };
  const { judgements, method } = await judge(text, candidates.map((c) => c.decision), llm);
  const byId = new Map(candidates.map((c) => [c.decision.id, c.decision]));
  const order = { contradicts: 0, revisits: 1, aligned: 2, unrelated: 3 } as const;
  const items = judgements
    .filter((j) => j.relation !== 'unrelated' && byId.has(j.decisionId))
    .map((j) => ({ decision: byId.get(j.decisionId)!, judgement: j }))
    .sort((a, b) => order[a.judgement.relation] - order[b.judgement.relation] || b.judgement.confidence - a.judgement.confidence);
  return { method, items };
}

/** Keyword search over all decisions (any status), newest-first on ties. */
export async function searchDecisions(query: string, opts: { includeInactive?: boolean; limit?: number } = {}): Promise<Decision[]> {
  const pool = opts.includeInactive ? await store.listAllDecisions() : await store.listDecisionsByStatus('active');
  if (!query.trim()) return pool.slice(0, opts.limit ?? 20);
  return retrieveCandidates(query, pool, opts.limit ?? 10, 0.3).map((c) => c.decision);
}
