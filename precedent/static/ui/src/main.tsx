import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import { IssuePanel } from './IssuePanel';
import { DecisionLog } from './DecisionLog';
import { Spinner } from './shared';
import './styles.css';

type Ctx = { moduleKey?: string; extension?: { issue?: { key?: string } } };

function App() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  useEffect(() => {
    void view.theme.enable().catch(() => undefined);
    void view.getContext().then((c) => setCtx(c as unknown as Ctx));
  }, []);
  if (!ctx) return <Spinner label="Loading Precedent…" />;
  const issueKey = ctx.extension?.issue?.key;
  if (ctx.moduleKey === 'precedent-issue-panel' && issueKey) return <IssuePanel issueKey={issueKey} />;
  return <DecisionLog />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
