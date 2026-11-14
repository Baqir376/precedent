import type { Decision } from './types';
import { newId, saveDecision, listDecisionsByStatus, deleteDecision } from './store';

/**
 * Sample decision log for a fictional payments company, so judges and new installs can see
 * Precedent working in minutes. Every sample decision is tagged source "sample" and can be removed.
 */
type Seed = Omit<Decision, 'id' | 'createdAt' | 'updatedAt' | 'supersededBy' | 'supersedes' | 'source' | 'sourceRef' | 'confidence' | 'status' | 'ownerAccountId' | 'sourceUrl'>;

const SEEDS: Seed[] = [
  {
    statement: 'Do not store user sessions in Redis; keep sessions in the Postgres sessions table.',
    rationale: 'Session tokens are in PCI DSS scope. Our Redis cluster sits outside the audited cardholder data environment, and bringing it in scope would add a second annual audit.',
    alternatives: ['Redis', 'Memcached', 'Stateless JWT-only sessions'],
    keywords: ['redis', 'session', 'session store', 'cache', 'in-memory', 'login', 'auth', 'pci', 'memcached', 'jwt'],
    scope: ['auth-service', 'sessions'],
    revisitWhen: 'Redis Enterprise inside the CDE receives PCI attestation.',
    ownerName: 'Priya Shah',
    sourceTitle: 'ADR-007: Session storage',
    project: '',
    decidedAt: '2026-03-12',
  },
  {
    statement: 'External APIs are REST with OpenAPI specs; do not add new GraphQL endpoints for partners.',
    rationale: 'Partners integrate with generated SDKs from our OpenAPI spec. A second API style doubles auth, rate-limiting and docs work for a 4-person platform team.',
    alternatives: ['GraphQL', 'GraphQL federation', 'gRPC for partners'],
    keywords: ['graphql', 'rest', 'openapi', 'api', 'partner', 'endpoint', 'sdk', 'schema', 'federation'],
    scope: ['public-api', 'partner integrations'],
    revisitWhen: 'More than 30% of partners request GraphQL, or the platform team grows beyond 8 engineers.',
    ownerName: 'Marcus Chen',
    sourceTitle: 'ADR-011: API style for partners',
    project: '',
    decidedAt: '2026-05-04',
  },
  {
    statement: 'Never log customer PII or full request payloads; all services must use the redaction middleware.',
    rationale: 'A 2025 incident leaked card holder names through debug logs shipped to a third-party log vendor. Redaction at the middleware layer is enforced in code review.',
    alternatives: ['Log sampling', 'Debug logging in production', 'Logging full payloads behind a flag'],
    keywords: ['logging', 'logs', 'pii', 'payload', 'debug', 'redaction', 'personal data', 'request body', 'observability', 'gdpr'],
    scope: ['all services', 'observability'],
    revisitWhen: '',
    ownerName: 'Aisha Bello',
    sourceTitle: 'Post-mortem: INC-2291 PII in logs',
    project: '',
    decidedAt: '2025-11-20',
  },
  {
    statement: 'Use Postgres full-text search with pg_trgm for the product catalog instead of Elasticsearch.',
    rationale: 'Elasticsearch would need a dedicated on-call rotation. Postgres handles our 1.8M catalog rows with p95 under 80 ms.',
    alternatives: ['Elasticsearch', 'OpenSearch', 'Algolia'],
    keywords: ['search', 'elasticsearch', 'opensearch', 'algolia', 'catalog', 'full-text', 'pg_trgm', 'postgres', 'indexing'],
    scope: ['catalog-service', 'search'],
    revisitWhen: 'Catalog exceeds 5 million rows or search p95 exceeds 300 ms.',
    ownerName: 'Daniel Okafor',
    sourceTitle: 'ADR-014: Catalog search engine',
    project: '',
    decidedAt: '2026-01-28',
  },
  {
    statement: 'Only the payments-gateway service may call Stripe; other services must go through its internal API.',
    rationale: 'Centralising Stripe calls keeps idempotency keys, retries and webhook handling in one place and limits who holds the Stripe secret key.',
    alternatives: ['Direct Stripe SDK calls from each service'],
    keywords: ['stripe', 'payments', 'payment provider', 'sdk', 'charge', 'refund', 'webhook', 'gateway', 'secret key'],
    scope: ['payments-gateway', 'billing'],
    revisitWhen: '',
    ownerName: 'Priya Shah',
    sourceTitle: 'Architecture review, 2026-02',
    project: '',
    decidedAt: '2026-02-17',
  },
  {
    statement: 'No production deploys after 14:00 on Fridays or during the December 15 to January 5 freeze.',
    rationale: 'Holiday traffic is 4x normal and weekend on-call is thin. Two of our last three Sev-1s came from Friday afternoon deploys.',
    alternatives: ['Deploy any time with feature flags'],
    keywords: ['deploy', 'release', 'freeze', 'friday', 'production', 'holiday', 'rollout', 'change freeze', 'go-live'],
    scope: ['release process'],
    revisitWhen: 'Automated canary rollback covers all tier-1 services.',
    ownerName: 'Aisha Bello',
    sourceTitle: 'Release policy v3',
    project: '',
    decidedAt: '2026-04-02',
  },
  {
    statement: 'Store all timestamps as UTC timestamptz and convert to local time only in the UI.',
    rationale: 'Mixed local timestamps caused double-charged subscriptions at DST changes in 2025.',
    alternatives: ['Store local time with offset', 'Unix epoch integers'],
    keywords: ['timestamp', 'timezone', 'utc', 'datetime', 'dst', 'date', 'local time', 'timestamptz'],
    scope: ['all databases'],
    revisitWhen: '',
    ownerName: 'Marcus Chen',
    sourceTitle: 'Engineering standards',
    project: '',
    decidedAt: '2025-10-09',
  },
  {
    statement: 'User-facing feature flags live in LaunchDarkly; do not add environment-variable flags for product features.',
    rationale: 'Env flags need a redeploy to change and are invisible to product managers, which delayed the March pricing rollback by 40 minutes.',
    alternatives: ['Environment variables', 'Config file flags', 'Unleash self-hosted'],
    keywords: ['feature flag', 'launchdarkly', 'toggle', 'env var', 'environment variable', 'config', 'rollout', 'experiment'],
    scope: ['product features'],
    revisitWhen: 'LaunchDarkly contract renewal in 2027.',
    ownerName: 'Daniel Okafor',
    sourceTitle: 'ADR-009: Feature flags',
    project: '',
    decidedAt: '2026-03-30',
  },
  {
    statement: 'Mobile apps support iOS 16+ and Android 10+ only.',
    rationale: 'Older versions are under 2% of active users and block use of passkeys.',
    alternatives: ['Support iOS 15', 'Support Android 8'],
    keywords: ['ios', 'android', 'mobile', 'minimum version', 'os support', 'passkeys', 'app store'],
    scope: ['mobile apps'],
    revisitWhen: 'Annually each September.',
    ownerName: 'Lena Fischer',
    sourceTitle: 'Mobile platform review',
    project: '',
    decidedAt: '2026-09-15',
  },
  {
    statement: 'Retry payment provider calls at most 3 times with exponential backoff and never retry 4xx responses.',
    rationale: 'Unbounded retries on declined cards triggered fraud flags with our acquirer.',
    alternatives: ['Unlimited retries', 'Fixed-interval retries'],
    keywords: ['retry', 'backoff', 'payment', 'provider', 'decline', '4xx', 'timeout', 'idempotency', 'resilience'],
    scope: ['payments-gateway'],
    revisitWhen: '',
    ownerName: 'Priya Shah',
    sourceTitle: 'Payments reliability review',
    project: '',
    decidedAt: '2026-06-11',
  },
];

