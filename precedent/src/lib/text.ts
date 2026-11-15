/**
 * Pure text utilities: tokenising, stemming, ADF / storage-format flattening and BM25 retrieval.
 * No Forge imports so this module is unit-testable with plain Node.
 */

const STOPWORDS = new Set(
  (
    'a an and are as at be been being but by can could did do does doing for from had has have having he her ' +
    'here him his how i if in into is it its just me more most my no nor not now of off on once only or other ' +
    'our out over own same she should so some such than that the their them then there these they this those ' +
    'through to too under until up very was we were what when where which while who whom why will with would ' +
    'you your yours also any all each few both via per use using used get got make let lets need needs want ' +
    'should shall may might must issue ticket task story please thanks team'
  ).split(/\s+/),
);

/** Negation / prohibition cues, used by the heuristic judge. */
export const NEGATION = /\b(not|never|no longer|avoid|don'?t|do not|won'?t|will not|ban(ned)?|forbid(den)?|reject(ed)?|ruled out|deprecat(e|ed)|stop using|instead of|against)\b/i;

/** Cues that a piece of text records a decision. */
export const DECISION_CUE =
  /\b(we('ve| have)? decided|decision:|decided to|decided against|we will|we won'?t|we are going with|going forward|agreed( to| that)?|ruled out|ADR[- ]?\d*|we chose|chosen|our standard is|must always|must never|policy:)/i;

/** Light suffix stemmer — enough to align "caching"/"cached"/"cache". */
export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  for (const suf of ['ing', 'ed', 'es', 's', 'ly']) {
    if (w.length > suf.length + 3 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

const PUNCT = new Set(['.', '+', '-']);

/** Strip leading/trailing ".", "+", "-" in linear time (a regex here is open to ReDoS). */
function trimPunct(t: string): string {
  let start = 0;
  let end = t.length;
  while (start < end && PUNCT.has(t[start])) start++;
  while (end > start && PUNCT.has(t[end - 1])) end--;
  return t.slice(start, end);
}

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[`*_>#\[\](){}"“”'’]/g, ' ')
    .split(/[^a-z0-9.+-]+/)
    .map(trimPunct)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** Flatten Atlassian Document Format to plain text. */
export function adfToText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> };
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'mention') return String(n.attrs?.text ?? '@user');
  if (n.type === 'inlineCard' || n.type === 'blockCard') return String(n.attrs?.url ?? '');
  const inner = (n.content ?? []).map(adfToText).join('');
  const block = ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableRow', 'panel', 'decisionItem', 'taskItem'];
  return block.includes(n.type ?? '') ? inner + '\n' : inner;
}

/** Flatten Confluence storage format (XHTML) to plain text. */
export function storageToText(xhtml: string): string {
  return (xhtml || '')
    .replace(/<ac:structured-macro[^>]*ac:name="(code|noformat)"[\s\S]*?<\/ac:structured-macro>/g, ' ')
    .replace(/<(br|\/p|\/li|\/h\d|\/tr|\/ac:task|\/ac:adf-node)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    // Decode entities in one pass so "&amp;lt;" becomes "&lt;", not "<".
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e])
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text || '';
  return text.slice(0, max - 1).trimEnd() + '…';
}

/** Small, stable, non-crypto hash (FNV-1a) for de-duplication keys. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export interface Searchable {
  id: string;
  /** Weighted fields: text and weight multiplier. */
  fields: Array<[string, number]>;
}

export interface Scored<T> {
  item: T;
  score: number;
  matched: string[];
}

/**
 * BM25 over weighted fields. Field weights multiply term frequency, so a hit in
 * `keywords` counts more than a hit buried in the rationale.
 */
export function bm25<T extends Searchable>(query: string, docs: T[], opts: { k1?: number; b?: number } = {}): Scored<T>[] {
  const k1 = opts.k1 ?? 1.2;
  const b = opts.b ?? 0.75;
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length || !docs.length) return [];

  const docTf = docs.map((d) => {
    const tf = new Map<string, number>();
    let len = 0;
    for (const [text, weight] of d.fields) {
      for (const t of tokenize(text)) {
        tf.set(t, (tf.get(t) ?? 0) + weight);
        len += weight;
      }
    }
    return { tf, len };
  });
  const avgLen = docTf.reduce((s, d) => s + d.len, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const { tf } of docTf) for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);

  const N = docs.length;
  const out: Scored<T>[] = [];
  docs.forEach((doc, i) => {
    const { tf, len } = docTf[i];
    let score = 0;
    const matched: string[] = [];
    for (const q of qTerms) {
      const f = tf.get(q);
      if (!f) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen)));
      matched.push(q);
    }
    if (score > 0) out.push({ item: doc, score, matched });
  });
  return out.sort((a, b2) => b2.score - a.score);
}

/** Extract the first JSON object/array from an LLM reply (tolerates code fences and prose). */
export function parseJsonLoose<T>(raw: string): T | undefined {
  if (!raw) return undefined;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.search(/[[{]/);
  if (start < 0) return undefined;
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try {
        return JSON.parse(candidate.slice(start, i + 1)) as T;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function clamp01(n: unknown, fallback = 0.5): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

export function asStringArray(v: unknown, max = 12): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).slice(0, max);
  if (typeof v === 'string' && v.trim()) return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, max);
  return [];
}
