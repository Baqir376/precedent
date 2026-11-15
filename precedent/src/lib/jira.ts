import api, { route } from '@forge/api';
import type { Decision, Finding, WorkItem } from './types';
import { adfToText, truncate } from './text';

export const COMMENT_MARKER = 'Precedent check';

async function json<T>(res: { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${truncate(await res.text(), 300)}`);
  return (await res.json()) as T;
}

interface RawIssue {
  key: string;
  fields: { summary?: string; description?: unknown; project?: { key: string }; status?: { name: string } };
}

export async function getWorkItem(issueKey: string, asUser = false): Promise<WorkItem> {
  const caller = asUser ? api.asUser() : api.asApp();
  const raw = await json<RawIssue>(
    await caller.requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description,project,status`),
    `Read ${issueKey}`,
  );
  return {
    key: raw.key,
    summary: raw.fields.summary ?? '',
    description: adfToText(raw.fields.description).trim(),
    project: raw.fields.project?.key ?? issueKey.split('-')[0],
  };
}

export interface RawComment {
  id: string;
  body: unknown;
  author?: { accountId: string; displayName: string };
  created?: string;
}

export async function getComment(issueKey: string, commentId: string): Promise<RawComment> {
  return json<RawComment>(
    await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment/${commentId}`),
    `Read comment ${commentId}`,
  );
}

export async function getRecentComments(issueKey: string, max = 50): Promise<RawComment[]> {
  const res = await json<{ comments: RawComment[] }>(
    await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/comment?orderBy=-created&maxResults=${String(max)}`),
    `Read comments of ${issueKey}`,
  );
  return res.comments ?? [];
}

export function commentText(c: RawComment): string {
  return adfToText(c.body).trim();
}

export function isOwnComment(text: string): boolean {
  return text.includes(COMMENT_MARKER);
}

/** Issue URL relative to the site; the frontend resolves it with router.open. */
export function issuePath(key: string): string {
  return `/browse/${key}`;
}

const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });

/** Post a single comment summarising contradictions for an issue. */
export async function postConflictComment(issueKey: string, items: Array<{ finding: Finding; decision: Decision }>) {
  const rows = items.map(({ finding, decision }) => ({
    type: 'listItem',
    content: [
      {
        type: 'paragraph',
        content: [
          t(finding.relation === 'revisits' ? 'Revisits: ' : 'Conflicts with: ', [{ type: 'strong' }]),
          /^https?:/.test(decision.sourceUrl)
            ? t(truncate(decision.statement, 200), [{ type: 'link', attrs: { href: decision.sourceUrl } }])
            : t(truncate(decision.statement, 200)),
          t(decision.ownerName ? ` — decided by ${decision.ownerName}${decision.decidedAt ? ` on ${decision.decidedAt}` : ''}.` : '.'),
        ],
      },
      { type: 'paragraph', content: [t(truncate(finding.explanation, 400), [{ type: 'em' }])] },
      ...(finding.suggestion ? [{ type: 'paragraph', content: [t('Next step: ', [{ type: 'strong' }]), t(finding.suggestion)] }] : []),
    ],
  }));
  const body = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'panel',
        attrs: { panelType: 'warning' },
        content: [
          {
            type: 'paragraph',
            content: [
              t(`${COMMENT_MARKER}: `, [{ type: 'strong' }]),
              t(`this work may go against ${items.length === 1 ? 'a past decision' : `${items.length} past decisions`}.`),
            ],
          },
          { type: 'bulletList', content: rows },
          {
            type: 'paragraph',
            content: [
              t('Open the Precedent panel on this issue to acknowledge, dismiss, or record a superseding decision.'),
            ],
          },
        ],
      },
    ],
  };
  await json(
    await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }),
    `Comment on ${issueKey}`,
  );
}

export async function getUserName(accountId: string): Promise<string> {
  if (!accountId) return '';
  try {
    const u = await json<{ displayName?: string }>(
      await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`),
      'Read user',
    );
    return u.displayName ?? '';
  } catch {
    return '';
  }
}

export async function listProjects(): Promise<Array<{ key: string; name: string; id: string }>> {
  const res = await json<{ values: Array<{ key: string; name: string; id: string }> }>(
    await api.asUser().requestJira(route`/rest/api/3/project/search?maxResults=50&orderBy=lastIssueUpdatedTime`),
    'List projects',
  );
  return res.values ?? [];
}

export async function createIssue(projectKey: string, summary: string, description: string): Promise<string> {
  const meta = await json<{ issueTypes?: Array<{ id: string; name: string; subtask?: boolean }> }>(
    await api.asUser().requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`),
    'Read issue types',
  );
  const types = (meta.issueTypes ?? []).filter((x) => !x.subtask);
  const type = types.find((x) => /task|story/i.test(x.name)) ?? types[0];
  if (!type) throw new Error(`No issue type available in ${projectKey}`);
  const res = await json<{ key: string }>(
    await api.asUser().requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          issuetype: { id: type.id },
          summary,
          description: {
            type: 'doc',
            version: 1,
            content: description.split('\n\n').map((p) => ({ type: 'paragraph', content: [t(p)] })),
          },
        },
      }),
    }),
    'Create issue',
  );
  return res.key;
}

export async function addPlainComment(issueKey: string, text: string): Promise<void> {
  await json(
    await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: { type: 'doc', version: 1, content: text.split('\n\n').map((p) => ({ type: 'paragraph', content: [t(p)] })) } }),
    }),
    `Comment on ${issueKey}`,
  );
}

/**
 * Which of these work items can the current user see? Findings carry issue summaries, so every list
 * shown to a user is filtered through this to avoid leaking work items they cannot browse.
 */
export async function visibleIssueKeys(keys: string[]): Promise<Set<string>> {
  const unique = [...new Set(keys.filter(Boolean))];
  const visible = new Set<string>();
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/bulkfetch`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueIdsOrKeys: batch, fields: ['summary'] }),
    });
    if (!res.ok) throw new Error(`Permission check failed: ${res.status}`);
    const body = (await res.json()) as { issues?: Array<{ key: string }> };
    for (const issue of body.issues ?? []) visible.add(issue.key);
  }
  return visible;
}

export async function assertCanSee(issueKey: string): Promise<void> {
  if (!(await visibleIssueKeys([issueKey])).has(issueKey)) throw new Error(`You don't have access to ${issueKey}.`);
}
