import { Queue, type AsyncEvent } from '@forge/events';
import { kvs } from '@forge/kvs';
import { captureDecisions, checkWork } from './lib/engine';
import { commentText, getComment, getWorkItem, isOwnComment } from './lib/jira';
import { DECISION_CUE } from './lib/text';
import { getSettings, listDecisionsByStatus } from './lib/store';
import type { DecisionSource } from './lib/types';

export const QUEUE_KEY = 'precedent-work';
export const queue = new Queue({ key: QUEUE_KEY });

export type Job =
  | { kind: 'check'; issueKey: string; allowComment: boolean }
  | { kind: 'capture-comment'; issueKey: string; commentId: string }
  | {
      kind: 'capture-text';
      importId: string;
      text: string;
      source: DecisionSource;
      sourceRef: string;
      sourceUrl: string;
      sourceTitle: string;
      project: string;
      ownerAccountId: string;
      ownerName: string;
      date: string;
    };

const LLM_LANE = { key: 'precedent-llm', limit: 4 };
/** Imports run one at a time so progress counters are updated without races. */
const IMPORT_LANE = { key: 'precedent-import', limit: 1 };

export async function enqueue(jobs: Job[], delayInSeconds = 0) {
  // Text jobs carry up to ~24k chars each; keep every push well under the 200 KB payload cap.
  const size = jobs.some((j) => j.kind === 'capture-text') ? 4 : 50;
  for (let i = 0; i < jobs.length; i += size) {
    await queue.push(
      jobs.slice(i, i + size).map((body) => ({
        body: body as unknown as Record<string, unknown>,
        delayInSeconds,
        concurrency: body.kind === 'capture-text' ? IMPORT_LANE : LLM_LANE,
      })),
    );
  }
}

interface IssueEvent {
  eventType: string;
  selfGenerated?: boolean;
  issue?: { key?: string; id?: string };
  comment?: { id?: string };
  changelog?: { items?: Array<{ field?: string; fieldId?: string }> };
}

/** Product-event trigger: stays fast by only queueing work. */
export async function onJiraEvent(event: IssueEvent) {
  if (event.selfGenerated) return;
  const issueKey = event.issue?.key;
  if (!issueKey) return;

  switch (event.eventType) {
    case 'avi:jira:created:issue':
      await enqueue([{ kind: 'check', issueKey, allowComment: true }], 5);
      break;
    case 'avi:jira:updated:issue': {
      const fields = (event.changelog?.items ?? []).map((i) => (i.fieldId ?? i.field ?? '').toLowerCase());
      if (fields.some((f) => f === 'summary' || f === 'description')) {
        await enqueue([{ kind: 'check', issueKey, allowComment: true }], 20);
      }
      break;
    }
    case 'avi:jira:commented:issue':
      if (event.comment?.id) await enqueue([{ kind: 'capture-comment', issueKey, commentId: String(event.comment.id) }]);
      break;
  }
}

export interface ImportStatus {
  total: number;
  done: number;
  created: number;
  skipped: number;
  method: string;
  startedAt: number;
}

export const importKey = (id: string) => `import:${id}`;

async function bumpImport(importId: string, created: number, skipped: number, method: string) {
  const key = importKey(importId);
  const s = await kvs.get<ImportStatus>(key);
  if (!s) return;
  s.done += 1;
  s.created += created;
  s.skipped += skipped;
  s.method = method;
  await kvs.set(key, s);
}

/** Queue consumer: all model calls happen here, off the request path. */
export async function onJob(event: AsyncEvent) {
  const job = event.body as unknown as Job;
  try {
    if (job.kind === 'check') {
      const work = await getWorkItem(job.issueKey);
      const res = await checkWork(work, { allowComment: job.allowComment, respectProjectFilter: true });
      console.log(`[precedent] checked ${job.issueKey}: ${res.findings.length} findings via ${res.method}`);
      return;
    }

    if (job.kind === 'capture-comment') {
      const settings = await getSettings();
      if (!settings.captureFromComments) return;
      const project = job.issueKey.split('-')[0];
      if (settings.projects.length && !settings.projects.includes(project)) return;
      const comment = await getComment(job.issueKey, job.commentId);
      const text = commentText(comment);
      // Cheap pre-filter: only comments that sound like a decision reach the model.
      if (!text || isOwnComment(text) || !DECISION_CUE.test(text)) return;
      const res = await captureDecisions(text, {
        source: 'jira-comment',
        sourceRef: `jira-comment:${job.issueKey}:${job.commentId}`,
        sourceUrl: `/browse/${job.issueKey}?focusedCommentId=${job.commentId}`,
        sourceTitle: `Comment on ${job.issueKey}`,
        project,
        ownerAccountId: comment.author?.accountId ?? '',
        ownerName: comment.author?.displayName ?? '',
        date: comment.created?.slice(0, 10),
      });
      console.log(`[precedent] captured ${res.created.length} decisions from ${job.issueKey}#${job.commentId}`);
      return;
    }

    if (job.kind === 'capture-text') {
      const active = await listDecisionsByStatus('active');
      const res = await captureDecisions(
        job.text,
        {
          source: job.source,
          sourceRef: job.sourceRef,
          sourceUrl: job.sourceUrl,
          sourceTitle: job.sourceTitle,
          title: job.sourceTitle,
          project: job.project,
          ownerAccountId: job.ownerAccountId,
          ownerName: job.ownerName,
          date: job.date,
        },
        active,
      );
      await bumpImport(job.importId, res.created.length, res.skipped.length, res.method);
    }
  } catch (err) {
    console.error(`[precedent] job ${job.kind} failed`, String(err));
    if (job.kind === 'capture-text') await bumpImport(job.importId, 0, 1, 'error');
  }
}
