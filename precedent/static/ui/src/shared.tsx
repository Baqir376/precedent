import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { openLink, relTime, type Decision } from './api';

export const RELATION_LABEL = { contradicts: 'Contradicts', revisits: 'Revisits', aligned: 'Aligned' } as const;
const SOURCE_LABEL: Record<string, string> = {
  'jira-comment': 'Jira comment',
  'jira-issue': 'Jira work item',
  confluence: 'Confluence',
  manual: 'Recorded in Precedent',
  rovo: 'Recorded via Rovo',
  sample: 'Sample data',
};

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row muted" role="status">
      <span className="spinner" aria-hidden /> {label}
    </span>
  );
}

export function Loz({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`loz ${kind}`}>{children}</span>;
}

export function ErrorBanner({ error, onClose }: { error: string | null; onClose?: () => void }) {
  if (!error) return null;
  return (
    <div className="banner error row between" role="alert">
      <span>{error}</span>
      {onClose && (
        <button className="btn subtle sm" onClick={onClose}>
          Dismiss
        </button>
      )}
    </div>
  );
}

/** Run an async action with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, error, setError, run };
}

/** Load data once (and on demand) with loading/error state. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fnRef.current());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

export function SourceLine({ d, teams }: { d: Decision; teams?: string[] }) {
  return (
    <div className="row muted">
      {d.ownerName && <span>Decided by <b>{d.ownerName}</b></span>}
      {teams && teams.length > 0 && <span>· {teams.join(', ')}</span>}
      {d.decidedAt && <span>· {d.decidedAt} ({relTime(d.decidedAt)})</span>}
      <span>·</span>
      {d.sourceUrl ? <a onClick={() => openLink(d.sourceUrl)}>{d.sourceTitle || SOURCE_LABEL[d.source]}</a> : <span>{d.sourceTitle || SOURCE_LABEL[d.source]}</span>}
    </div>
  );
}

export function DecisionBody({ d, open: initiallyOpen = false }: { d: Decision; open?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const hasMore = !!(d.rationale || d.alternatives.length || d.revisitWhen);
  return (
    <div className="stack">
      <p className="statement">{d.statement}</p>
      {hasMore && !open && (
        <a className="muted" onClick={() => setOpen(true)}>
          Why? Show rationale
        </a>
      )}
      {open && (
        <div className="stack">
          {d.rationale && <p className="quote">{d.rationale}</p>}
          {d.alternatives.length > 0 && (
            <div className="row">
              <span className="muted">Rejected:</span>
              <div className="chips">
                {d.alternatives.map((a) => (
                  <span key={a} className="chip strike">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
          {d.revisitWhen && (
            <p className="muted">
              <b>Revisit when:</b> {d.revisitWhen}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export interface DecisionDraft {
  statement: string;
  rationale: string;
  alternatives: string;
  scope: string;
  revisitWhen: string;
}

export const emptyDraft = (): DecisionDraft => ({ statement: '', rationale: '', alternatives: '', scope: '', revisitWhen: '' });

export function DecisionForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  hint,
}: {
  initial?: Partial<DecisionDraft>;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (d: DecisionDraft) => void;
  onCancel?: () => void;
  hint?: string;
}) {
  const [d, setD] = useState<DecisionDraft>({ ...emptyDraft(), ...initial });
  const set = (k: keyof DecisionDraft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (d.statement.trim().length >= 8) onSubmit(d);
      }}
    >
      {hint && <p className="muted">{hint}</p>}
      <label className="field">
        Decision (one sentence)
        <input type="text" value={d.statement} onChange={set('statement')} placeholder="Use Postgres for sessions; do not use Redis." autoFocus />
      </label>
      <label className="field">
        Why
        <textarea value={d.rationale} onChange={set('rationale')} placeholder="The reasoning future teammates need." />
      </label>
      <div className="row" style={{ alignItems: 'stretch' }}>
        <label className="field grow">
          Rejected alternatives
          <input type="text" value={d.alternatives} onChange={set('alternatives')} placeholder="Redis, Memcached" />
        </label>
        <label className="field grow">
          Applies to
          <input type="text" value={d.scope} onChange={set('scope')} placeholder="auth-service, sessions" />
        </label>
      </div>
      <label className="field">
        Revisit when (optional)
        <input type="text" value={d.revisitWhen} onChange={set('revisitWhen')} placeholder="Traffic exceeds 10k requests/second" />
      </label>
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy || d.statement.trim().length < 8}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button className="btn subtle" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export const draftToInput = (d: DecisionDraft) => ({
  statement: d.statement.trim(),
  rationale: d.rationale.trim(),
  alternatives: d.alternatives,
  scope: d.scope,
  revisitWhen: d.revisitWhen.trim(),
});