export const DEMO_ISSUES = [
  {
    summary: 'Add Redis cache for user sessions to cut login latency',
    description:
      'Login p95 is 420 ms because every request reads the sessions table in Postgres.\n\nProposal: put sessions in our existing Redis cluster with a 30 minute TTL. Should take two days.',
  },
  {
    summary: 'Expose a GraphQL endpoint for the partner dashboard',
    description: 'Partners want to fetch merchants, payouts and disputes in one request. Let us add a GraphQL endpoint next to the REST API.',
  },
  {
    summary: 'Log full checkout request payloads to debug intermittent failures',
    description: 'Checkout fails for about 0.3% of users and we cannot reproduce it. Turn on debug logging of the full request body in production for a week.',
  },
  {
    summary: 'Move catalog search to Elasticsearch now that we have 6.2M products',
    description: 'The catalog passed 6 million rows last month and search p95 is now 410 ms. Time to revisit the search engine choice.',
  },
  {
    summary: 'Convert subscription renewal job to use UTC timestamptz columns',
    description: 'The renewal job still reads local-time columns. Migrate them to timestamptz in UTC and convert in the UI.',
  },
];

export async function seedSampleDecisions(): Promise<number> {
  const existing = await listDecisionsByStatus('active');
  const have = new Set(existing.filter((d) => d.source === 'sample').map((d) => d.statement));
  let n = 0;
  const base = Date.now();
  for (const [i, s] of SEEDS.entries()) {
    if (have.has(s.statement)) continue;
    const ts = base - i * 1000;
    await saveDecision({
      ...s,
      id: newId('dec'),
      status: 'active',
      source: 'sample',
      sourceRef: `sample:${i}`,
      sourceUrl: '',
      ownerAccountId: '',
      confidence: 1,
      createdAt: ts,
      updatedAt: ts,
      supersededBy: '',
      supersedes: '',
    });
    n++;
  }
  return n;
}

export async function removeSampleDecisions(): Promise<number> {
  let n = 0;
  for (const status of ['active', 'proposed', 'superseded', 'reversed'] as const) {
    for (const d of await listDecisionsByStatus(status)) {
      if (d.source === 'sample') {
        await deleteDecision(d.id);
        n++;
      }
    }
  }
  return n;
}
