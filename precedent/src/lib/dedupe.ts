import type { Decision, ExtractedDecision } from './types';
import type { LlmFn } from './llm';
import { retrieveCandidates } from './judge';
import { parseJsonLoose, tokenize } from './text';

export function jaccard(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const SYSTEM = `You compare a NEW decision with EXISTING decisions from a team's decision log.
Answer whether NEW is the same decision as one of them: the same choice about the same subject, even if worded
differently or with more detail. A decision that changes, narrows, widens or reverses an existing one is NOT a duplicate.
Return ONLY JSON: {"duplicateOf": "<existing id>" | null}`;

/**
 * Find an existing decision that says the same thing as a newly extracted one. Wording differs between
 * sources ("Use LaunchDarkly for all flags" vs "Feature flags live in LaunchDarkly"), so lexical overlap only
 * selects candidates; the model decides. Without a model, a strict overlap threshold is used.
 */
export async function findDuplicate(x: ExtractedDecision, pool: Decision[], llm?: LlmFn): Promise<Decision | undefined> {
  const text = `${x.statement} ${x.keywords.join(' ')}`;
  const candidates = retrieveCandidates(text, pool, 3, 1.0).map((c) => c.decision);
  if (!candidates.length) return undefined;

  const lexical = candidates.find((d) => jaccard(d.statement, x.statement) >= 0.75);
  if (lexical) return lexical;

  if (llm) {
    const user = `NEW:\n${x.statement}\n${x.rationale ? `rationale: ${x.rationale}` : ''}\n\nEXISTING:\n${candidates
      .map((d) => `id: ${d.id}\nstatement: ${d.statement}`)
      .join('\n---\n')}`;
    const reply = await llm(SYSTEM, user, 200);
    const parsed = reply ? parseJsonLoose<{ duplicateOf?: string | null }>(reply) : undefined;
    if (parsed && 'duplicateOf' in parsed) return candidates.find((d) => d.id === parsed.duplicateOf);
  }
  // No model answer: fall back to overlap of statement and keywords.
  return candidates.find((d) => jaccard(`${d.statement} ${d.keywords.join(' ')}`, text) >= 0.5);
}
