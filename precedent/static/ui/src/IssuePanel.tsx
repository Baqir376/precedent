import { useState } from 'react';
import { askPrecedent, call, type Decision, type Finding, type FindingStatus } from './api';
import { DecisionBody, DecisionForm, ErrorBanner, Loz, RELATION_LABEL, SourceLine, Spinner, draftToInput, useAction, useLoad } from './shared';

interface View {
  issueKey: string;
  items: Array<{ finding: Finding; decision: Decision }>;
  teams: Record<string, string[]>;
  recorded: Decision[];
  totalDecisions: number;
}

type Mode = { kind: 'none' } | { kind: 'record' } | { kind: 'supersede'; decision: Decision };

export function IssuePanel({ issueKey }: { issueKey: string }) {
  const view = useLoad(() => call<View>('getIssueView', { issueKey }), [issueKey]);
  const act = useAction();
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [note, setNote] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const recheck = () =>
    act.run('recheck', async () => {
      const r = await call<{ findings: Finding[]; method: string; candidates: number }>('recheckIssue', { issueKey });
      setNote(
        r.candidates === 0
          ? 'No decision in the log touches this work.'
          : `Compared with ${r.candidates} related decision${r.candidates === 1 ? '' : 's'}${r.method === 'heuristic' ? ' (rule-based check: AI unavailable)' : ''}.`,
      );
      await view.reload();
    });

  const setStatus = (f: Finding, status: FindingStatus) =>
    act.run(`status:${f.id}`, async () => {
      await call('setFindingStatus', { id: f.id, status });
      await view.reload();
    });

  const scanComments = () =>
    act.run('scan', async () => {
      const r = await call<{ queued: number; scanned: number }>('scanIssueComments', { issueKey });
      setNote(
        r.queued
          ? `Reading ${r.queued} comment${r.queued === 1 ? '' : 's'} that sound like decisions. They will appear in the decision log in a minute.`
          : `None of the ${r.scanned} comments read like a decision.`,
      );
    });

  if (view.loading && !view.data) return <div className="panel"><Spinner label="Checking past decisions…" /></div>;
  if (view.error) return <div className="panel"><ErrorBanner error={view.error} /></div>;
  const v = view.data!;

  const visible = v.items.filter((i) => showClosed || i.finding.status === 'open' || i.finding.status === 'acknowledged');
  const hidden = v.items.length - visible.length;
  const conflicts = v.items.filter((i) => i.finding.relation === 'contradicts' && i.finding.status === 'open').length;
  const revisits = v.items.filter((i) => i.finding.relation === 'revisits' && i.finding.status === 'open').length;
  const tone = conflicts ? 'bad' : revisits ? 'warn' : v.totalDecisions ? 'good' : '';

  if (mode.kind !== 'none') {
    const superseding = mode.kind === 'supersede' ? mode.decision : undefined;
    return (
      <div className="panel">
        <h3>{superseding ? 'Record a superseding decision' : `Record a decision made on ${issueKey}`}</h3>
        {superseding && <p className="quote">Replaces: {superseding.statement}</p>}
        <DecisionForm
          submitLabel={superseding ? 'Supersede decision' : 'Record decision'}
          busy={act.busy === 'save'}
          hint={superseding ? 'The old decision stays in history, marked superseded, and links to this one.' : 'Future work will be checked against it.'}
          initial={superseding ? { scope: superseding.scope.join(', '), alternatives: '' } : undefined}
          onCancel={() => setMode({ kind: 'none' })}
          onSubmit={(d) =>
            act.run('save', async () => {
              const input = { ...draftToInput(d), issueKey };
              if (superseding) await call('supersedeDecision', { id: superseding.id, input });
              else await call('recordDecision', { input });
              setMode({ kind: 'none' });
              setNote(superseding ? 'Decision superseded. Related conflicts were resolved.' : 'Decision recorded.');
              await view.reload();
            })
          }
        />
        <ErrorBanner error={act.error} onClose={() => act.setError(null)} />
      </div>
    );
  }

  return (
    <div className="panel">
      <div className={`summary-bar ${tone}`}>
        <div className="grow">
          {v.totalDecisions === 0 ? (
            <b>The decision log is empty</b>
          ) : conflicts ? (
            <b>
              Goes against {conflicts} past decision{conflicts === 1 ? '' : 's'}
            </b>
          ) : revisits ? (
            <b>
              Revisits {revisits} past decision{revisits === 1 ? '' : 's'}
            </b>
          ) : (
            <b>No conflicts with past decisions</b>
          )}
          <div className="muted">
            {v.totalDecisions === 0
              ? 'Open Apps → Precedent – Decision log to load sample decisions or import from Confluence.'
              : `Checked against ${v.totalDecisions} active decision${v.totalDecisions === 1 ? '' : 's'}.`}
          </div>
        </div>
        <button className="btn sm" onClick={recheck} disabled={!!act.busy || v.totalDecisions === 0}>
          {act.busy === 'recheck' ? <Spinner /> : 'Re-check'}
        </button>
      </div>

      {note && <div className="banner ok row between"><span>{note}</span><button className="btn subtle sm" onClick={() => setNote(null)}>OK</button></div>}
      <ErrorBanner error={act.error} onClose={() => act.setError(null)} />

      {visible.map(({ finding: f, decision: d }) => (
        <div key={f.id} className={`card ${f.relation} ${f.status === 'dismissed' ? 'dim' : ''}`}>
          <div className="stack">
            <div className="row between">
              <div className="row">
                <Loz kind={f.relation}>{RELATION_LABEL[f.relation]}</Loz>
                {f.status !== 'open' && <Loz kind="">{f.status}</Loz>}
              </div>
              <span className="muted" title="How sure Precedent is">
                {Math.round(f.confidence * 100)}% sure{f.method === 'heuristic' ? ' · rule-based' : ''}
              </span>
            </div>
            <DecisionBody d={d} />
            {f.explanation && <p className="subtle">{f.explanation}</p>}
            {f.suggestion && f.relation !== 'aligned' && (
              <p className="muted">
                <b>Next step:</b> {f.suggestion}
              </p>
            )}
            <SourceLine d={d} teams={v.teams[d.ownerAccountId]} />
            {f.relation !== 'aligned' && (
              <div className="row">
                {f.status === 'open' && (
                  <button className="btn sm" disabled={!!act.busy} onClick={() => setStatus(f, 'acknowledged')}>
                    Acknowledge
                  </button>
                )}
                {f.status !== 'dismissed' && (
                  <button className="btn sm subtle" disabled={!!act.busy} onClick={() => setStatus(f, 'dismissed')}>
                    Not a conflict
                  </button>
                )}
                {f.status === 'dismissed' && (
                  <button className="btn sm subtle" disabled={!!act.busy} onClick={() => setStatus(f, 'open')}>
                    Reopen
                  </button>
                )}
                <button className="btn sm subtle" disabled={!!act.busy} onClick={() => setMode({ kind: 'supersede', decision: d })}>
                  Change the decision…
                </button>
                <button
                  className="btn sm subtle"
                  onClick={() => void askPrecedent(`On ${issueKey}: explain decision ${d.id} ("${d.statement}") and what we should do about the conflict.`)}
                >
                  Ask Precedent
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {hidden > 0 && (
        <a className="muted" onClick={() => setShowClosed(true)}>
          Show {hidden} dismissed
        </a>
      )}

      {v.recorded.length > 0 && (
        <div className="stack">
          <h3>Decisions made on this work item</h3>
          {v.recorded.map((d) => (
            <div key={d.id} className="card">
              <DecisionBody d={d} />
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <button className="btn sm" onClick={() => setMode({ kind: 'record' })}>
          + Record a decision
        </button>
        <button className="btn sm subtle" onClick={scanComments} disabled={!!act.busy}>
          {act.busy === 'scan' ? <Spinner /> : 'Find decisions in comments'}
        </button>
      </div>
    </div>
  );
}
