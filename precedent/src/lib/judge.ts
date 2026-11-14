import type { Decision, Judgement, WorkItem } from './types';
import type { LlmFn } from './llm';
import { NEGATION, bm25, clamp01, parseJsonLoose, tokenize, truncate, type Searchable } from './text';

export interface DecisionDoc extends Searchable {
  decision: Decision;
}

export function toDoc(d: Decision): DecisionDoc {
  return {
    id: d.id,
    decision: d,
    fields: [
      [d.statement, 3],
      [d.keywords.join(' '), 3],
      [d.scope.join(' '), 2],
      [d.alternatives.join(' '), 2],
      [d.rationale, 1],
      [d.revisitWhen, 1],
    ],
  };
}

export function workText(w: WorkItem): string {
  return `${w.summary}\n${w.description}`;
}

/** Retrieve the decisions most likely to bear on a piece of work. */
export function retrieveCandidates(work: WorkItem | string, decisions: Decision[], limit = 8, minScore = 1.0) {
  const text = typeof work === 'string' ? work : workText(work);
  return bm25(text, decisions.map(toDoc))
    .filter((s) => s.score >= minScore)
    .slice(0, limit)
    .map((s) => ({ decision: s.item.decision, score: s.score, matched: s.matched }));
}

const SYSTEM = `You are Precedent, a reviewer that protects a software organisation's past decisions.
You get one piece of NEW WORK (a Jira work item or a proposal) and a list of PAST DECISIONS.
For each decision, classify how the new work relates to it:
- "contradicts": doing the work as written would violate or silently undo the decision
  (e.g. decision "no Redis for sessions" vs work "add Redis session cache").
- "revisits": the work explicitly proposes reconsidering the decision, or a stated revisit condition now appears to hold.
- "aligned": the work implements or clearly follows the decision.
- "unrelated": no meaningful bearing. Shared words alone are NOT a relation.
Be strict: only say "contradicts" when a reasonable engineer would agree. Prefer "unrelated" when unsure.

Return ONLY JSON: {"judgements":[{"decisionId":"...","relation":"contradicts|revisits|aligned|unrelated",
"confidence":0.0-1.0,"explanation":"one or two sentences quoting the specific conflict",
"suggestion":"one concrete next step, e.g. 'Talk to Priya (decision owner) or record a superseding decision.'"}]}
Include every decision id exactly once.`;

function decisionBlock(d: Decision): string {
  return [
    `id: ${d.id}`,
    `statement: ${d.statement}`,
    d.rationale && `rationale: ${truncate(d.rationale, 400)}`,
    d.alternatives.length ? `rejected alternatives: ${d.alternatives.join('; ')}` : '',
    d.scope.length ? `scope: ${d.scope.join(', ')}` : '',
    d.revisitWhen && `revisit when: ${d.revisitWhen}`,
    d.ownerName && `owner: ${d.ownerName}`,
    d.decidedAt && `decided: ${d.decidedAt}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const REVISIT_CUE = /\b(revisit|reconsider|re-?open|re-?evaluate|replace|migrate (off|away)|switch (from|to)|move (off|away from)|instead of)\b/i;

/**
 * Rule-based judge used when no model is reachable. It flags a contradiction when the work names a
 * rejected alternative, or when the decision is a prohibition and the work names its subject.
 */
export function heuristicJudge(work: WorkItem | string, decisions: Decision[]): Judgement[] {
  const text = typeof work === 'string' ? work : workText(work);
  const wTokens = new Set(tokenize(text));
  return decisions.map((d) => {
    const altHits = d.alternatives.filter((a) => {
      const t = tokenize(a);
      return t.length > 0 && t.every((x) => wTokens.has(x));
    });
    const kwHits = d.keywords.filter((k) => tokenize(k).some((x) => wTokens.has(x)));
    // Split "Do not use Redis for sessions; use Postgres instead" into the prohibited clause
    // ("Redis for sessions") and the endorsed remainder ("Postgres"), so naming the endorsed
    // option is not mistaken for a contradiction.
    const m = d.statement.match(NEGATION);
    let negTerms: string[] = [];
    if (m && m.index !== undefined) {
      const after = d.statement.slice(m.index + m[0].length);
      const [prohibited, ...rest] = after.split(/[;.]|,\s*(?=use|instead|prefer|go with)|\b(?:use|prefer)\b(?=.*\binstead\b)/i);
      const endorsed = new Set(tokenize(rest.join(' ') + ' ' + d.statement.slice(0, m.index)));
      const generic = new Set(tokenize(d.scope.join(' ')));
      negTerms = tokenize(prohibited ?? '').filter((t) => t.length > 2 && wTokens.has(t) && !endorsed.has(t) && !generic.has(t));
    }

    if (REVISIT_CUE.test(text) && kwHits.length >= 2) {
      return {
        decisionId: d.id,
        relation: 'revisits' as const,
        confidence: 0.5,
        explanation: `This work proposes a change in an area governed by "${truncate(d.statement, 120)}".`,
        suggestion: `Confirm with ${d.ownerName || 'the decision owner'} and record a superseding decision if it changes.`,
      };
    }
    if (altHits.length || negTerms.length >= 1) {
      const what = altHits[0] ?? negTerms.join(', ');
      return {
        decisionId: d.id,
        relation: 'contradicts' as const,
        confidence: altHits.length ? 0.65 : 0.55,
        explanation: `The work mentions "${what}", which the decision "${truncate(d.statement, 120)}" ruled out.`,
        suggestion: `Check the rationale with ${d.ownerName || 'the decision owner'} before starting.`,
      };
    }
    if (kwHits.length >= 3) {
      return {
        decisionId: d.id,
        relation: 'aligned' as const,
        confidence: 0.4,
        explanation: `Touches the same area (${kwHits.slice(0, 3).join(', ')}).`,
        suggestion: 'Keep the decision in mind while implementing.',
      };
    }
    return { decisionId: d.id, relation: 'unrelated' as const, confidence: 0.3, explanation: '', suggestion: '' };
  });
}

export async function judge(
  work: WorkItem | string,
  candidates: Decision[],
  llm?: LlmFn,
): Promise<{ judgements: Judgement[]; method: 'llm' | 'heuristic' }> {
  if (!candidates.length) return { judgements: [], method: 'heuristic' };
  if (llm) {
    const workBlock =
      typeof work === 'string'
        ? truncate(work, 6000)
        : `key: ${work.key}\nsummary: ${work.summary}\ndescription:\n${truncate(work.description, 6000)}`;
    const user = `NEW WORK:\n${workBlock}\n\nPAST DECISIONS:\n${candidates.map(decisionBlock).join('\n---\n')}`;
    const reply = await llm(SYSTEM, user, 2000);
    const parsed = reply ? parseJsonLoose<{ judgements?: Partial<Judgement>[] }>(reply) : undefined;
    if (parsed && Array.isArray(parsed.judgements)) {
      const ids = new Set(candidates.map((c) => c.id));
      const relations = new Set(['contradicts', 'revisits', 'aligned', 'unrelated']);
      const judgements = parsed.judgements
        .filter((j) => j && ids.has(String(j.decisionId)) && relations.has(String(j.relation)))
        .map((j) => ({
          decisionId: String(j.decisionId),
          relation: j.relation as Judgement['relation'],
          confidence: clamp01(j.confidence, 0.5),
          explanation: truncate(String(j.explanation ?? ''), 600),
          suggestion: truncate(String(j.suggestion ?? ''), 300),
        }));
      return { judgements, method: 'llm' };
    }
  }
  return { judgements: heuristicJudge(work, candidates), method: 'heuristic' };
}
