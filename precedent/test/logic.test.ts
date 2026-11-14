import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bm25, tokenize, adfToText, storageToText, parseJsonLoose, stem } from '../src/lib/text';
import { heuristicExtract, extractDecisions } from '../src/lib/extract';
import { heuristicJudge, judge, retrieveCandidates } from '../src/lib/judge';
import type { Decision, WorkItem } from '../src/lib/types';

const dec = (id: string, p: Partial<Decision>): Decision => ({
  id, statement: '', rationale: '', alternatives: [], keywords: [], scope: [], revisitWhen: '', status: 'active',
  ownerAccountId: '', ownerName: 'Priya', source: 'sample', sourceUrl: '', sourceRef: `sample:${id}`, sourceTitle: '',
  project: '', confidence: 1, decidedAt: '2026-01-01', createdAt: 1, updatedAt: 1, supersededBy: '', supersedes: '', ...p,
});

const LOG: Decision[] = [
  dec('redis', { statement: 'Do not store user sessions in Redis; keep sessions in the Postgres sessions table.', alternatives: ['Redis', 'Memcached'], keywords: ['redis', 'session', 'cache', 'login'], scope: ['sessions'] }),
  dec('graphql', { statement: 'External APIs are REST with OpenAPI specs; do not add new GraphQL endpoints for partners.', alternatives: ['GraphQL'], keywords: ['graphql', 'rest', 'api', 'partner'] }),
  dec('utc', { statement: 'Store all timestamps as UTC timestamptz and convert to local time only in the UI.', keywords: ['timestamp', 'utc', 'timezone'] }),
  dec('search', { statement: 'Use Postgres full-text search for the catalog instead of Elasticsearch.', alternatives: ['Elasticsearch'], keywords: ['search', 'elasticsearch', 'catalog'], revisitWhen: 'Catalog exceeds 5 million rows.' }),
];

const work = (summary: string, description = ''): WorkItem => ({ key: 'PAY-1', summary, description, project: 'PAY' });

test('stem and tokenize normalise forms and drop stopwords', () => {
  assert.equal(stem('caching'), stem('cached'));
  assert.deepEqual(tokenize('The Sessions are cached'), ['session', 'cach']);
});

test('bm25 ranks the most relevant document first', () => {
  const docs = LOG.map((d) => ({ id: d.id, fields: [[d.statement, 3], [d.keywords.join(' '), 3]] as Array<[string, number]> }));
  const r = bm25('redis session cache for login', docs);
  assert.equal(r[0].item.id, 'redis');
});

test('retrieveCandidates finds the governing decision and ignores unrelated text', () => {
  assert.equal(retrieveCandidates(work('Add Redis cache for user sessions'), LOG)[0].decision.id, 'redis');
  assert.equal(retrieveCandidates(work('Update the onboarding illustration colours'), LOG).length, 0);
});

test('heuristic judge flags a rejected alternative as a contradiction', () => {
  const [j] = heuristicJudge(work('Add Redis cache for user sessions to cut login latency'), [LOG[0]]);
  assert.equal(j.relation, 'contradicts');
});

test('heuristic judge does not flag work that uses the endorsed option', () => {
  const [j] = heuristicJudge(work('Add index to Postgres sessions table'), [LOG[0]]);
  assert.notEqual(j.relation, 'contradicts');
});

test('heuristic judge detects a revisit', () => {
  const [j] = heuristicJudge(work('Revisit catalog search engine: move to Elasticsearch', 'catalog has 6M rows, search is slow'), [LOG[3]]);
  assert.equal(j.relation, 'revisits');
});

test('heuristic judge marks aligned work', () => {
  const [j] = heuristicJudge(work('Convert renewal job timestamps to UTC timestamptz', 'use utc timestamp and timezone conversion in UI'), [LOG[2]]);
  assert.equal(j.relation, 'aligned');
});

test('judge uses LLM output, drops unknown ids and invalid relations', async () => {
  const llm = async () => '```json\n{"judgements":[{"decisionId":"redis","relation":"contradicts","confidence":0.92,"explanation":"x","suggestion":"y"},{"decisionId":"bogus","relation":"contradicts","confidence":1},{"decisionId":"graphql","relation":"maybe","confidence":1}]}\n```';
  const r = await judge(work('Redis sessions'), [LOG[0], LOG[1]], llm);
  assert.equal(r.method, 'llm');
  assert.equal(r.judgements.length, 1);
  assert.equal(r.judgements[0].confidence, 0.92);
});

test('judge falls back to heuristics when the model is unavailable or replies garbage', async () => {
  assert.equal((await judge(work('Redis session cache'), [LOG[0]], async () => undefined)).method, 'heuristic');
  assert.equal((await judge(work('Redis session cache'), [LOG[0]], async () => 'sorry, I cannot')).method, 'heuristic');
});

test('heuristic extraction picks explicit decisions with rationale, skips questions', () => {
  const text = 'Quick update. We decided to keep sessions in Postgres instead of Redis because Redis is outside PCI scope. Should we also move carts? Thanks all.';
  const out = heuristicExtract(text);
  assert.equal(out.length, 1);
  assert.match(out[0].statement, /Postgres/);
  assert.match(out[0].rationale, /PCI/);
});

test('extractDecisions normalises LLM output', async () => {
  const llm = async () => '{"decisions":[{"statement":"Use Stripe only via payments-gateway.","keywords":"Stripe, Payments","confidence":"0.9","decidedAt":"March"},{"statement":"x"}]}';
  const r = await extractDecisions('some text', { author: 'Priya', date: '2026-02-01' }, llm);
  assert.equal(r.method, 'llm');
  assert.equal(r.decisions.length, 1);
  assert.deepEqual(r.decisions[0].keywords, ['stripe', 'payments']);
  assert.equal(r.decisions[0].decidedAt, '2026-02-01');
  assert.equal(r.decisions[0].ownerName, 'Priya');
});

test('adf and storage format flatten to text', () => {
  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We decided' }, { type: 'mention', attrs: { text: '@Priya' } }] }] };
  assert.equal(adfToText(adf).trim(), 'We decided@Priya');
  assert.equal(storageToText('<p>A&amp;B</p><p>C</p>'), 'A&B\nC');
});

test('parseJsonLoose handles prose and nested braces in strings', () => {
  assert.deepEqual(parseJsonLoose('Here you go: {"a":"} tricky","b":[1]} done'), { a: '} tricky', b: [1] });
});
