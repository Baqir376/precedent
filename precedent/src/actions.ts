/**
 * Rovo actions. The same functions back the Precedent Rovo agent, are exposed to any Rovo agent as
 * tools, and are served to external AI clients (Claude, Cursor, …) through the rovo:mcp module.
 * Return values are plain JSON the model can read and cite.
 */
import { checkWork, decisionLineage, previewCheck, recordDecision, searchDecisions } from './lib/engine';
import { getUserName, getWorkItem } from './lib/jira';
import * as store from './lib/store';
import { userTeams } from './lib/twg';
import type { Decision } from './lib/types';

type ActionContext = { accountId?: string; principal?: { accountId?: string }; jira?: { issueKey?: string }; context?: { jira?: { issueKey?: string } } };
type Payload = Record<string, unknown> & { context?: ActionContext };

function issueKeyFrom(payload: Payload, ctx?: ActionContext): string {
  const explicit = typeof payload.issueKey === 'string' ? payload.issueKey.trim().toUpperCase() : '';
  return explicit || payload.context?.jira?.issueKey || ctx?.jira?.issueKey || ctx?.context?.jira?.issueKey || '';
}

function accountFrom(payload: Payload, ctx?: ActionContext): string {
  return ctx?.accountId || ctx?.principal?.accountId || payload.context?.accountId || payload.context?.principal?.accountId || '';
}

function brief(d: Decision) {
  return {
    id: d.id,
    statement: d.statement,
    rationale: d.rationale,
    rejectedAlternatives: d.alternatives,
    revisitWhen: d.revisitWhen || undefined,
    owner: d.ownerName || undefined,
    decidedAt: d.decidedAt,
    status: d.status,
    source: d.sourceTitle,
    link: d.sourceUrl || undefined,
    supersededBy: d.supersededBy || undefined,
  };
}

async function safe(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function searchDecisionsAction(payload: Payload) {
  return safe(async () => {
    const query = String(payload.query ?? '').trim();
    const includeHistory = payload.includeHistory === true || payload.includeHistory === 'true';
    const hits = await searchDecisions(query, { includeInactive: includeHistory, limit: 8 });
    return { query, count: hits.length, decisions: hits.map(brief) };
  });
}

export async function checkProposalAction(payload: Payload, ctx?: ActionContext) {
  return safe(async () => {
    const issueKey = issueKeyFrom(payload, ctx);
    const text = String(payload.proposal ?? '').trim();
    if (issueKey && !text) {
      const res = await checkWork(await getWorkItem(issueKey), { allowComment: false, respectProjectFilter: false });
      const decisions = new Map((await Promise.all(res.findings.map((f) => store.getDecision(f.decisionId)))).filter(Boolean).map((d) => [d!.id, d!]));
      return {
        issueKey,
        verdict: res.findings.some((f) => f.relation === 'contradicts') ? 'conflicts-found' : res.findings.length ? 'related-decisions' : 'clear',
        findings: res.findings.map((f) => ({ relation: f.relation, confidence: f.confidence, explanation: f.explanation, suggestion: f.suggestion, decision: decisions.get(f.decisionId) && brief(decisions.get(f.decisionId)!) })),
      };
    }
    if (!text) return { error: 'Provide a proposal to check, or run this from a Jira work item.' };
    const res = await previewCheck(text);
    return {
      verdict: res.items.some((i) => i.judgement.relation === 'contradicts') ? 'conflicts-found' : res.items.length ? 'related-decisions' : 'clear',
      findings: res.items.map((i) => ({ relation: i.judgement.relation, confidence: i.judgement.confidence, explanation: i.judgement.explanation, suggestion: i.judgement.suggestion, decision: brief(i.decision) })),
    };
  });
}

export async function recordDecisionAction(payload: Payload, ctx?: ActionContext) {
  return safe(async () => {
    const accountId = accountFrom(payload, ctx);
    const name = (await getUserName(accountId)) || 'Rovo user';
    const d = await recordDecision(
      {
        statement: String(payload.statement ?? ''),
        rationale: String(payload.rationale ?? ''),
        alternatives: String(payload.rejectedAlternatives ?? ''),
        scope: String(payload.scope ?? ''),
        revisitWhen: String(payload.revisitWhen ?? ''),
        issueKey: issueKeyFrom(payload, ctx) || undefined,
        supersedes: typeof payload.supersedesId === 'string' && payload.supersedesId ? payload.supersedesId : undefined,
      },
      { accountId, name },
      'rovo',
    );
    return { recorded: brief(d), message: `Recorded decision ${d.id}${d.supersedes ? `, superseding ${d.supersedes}` : ''}.` };
  });
}

export async function decisionHistoryAction(payload: Payload) {
  return safe(async () => {
    const id = String(payload.decisionId ?? '').trim();
    let decision = id ? await store.getDecision(id) : undefined;
    if (!decision && payload.query) decision = (await searchDecisions(String(payload.query), { includeInactive: true, limit: 1 }))[0];
    if (!decision) return { error: 'No matching decision. Search first with search-decisions.' };
    const [lineage, findings, teams] = await Promise.all([decisionLineage(decision.id), store.listFindingsForDecision(decision.id), userTeams(decision.ownerAccountId)]);
    return {
      decision: brief(decision),
      ownerTeams: teams,
      lineage: lineage.map((d) => ({ id: d.id, statement: d.statement, status: d.status, decidedAt: d.decidedAt })),
      challengedBy: findings
        .filter((f) => f.relation !== 'aligned')
        .map((f) => ({ issueKey: f.issueKey, summary: f.issueSummary, relation: f.relation, status: f.status, explanation: f.explanation })),
    };
  });
}

export async function listConflictsAction(payload: Payload) {
  return safe(async () => {
    const project = String(payload.project ?? '').trim().toUpperCase();
    const open = (await store.listFindingsByStatus('open')).filter((f) => f.relation !== 'aligned' && (!project || f.project === project));
    const decisions = new Map((await Promise.all([...new Set(open.map((f) => f.decisionId))].map((id) => store.getDecision(id)))).filter(Boolean).map((d) => [d!.id, d!]));
    return {
      project: project || 'all',
      count: open.length,
      conflicts: open.slice(0, 25).map((f) => ({
        issueKey: f.issueKey,
        summary: f.issueSummary,
        relation: f.relation,
        confidence: f.confidence,
        explanation: f.explanation,
        decision: decisions.get(f.decisionId)?.statement,
        decisionOwner: decisions.get(f.decisionId)?.ownerName,
      })),
    };
  });
}
