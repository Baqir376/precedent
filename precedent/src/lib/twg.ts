import api from '@forge/api';
import { DECISION_CUE, storageToText } from './text';

/**
 * Teamwork Graph reads. Every call runs as the current user (TWG only supports user context),
 * so results are permission-filtered for whoever is using Precedent.
 */

export interface GraphPage {
  ari: string;
  pageId: string;
  title: string;
  url: string;
  lastUpdatedAt: string;
  text: string;
  /** Heuristic: does the page look like it records decisions? */
  looksLikeDecision: boolean;
}

interface GqlResult<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<GqlResult<T>> {
  const res = await api.asUser().requestTeamworkGraph(query, variables);
  const body = (await res.json()) as GqlResult<T>;
  if (body.errors?.length) console.warn('[precedent] TWG errors', JSON.stringify(body.errors).slice(0, 800));
  return body;
}

export const userAri = (accountId: string) => `ari:cloud:identity::user/${accountId}`;

const RECENT_PAGES = `
query precedent_recentPages($userId: ID!, $since: String!, $after: String) {
  atlassianUserRecentlyViewed(userId: $userId, since: $since, first: 25, after: $after) {
    edges {
      node {
        __typename
        ... on ConfluencePage {
          id
          pageId
          title
          webUrl
          lastUpdatedAt
          content { storage { value } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

type Edge = { node?: { __typename?: string; id?: string; pageId?: string; title?: string; webUrl?: string; lastUpdatedAt?: string; content?: { storage?: { value?: string } } } };
type RecentData = { atlassianUserRecentlyViewed?: { edges?: Edge[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string } } };

const DECISION_TITLE = /\b(decision|decisions|ADR|RFC|architecture|design doc|tech spec|retro|post-?mortem|meeting notes|policy|standard)\b/i;

/** Confluence pages the current user has touched recently, with bodies, via Teamwork Graph. */
export async function recentConfluencePages(accountId: string, since = 'P90D', maxPages = 3): Promise<{ pages: GraphPage[]; errors: string[] }> {
  const pages: GraphPage[] = [];
  const errors: string[] = [];
  let after: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const res = await gql<RecentData>(RECENT_PAGES, { userId: userAri(accountId), since, after });
    errors.push(...(res.errors ?? []).map((e) => e.message));
    const conn = res.data?.atlassianUserRecentlyViewed;
    for (const edge of conn?.edges ?? []) {
      const n = edge.node;
      if (!n || n.__typename !== 'ConfluencePage' || !n.id) continue;
      const text = storageToText(n.content?.storage?.value ?? '');
      pages.push({
        ari: n.id,
        pageId: n.pageId ?? n.id.split('/').pop() ?? n.id,
        title: n.title ?? 'Untitled page',
        url: n.webUrl ?? '',
        lastUpdatedAt: n.lastUpdatedAt ?? '',
        text,
        looksLikeDecision: DECISION_TITLE.test(n.title ?? '') || DECISION_CUE.test(text),
      });
    }
    if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  const seen = new Set<string>();
  return { pages: pages.filter((p) => (seen.has(p.ari) ? false : (seen.add(p.ari), true))), errors };
}

const PAGE_OWNERS = `
query precedent_pageOwners($id: ID!) {
  confluencePageOwners(id: $id, first: 5) {
    edges { node { __typename ... on AtlassianUser { id displayName } } }
  }
}`;

/** Owners of a Confluence page (best effort) — used as the decision owner when the text names nobody. */
export async function pageOwners(pageAri: string): Promise<Array<{ accountId: string; name: string }>> {
  try {
    const res = await gql<{ confluencePageOwners?: { edges?: Array<{ node?: { id?: string; displayName?: string } }> } }>(PAGE_OWNERS, { id: pageAri });
    return (res.data?.confluencePageOwners?.edges ?? [])
      .map((e) => ({ accountId: (e.node?.id ?? '').split('/').pop() ?? '', name: e.node?.displayName ?? '' }))
      .filter((u) => u.name);
  } catch (err) {
    console.warn('[precedent] pageOwners failed', String(err));
    return [];
  }
}

const USER_TEAMS = `
query precedent_userTeams($userId: ID!) {
  atlassianUserInTeams(userId: $userId, first: 5) {
    edges { node { __typename ... on AtlassianTeam { id displayName } } }
  }
}`;

/** Teams a decision owner belongs to — tells the reader who to ask when the owner has moved on. */
export async function userTeams(accountId: string): Promise<string[]> {
  if (!accountId) return [];
  try {
    const res = await gql<{ atlassianUserInTeams?: { edges?: Array<{ node?: { displayName?: string } }> } }>(USER_TEAMS, { userId: userAri(accountId) });
    return (res.data?.atlassianUserInTeams?.edges ?? []).map((e) => e.node?.displayName ?? '').filter(Boolean);
  } catch (err) {
    console.warn('[precedent] userTeams failed', String(err));
    return [];
  }
}
