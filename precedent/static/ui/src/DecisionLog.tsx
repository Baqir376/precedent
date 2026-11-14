import { useEffect, useMemo, useState } from 'react';
import { askPrecedent, call, openIssue, openLink, relTime, type Decision, type DecisionStatus, type Finding, type Judgement, type Settings } from './api';
import { DecisionBody, DecisionForm, ErrorBanner, Loz, RELATION_LABEL, SourceLine, Spinner, draftToInput, useAction, useLoad } from './shared';

type Tab = 'decisions' | 'conflicts' | 'check' | 'import' | 'settings';

interface Setup {
  settings: Settings;
  isAdmin: boolean;
  projects: Array<{ key: string; name: string }>;
  counts: { active: number; total: number; samples: number };
}

type FindingItem = { finding: Finding; decision: Decision };

export function DecisionLog() {
  const [tab, setTab] = useState<Tab>('decisions');
  const setup = useLoad(() => call<Setup>('getSetup'));
  const conflicts = useLoad(() => call<FindingItem[]>('listFindings', { status: 'open' }));
  const openConflicts = (conflicts.data ?? []).filter((i) => i.finding.relation !== 'aligned');
  const refreshAll = () => {
    void setup.reload();
    void conflicts.reload();
  };

  return (
    <div className="page">
      <div className="hero">
        <img src="./icon.svg" alt="" />
        <div className="grow">
          <h1>Precedent</h1>
          <p className="subtle">Your team's decisions, why they were made, and the work that goes against them.</p>
        </div>
        <button
          className="btn"
          onClick={() => void askPrecedent('What are the most important decisions in our log, and is anything currently contradicting them?')}
        >
          Ask Precedent in Rovo
        </button>
      </div>

      {setup.data && setup.data.counts.total === 0 && <Onboarding setup={setup.data} onDone={refreshAll} goImport={() => setTab('import')} />}

      {setup.data && setup.data.counts.total > 0 && (
        <div className="stats">
          <div className="stat"><b>{setup.data.counts.active}</b><span className="muted">active decisions</span></div>
          <div className="stat"><b>{openConflicts.filter((c) => c.finding.relation === 'contradicts').length}</b><span className="muted">open contradictions</span></div>
          <div className="stat"><b>{openConflicts.filter((c) => c.finding.relation === 'revisits').length}</b><span className="muted">decisions up for review</span></div>
          <div className="stat"><b>{new Set(openConflicts.map((c) => c.finding.issueKey)).size}</b><span className="muted">work items affected</span></div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {(
          [
            ['decisions', 'Decisions', setup.data?.counts.total],
            ['conflicts', 'Conflicts', openConflicts.length],
            ['check', 'Check a plan', undefined],
            ['import', 'Import', undefined],
            ['settings', 'Settings', undefined],
          ] as Array<[Tab, string, number | undefined]>
        ).map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {label}
            {n !== undefined && n > 0 && <span className={`count ${k === 'conflicts' ? 'hot' : ''}`}>{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'decisions' && <DecisionsTab onChange={refreshAll} />}
      {tab === 'conflicts' && <ConflictsTab data={conflicts} />}
      {tab === 'check' && <CheckTab />}
      {tab === 'import' && <ImportTab onImported={refreshAll} />}
      {tab === 'settings' && setup.data && <SettingsTab setup={setup.data} onChange={refreshAll} />}
      {tab === 'settings' && setup.loading && <Spinner label="Loading settings…" />}
    </div>
  );
}

// ---------------------------------------------------------------- onboarding

function Onboarding({ setup, onDone, goImport }: { setup: Setup; onDone: () => void; goImport: () => void }) {
  const act = useAction();
  const [project, setProject] = useState(setup.projects[0]?.key ?? '');
  const [created, setCreated] = useState<string[]>([]);
  return (
    <div className="card stack lg">
      <div>
        <h2>Get started in two minutes</h2>
        <p className="subtle">Precedent needs decisions to protect. Import your own, or try it with a sample log from a fictional payments team.</p>
      </div>
      <div className="steps">
        <div className="step stack">
          <h3>Load sample decisions</h3>
          <p className="muted">10 realistic architecture and policy decisions, clearly tagged as samples.</p>
          <div>
            <button className="btn primary" disabled={!!act.busy} onClick={() => act.run('seed', async () => { await call('seedSamples'); onDone(); })}>
              {act.busy === 'seed' ? 'Loading…' : 'Load samples'}
            </button>
          </div>
        </div>
        <div className="step stack">
          <h3>Create demo work items</h3>
          <p className="muted">5 work items, some of which go against the samples. Precedent checks them as they are created.</p>
          <div className="row">
            <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
              {setup.projects.map((p) => (
                <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!project || !!act.busy}
              onClick={() => act.run('demo', async () => setCreated((await call<{ keys: string[] }>('createDemoIssues', { projectKey: project })).keys))}
            >
              {act.busy === 'demo' ? 'Creating…' : 'Create'}
            </button>
          </div>
          {created.length > 0 && (
            <p className="muted">
              Created {created.map((k, i) => <span key={k}>{i ? ', ' : ''}<a onClick={() => openIssue(k)}>{k}</a></span>)}. Open one in about 30 seconds.
            </p>
          )}
        </div>
        <div className="step stack">
          <h3>Or import your own</h3>
          <p className="muted">Pull decisions from Confluence pages you work on (via Teamwork Graph), or paste meeting notes.</p>
          <div><button className="btn" onClick={goImport}>Import decisions</button></div>
        </div>
      </div>
      <ErrorBanner error={act.error} onClose={() => act.setError(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- decisions

function DecisionsTab({ onChange }: { onChange: () => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<DecisionStatus | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const act = useAction();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  const list = useLoad(() => call<{ decisions: Decision[]; openConflicts: Record<string, number> }>('listDecisions', { query: debounced, status }), [debounced, status]);

  const decisions = list.data?.decisions ?? [];
  return (
    <div className="split">
      <div className="stack">
        <div className="toolbar">
          <input type="search" placeholder="Search decisions — e.g. sessions, graphql, logging" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value as DecisionStatus | 'all')} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="proposed">Needs review</option>
            <option value="superseded">Superseded</option>
            <option value="reversed">Reversed</option>
          </select>
          <button className="btn primary" onClick={() => { setAdding(true); setSelected(null); }}>+ Decision</button>
        </div>
        {list.loading && !list.data && <Spinner label="Loading decisions…" />}
        <ErrorBanner error={list.error} />
        {list.data && decisions.length === 0 && (
          <div className="empty"><div className="big">∅</div>{debounced ? 'No decision matches that search.' : 'No decisions yet.'}</div>
        )}
        <div className="list">
          {decisions.map((d) => {
            const n = list.data?.openConflicts[d.id] ?? 0;
            return (
              <div
                key={d.id}
                className={`card clickable ${d.status === 'superseded' || d.status === 'reversed' ? 'dim' : ''}`}
                onClick={() => { setSelected(d.id); setAdding(false); }}
                style={selected === d.id ? { outline: '2px solid var(--p-brand)' } : undefined}
              >
                <div className="stack">
                  <div className="row between">
                    <div className="row">
                      <Loz kind={d.status}>{d.status === 'proposed' ? 'needs review' : d.status}</Loz>
                      {d.source === 'sample' && <Loz kind="">sample</Loz>}
                      {n > 0 && <Loz kind="contradicts">{n} conflict{n === 1 ? '' : 's'}</Loz>}
                    </div>
                    <span className="muted">{d.decidedAt}</span>
                  </div>
                  <p className="statement">{d.statement}</p>
                  <SourceLine d={d} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="drawer">
        {adding && (
          <div className="card stack">
            <h2>Record a decision</h2>
            <DecisionForm
              submitLabel="Record decision"
              busy={act.busy === 'add'}
              onCancel={() => setAdding(false)}
              onSubmit={(d) =>
                act.run('add', async () => {
                  const created = await call<Decision>('recordDecision', { input: draftToInput(d) });
                  setAdding(false);
                  setSelected(created.id);
                  await list.reload();
                  onChange();
                })
              }
            />
            <ErrorBanner error={act.error} />
          </div>
        )}
        {!adding && selected && (
          <DecisionDetail
            id={selected}
            onChange={async () => { await list.reload(); onChange(); }}
            onSelect={setSelected}
            onDeleted={async () => { setSelected(null); await list.reload(); onChange(); }}
          />
        )}
        {!adding && !selected && (
          <div className="card empty">
            <div className="big">⚖</div>
            Select a decision to see its rationale, history and the work that challenged it.
          </div>
        )}
      </div>
    </div>
  );
}

interface Detail {
  decision: Decision;
  lineage: Decision[];
  findings: Finding[];
  teams: string[];
}

function DecisionDetail({ id, onChange, onSelect, onDeleted }: { id: string; onChange: () => void; onSelect: (id: string) => void; onDeleted: () => void }) {
  const detail = useLoad(() => call<Detail>('getDecision', { id }), [id]);
  const act = useAction();
  const [superseding, setSuperseding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (detail.loading && !detail.data) return <div className="card"><Spinner label="Loading…" /></div>;
  if (detail.error) return <ErrorBanner error={detail.error} />;
  const { decision: d, lineage, findings, teams } = detail.data!;

  const setStatus = (status: DecisionStatus) =>
    act.run('status', async () => {
      await call('updateDecision', { id: d.id, patch: { status } });
      await detail.reload();
      onChange();
    });

  if (superseding) {
    return (
      <div className="card stack">
        <h2>Supersede decision</h2>
        <p className="quote">{d.statement}</p>
        <DecisionForm
          submitLabel="Supersede"
          busy={act.busy === 'sup'}
          initial={{ scope: d.scope.join(', ') }}
          hint="The current decision is kept as history and linked to the new one. Open conflicts against it are resolved."
          onCancel={() => setSuperseding(false)}
          onSubmit={(draft) =>
            act.run('sup', async () => {
              const created = await call<Decision>('supersedeDecision', { id: d.id, input: draftToInput(draft) });
              setSuperseding(false);
              onChange();
              onSelect(created.id);
            })
          }
        />
        <ErrorBanner error={act.error} />
      </div>
    );
  }

  const challenged = findings.filter((f) => f.relation !== 'aligned');
  const aligned = findings.filter((f) => f.relation === 'aligned');
  return (
    <div className="card stack lg">
      <div className="row between">
        <Loz kind={d.status}>{d.status === 'proposed' ? 'needs review' : d.status}</Loz>
        <span className="muted">{Math.round(d.confidence * 100)}% extraction confidence</span>
      </div>
      <DecisionBody d={d} open />
      <SourceLine d={d} teams={teams} />
      {d.scope.length > 0 && (
        <div className="chips">{d.scope.map((s) => <span key={s} className="chip">{s}</span>)}</div>
      )}

      {lineage.length > 1 && (
        <div className="stack">
          <h3>History</h3>
          <div className="timeline">
            {lineage.map((x) => (
              <div key={x.id} className={`node ${x.id === d.id ? 'current' : ''}`}>
                <div className="muted">{x.decidedAt} · {x.status}</div>
                {x.id === d.id ? <b>{x.statement}</b> : <a onClick={() => onSelect(x.id)}>{x.statement}</a>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stack">
        <h3>Challenged by {challenged.length ? `(${challenged.length})` : ''}</h3>
        {challenged.length === 0 && <p className="muted">No work item has gone against this decision yet.</p>}
        {challenged.map((f) => (
          <div key={f.id} className="row" style={{ alignItems: 'flex-start' }}>
            <Loz kind={f.relation}>{RELATION_LABEL[f.relation]}</Loz>
            <div className="grow">
              <a onClick={() => openIssue(f.issueKey)}>{f.issueKey}</a> {f.issueSummary}
              <div className="muted">{f.status} · {relTime(f.updatedAt)}</div>
            </div>
          </div>
        ))}
        {aligned.length > 0 && <p className="muted">Followed by {aligned.length} work item{aligned.length === 1 ? '' : 's'}: {aligned.map((f) => f.issueKey).join(', ')}</p>}
      </div>

      <div className="row">
        {d.status === 'proposed' && <button className="btn primary sm" onClick={() => setStatus('active')} disabled={!!act.busy}>Confirm as active</button>}
        {d.status === 'active' && <button className="btn sm" onClick={() => setSuperseding(true)}>Supersede…</button>}
        {d.status === 'active' && <button className="btn sm subtle" onClick={() => setStatus('reversed')} disabled={!!act.busy}>Mark reversed</button>}
        {(d.status === 'reversed' || d.status === 'superseded') && !d.supersededBy && (
          <button className="btn sm subtle" onClick={() => setStatus('active')} disabled={!!act.busy}>Reactivate</button>
        )}
        <button className="btn sm subtle" onClick={() => void askPrecedent(`Explain decision ${d.id}: "${d.statement}" — the rationale, who to ask, and whether it still holds.`)}>
          Ask Precedent
        </button>
        {!confirmDelete ? (
          <button className="btn sm subtle danger" onClick={() => setConfirmDelete(true)}>Delete</button>
        ) : (
          <button
            className="btn sm danger"
            onClick={() => act.run('del', async () => { await call('deleteDecision', { id: d.id }); onDeleted(); })}
          >
            Confirm delete
          </button>
        )}
      </div>
      <ErrorBanner error={act.error} onClose={() => act.setError(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- conflicts

function ConflictsTab({ data }: { data: ReturnType<typeof useLoad<FindingItem[]>> }) {
  const [project, setProject] = useState('');
  const items = (data.data ?? []).filter((i) => i.finding.relation !== 'aligned' && (!project || i.finding.project === project));
  const projects = useMemo(() => [...new Set((data.data ?? []).map((i) => i.finding.project))].sort(), [data.data]);
  return (
    <div className="stack">
      <div className="toolbar">
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn subtle" onClick={() => void data.reload()}>Refresh</button>
      </div>
      {data.loading && !data.data && <Spinner label="Loading conflicts…" />}
      <ErrorBanner error={data.error} />
      {data.data && items.length === 0 && (
        <div className="empty"><div className="big">✓</div>No open conflicts. New work items are checked automatically as they are created or edited.</div>
      )}
      {items.map(({ finding: f, decision: d }) => (
        <div key={f.id} className={`card ${f.relation}`}>
          <div className="stack">
            <div className="row between">
              <div className="row">
                <Loz kind={f.relation}>{RELATION_LABEL[f.relation]}</Loz>
                <a onClick={() => openIssue(f.issueKey)}><b>{f.issueKey}</b></a>
                <span>{f.issueSummary}</span>
              </div>
              <span className="muted">{Math.round(f.confidence * 100)}% · {relTime(f.updatedAt)}</span>
            </div>
            <p className="quote">{d.statement}</p>
            <p className="subtle">{f.explanation}</p>
            <SourceLine d={d} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- check a plan

function CheckTab() {
  const [text, setText] = useState('');
  const act = useAction();
  const [result, setResult] = useState<{ method: string; items: Array<{ decision: Decision; judgement: Judgement }> } | null>(null);
  return (
    <div className="stack lg">
      <div className="stack">
        <p className="subtle">Paste a design, an RFC draft or a pull request description. Precedent tells you which past decisions it touches before anyone writes code.</p>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="We plan to cache sessions in Redis to cut login latency, and expose a GraphQL API for partners…"
        />
        <div className="row">
          <button className="btn primary" disabled={!text.trim() || !!act.busy} onClick={() => act.run('check', async () => setResult(await call('previewCheck', { text })))}>
            {act.busy ? 'Checking…' : 'Check against decisions'}
          </button>
          {act.busy && <Spinner label="Reading the decision log…" />}
        </div>
        <ErrorBanner error={act.error} />
      </div>
      {result && result.items.length === 0 && <div className="banner ok">No past decision conflicts with this plan.</div>}
      {result?.items.map(({ decision: d, judgement: j }) => (
        <div key={d.id} className={`card ${j.relation}`}>
          <div className="stack">
            <div className="row between">
              <Loz kind={j.relation}>{RELATION_LABEL[j.relation as keyof typeof RELATION_LABEL]}</Loz>
              <span className="muted">{Math.round(j.confidence * 100)}% sure{result.method === 'heuristic' ? ' · rule-based' : ''}</span>
            </div>
            <DecisionBody d={d} />
            <p className="subtle">{j.explanation}</p>
            {j.suggestion && <p className="muted"><b>Next step:</b> {j.suggestion}</p>}
            <SourceLine d={d} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- import

interface ScanPage {
  ari: string;
  pageId: string;
  title: string;
  url: string;
  lastUpdatedAt: string;
  excerpt: string;
  chars: number;
  looksLikeDecision: boolean;
  imported: boolean;
}

interface ImportStatus {
  importId?: string;
  total: number;
  done: number;
  created: number;
  skipped: number;
  method: string;
}

function useImportProgress(onFinished: () => void) {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  useEffect(() => {
    if (!importId) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await call<ImportStatus | null>('importStatus', { importId });
        if (stop || !s) return;
        setStatus(s);
        if (s.done >= s.total) {
          setImportId(null);
          onFinished();
          return;
        }
      } catch {
        /* keep polling */
      }
      if (!stop) setTimeout(tick, 3000);
    };
    const t = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId]);
  return { status, running: !!importId, start: (s: ImportStatus & { importId: string }) => { setStatus(s); setImportId(s.importId); } };
}

function ImportProgress({ status, running }: { status: ImportStatus | null; running: boolean }) {
  if (!status) return null;
  return (
    <div className={`banner ${running ? '' : 'ok'} row`}>
      {running && <span className="spinner" />}
      <span>
        {running ? `Reading ${status.done}/${status.total}…` : 'Import finished.'} {status.created} decision{status.created === 1 ? '' : 's'} captured
        {status.skipped ? `, ${status.skipped} skipped (duplicates or not real decisions)` : ''}.
        {status.method === 'heuristic' && ' AI was unavailable, so a rule-based reader was used.'}
      </span>
    </div>
  );
}

function ImportTab({ onImported }: { onImported: () => void }) {
  const act = useAction();
  const [since, setSince] = useState('P90D');
  const [scan, setScan] = useState<{ pages: ScanPage[]; errors: string[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const graph = useImportProgress(onImported);
  const paste = useImportProgress(onImported);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');

  const runScan = () =>
    act.run('scan', async () => {
      const r = await call<{ pages: ScanPage[]; errors: string[] }>('scanGraph', { since });
      setScan(r);
      setPicked(new Set(r.pages.filter((p) => p.looksLikeDecision && !p.imported).map((p) => p.pageId)));
    });

  return (
    <div className="split">
      <div className="card stack lg">
        <div className="stack">
          <h2>From Confluence, via Teamwork Graph</h2>
          <p className="subtle">
            Precedent asks the Teamwork Graph which Confluence pages you have worked on, reads them with your permissions, and pulls out the decisions — with rationale, rejected options and owner.
          </p>
          <div className="row">
            <select value={since} onChange={(e) => setSince(e.target.value)} aria-label="Time range">
              <option value="P30D">Last 30 days</option>
              <option value="P90D">Last 90 days</option>
              <option value="P365D">Last year</option>
            </select>
            <button className="btn primary" onClick={runScan} disabled={!!act.busy || graph.running}>
              {act.busy === 'scan' ? 'Searching the graph…' : 'Find pages'}
            </button>
          </div>
        </div>
        <ErrorBanner error={act.error} onClose={() => act.setError(null)} />
        {scan && scan.errors.length > 0 && scan.pages.length === 0 && (
          <div className="banner error">Teamwork Graph returned: {scan.errors.slice(0, 2).join(' · ')}</div>
        )}
        {scan && scan.pages.length === 0 && scan.errors.length === 0 && (
          <div className="empty">No Confluence pages in your recent work. Open a few decision pages in Confluence, or paste text on the right.</div>
        )}
        {scan && scan.pages.length > 0 && (
          <div className="stack">
            <div className="row between">
              <span className="muted">{scan.pages.length} pages · {picked.size} selected</span>
              <button
                className="btn primary"
                disabled={!picked.size || graph.running || !!act.busy}
                onClick={() =>
                  act.run('import', async () => graph.start(await call<ImportStatus & { importId: string }>('importPages', { pageIds: [...picked], since })))
                }
              >
                Extract decisions from {picked.size} page{picked.size === 1 ? '' : 's'}
              </button>
            </div>
            <ImportProgress status={graph.status} running={graph.running} />
            <div className="card" style={{ padding: 0 }}>
              {scan.pages.map((p) => (
                <label key={p.pageId} className="page-row check">
                  <input
                    type="checkbox"
                    checked={picked.has(p.pageId)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(p.pageId);
                      else next.delete(p.pageId);
                      setPicked(next);
                    }}
                  />
                  <div className="grow stack" style={{ gap: 2 }}>
                    <div className="row">
                      <b>{p.title}</b>
                      {p.looksLikeDecision && <Loz kind="info">has decisions</Loz>}
                      {p.imported && <Loz kind="ok">imported</Loz>}
                    </div>
                    <span className="muted">{p.excerpt}</span>
                    <span className="muted">
                      Updated {relTime(p.lastUpdatedAt)} · <a onClick={(e) => { e.preventDefault(); openLink(p.url); }}>Open</a>
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card stack">
        <h2>Paste notes</h2>
        <p className="subtle">Meeting notes, a Slack thread, an ADR. Precedent keeps only the decisions that were actually agreed.</p>
        <label className="field">
          Title
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Architecture sync, 12 Nov" />
        </label>
        <label className="field">
          Text
          <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="After discussion we agreed to…" />
        </label>
        <div>
          <button
            className="btn primary"
            disabled={!text.trim() || paste.running || !!act.busy}
            onClick={() => act.run('paste', async () => { paste.start(await call<ImportStatus & { importId: string }>('importText', { text, title })); setText(''); })}
          >
            Extract decisions
          </button>
        </div>
        <ImportProgress status={paste.status} running={paste.running} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- settings

function SettingsTab({ setup, onChange }: { setup: Setup; onChange: () => void }) {
  const act = useAction();
  const [s, setS] = useState<Settings>(setup.settings);
  const [projectsText, setProjectsText] = useState(setup.settings.projects.join(', '));
  const [saved, setSaved] = useState(false);
  const [project, setProject] = useState(setup.projects[0]?.key ?? '');
  const [created, setCreated] = useState<string[]>([]);
  const disabled = !setup.isAdmin;

  return (
    <div className="split">
      <div className="card stack lg">
        <h2>Automation</h2>
        {disabled && <div className="banner">Only Jira administrators can change these settings.</div>}
        <label className="check">
          <input type="checkbox" disabled={disabled} checked={s.autoComment} onChange={(e) => setS({ ...s, autoComment: e.target.checked })} />
          <span><b>Comment on work items that contradict a decision</b><br /><span className="muted">One comment per conflict, only when Precedent is at least 70% sure.</span></span>
        </label>
        <label className="check">
          <input type="checkbox" disabled={disabled} checked={s.captureFromComments} onChange={(e) => setS({ ...s, captureFromComments: e.target.checked })} />
          <span><b>Capture decisions from new Jira comments</b><br /><span className="muted">Only comments that read like a decision ("we decided…", "agreed to…") are sent to AI.</span></span>
        </label>
        <label className="field">
          Minimum confidence to raise a conflict: {Math.round(s.minConfidence * 100)}%
          <input type="range" min={0.3} max={0.95} step={0.05} disabled={disabled} value={s.minConfidence} onChange={(e) => setS({ ...s, minConfidence: Number(e.target.value) })} />
        </label>
        <label className="field">
          Only watch these projects (comma-separated keys, empty = all)
          <input type="text" disabled={disabled} value={projectsText} onChange={(e) => setProjectsText(e.target.value)} placeholder="PAY, PLAT" />
        </label>
        <div className="row">
          <button
            className="btn primary"
            disabled={disabled || !!act.busy}
            onClick={() =>
              act.run('save', async () => {
                setS(await call<Settings>('saveSettings', { patch: { ...s, projects: projectsText.split(',').map((p) => p.trim()).filter(Boolean) } }));
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
              })
            }
          >
            Save
          </button>
          {saved && <span className="muted">Saved.</span>}
        </div>
        <ErrorBanner error={act.error} onClose={() => act.setError(null)} />
      </div>
      <div className="card stack lg">
        <h2>Sample data</h2>
        <p className="muted">{setup.counts.samples} sample decisions loaded.</p>
        <div className="row">
          <button className="btn" disabled={!!act.busy} onClick={() => act.run('seed', async () => { await call('seedSamples'); onChange(); })}>Load samples</button>
          <button className="btn subtle danger" disabled={disabled || !!act.busy || !setup.counts.samples} onClick={() => act.run('rm', async () => { await call('removeSamples'); onChange(); })}>
            Remove samples
          </button>
        </div>
        <div className="stack">
          <h3>Demo work items</h3>
          <div className="row">
            <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
              {setup.projects.map((p) => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
            </select>
            <button className="btn" disabled={!project || !!act.busy} onClick={() => act.run('demo', async () => setCreated((await call<{ keys: string[] }>('createDemoIssues', { projectKey: project })).keys))}>
              Create 5 demo work items
            </button>
          </div>
          {created.length > 0 && <p className="muted">Created {created.join(', ')}.</p>}
        </div>
      </div>
    </div>
  );
}
