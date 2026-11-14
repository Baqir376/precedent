import { invoke, router, rovo } from '@forge/bridge';
export type { Decision, Finding, FindingStatus, Settings, Judgement, DecisionStatus } from '../../../src/lib/types';

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/** Call a backend resolver; throws with the server's message on failure. */
export async function call<T>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = (await invoke(name, payload)) as Envelope<T>;
  if (!res || typeof res !== 'object') throw new Error('No response from Precedent.');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function openLink(url: string) {
  if (!url) return;
  void router.open(url).catch(() => window.open(url, '_blank'));
}

export function openIssue(key: string) {
  void router.open(`/browse/${key}`).catch(() => undefined);
}

export async function askPrecedent(prompt: string) {
  try {
    await rovo.open({ type: 'forge', agentKey: 'precedent-agent', agentName: 'Precedent', prompt });
    return true;
  } catch {
    return false;
  }
}

export function relTime(input: number | string): string {
  const t = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(t)) return '';
  const days = Math.round((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 45) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months} months ago`;
  return `${Math.round(months / 12)} years ago`;
}
