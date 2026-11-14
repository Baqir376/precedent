import type { ExtractedDecision } from './types';
import type { LlmFn } from './llm';
import { DECISION_CUE, asStringArray, clamp01, parseJsonLoose, tokenize, truncate } from './text';

const SYSTEM = `You extract DECISIONS from workplace text (Jira comments, Confluence pages, meeting notes).
A decision is a choice the team has actually MADE that should constrain future work: a technology choice,
an architectural rule, a policy, a scope cut, a vendor choice, a "we will not do X".
NOT decisions: open questions, proposals still under discussion, status updates, tasks, opinions of one person
that nobody agreed to.

Return ONLY JSON: {"decisions":[{
  "statement": "one imperative sentence a newcomer understands without context, e.g. 'Do not store user sessions in Redis; use the Postgres session table.'",
  "rationale": "why, in 1-2 sentences, from the text only",
  "alternatives": ["options that were considered and rejected"],
  "keywords": ["8-15 lowercase search terms incl. synonyms and product names, e.g. 'redis','cache','session store','in-memory'"],
  "scope": ["systems/components/areas it applies to"],
  "revisitWhen": "condition under which to reconsider, if stated, else ''",
  "ownerName": "who made or announced the decision, if stated, else ''",
  "decidedAt": "YYYY-MM-DD if stated, else ''",
  "confidence": 0.0-1.0 that this is a real, agreed decision
}]}
Return {"decisions":[]} if there are none. Never invent facts not in the text. Maximum 8 decisions.`;

export interface ExtractMeta {
  title?: string;
  author?: string;
  date?: string;
}

function normalise(raw: Partial<ExtractedDecision>, meta: ExtractMeta): ExtractedDecision | undefined {
  const statement = String(raw.statement ?? '').trim();
  if (statement.length < 8) return undefined;
  const keywords = asStringArray(raw.keywords, 20).map((k) => k.toLowerCase());
  return {
    statement: truncate(statement, 400),
    rationale: truncate(String(raw.rationale ?? '').trim(), 800),
    alternatives: asStringArray(raw.alternatives, 8),
    keywords: keywords.length ? keywords : [...new Set(tokenize(statement))].slice(0, 12),
    scope: asStringArray(raw.scope, 8),
    revisitWhen: truncate(String(raw.revisitWhen ?? '').trim(), 300),
    ownerName: String(raw.ownerName ?? '').trim() || meta.author || '',
    decidedAt: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.decidedAt ?? '')) ? String(raw.decidedAt) : meta.date ?? '',
    confidence: clamp01(raw.confidence, 0.7),
  };
}

/** Rule-based extraction used when no model is reachable: sentences with explicit decision cues. */
export function heuristicExtract(text: string, meta: ExtractMeta = {}): ExtractedDecision[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z@"(])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: ExtractedDecision[] = [];
  for (let i = 0; i < sentences.length && out.length < 5; i++) {
    const s = sentences[i];
    if (!DECISION_CUE.test(s) || s.length < 20 || s.endsWith('?')) continue;
    const next = sentences[i + 1] ?? '';
    const because = /\b(because|since|due to|as it|so that|the reason)\b/i;
    const rationale = because.test(s) ? s.split(because).slice(1).join(' ').trim() : because.test(next) ? next : '';
    const alternatives = [...s.matchAll(/\b(?:instead of|rather than|over|not)\s+([A-Z][\w.+-]*(?:\s[A-Z][\w.+-]*)?)/g)].map((m) => m[1]);
    const d = normalise(
      {
        statement: s.replace(/^(so|ok|okay|update|decision)[:,]?\s*/i, ''),
        rationale,
        alternatives,
        keywords: [...new Set(tokenize(s + ' ' + rationale))].slice(0, 12),
        confidence: 0.5,
      },
      meta,
    );
    if (d) out.push(d);
  }
  return out;
}

export async function extractDecisions(text: string, meta: ExtractMeta, llm?: LlmFn): Promise<{ decisions: ExtractedDecision[]; method: 'llm' | 'heuristic' }> {
  const clean = truncate(text.trim(), 24000);
  if (!clean) return { decisions: [], method: 'heuristic' };
  if (llm) {
    const header = [meta.title && `Title: ${meta.title}`, meta.author && `Author: ${meta.author}`, meta.date && `Date: ${meta.date}`]
      .filter(Boolean)
      .join('\n');
    const reply = await llm(SYSTEM, `${header}\n\n<text>\n${clean}\n</text>`, 2500);
    const parsed = reply ? parseJsonLoose<{ decisions?: Partial<ExtractedDecision>[] }>(reply) : undefined;
    if (parsed && Array.isArray(parsed.decisions)) {
      const decisions = parsed.decisions.map((d) => normalise(d, meta)).filter((d): d is ExtractedDecision => !!d);
      return { decisions, method: 'llm' };
    }
  }
  return { decisions: heuristicExtract(clean, meta), method: 'heuristic' };
}
