export type DecisionStatus = 'active' | 'proposed' | 'superseded' | 'reversed';
export type DecisionSource = 'jira-comment' | 'jira-issue' | 'confluence' | 'manual' | 'rovo' | 'sample';

export interface Decision {
  id: string;
  /** One sentence, imperative: "Do not use Redis for session storage." */
  statement: string;
  /** Why it was decided. */
  rationale: string;
  /** Options considered and rejected. */
  alternatives: string[];
  /** Normalised search terms incl. synonyms, used for retrieval. */
  keywords: string[];
  /** Systems / components / areas the decision applies to. */
  scope: string[];
  /** Conditions under which the decision should be revisited ("if traffic > 10k rps"). */
  revisitWhen: string;
  status: DecisionStatus;
  ownerAccountId: string;
  ownerName: string;
  source: DecisionSource;
  sourceUrl: string;
  /** Stable reference used for de-duplication, e.g. "jira-comment:PAY-12:10042". */
  sourceRef: string;
  sourceTitle: string;
  /** Jira project key the decision belongs to, or "" for org-wide. */
  project: string;
  /** Extraction confidence 0..1 (1 for manual). */
  confidence: number;
  /** ISO date the decision was made. */
  decidedAt: string;
  createdAt: number;
  updatedAt: number;
  supersededBy: string;
  supersedes: string;
}

export type Relation = 'contradicts' | 'revisits' | 'aligned';
export type FindingStatus = 'open' | 'acknowledged' | 'dismissed' | 'resolved';

export interface Finding {
  id: string;
  issueKey: string;
  issueSummary: string;
  project: string;
  decisionId: string;
  relation: Relation;
  confidence: number;
  explanation: string;
  suggestion: string;
  status: FindingStatus;
  method: 'llm' | 'heuristic';
  commented: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  /** Post a Jira comment when a high-confidence contradiction is found. */
  autoComment: boolean;
  /** Extract decisions from new Jira comments automatically. */
  captureFromComments: boolean;
  /** Minimum confidence to raise a finding. */
  minConfidence: number;
  /** Restrict automatic checks to these project keys (empty = all). */
  projects: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  autoComment: true,
  captureFromComments: true,
  minConfidence: 0.6,
  projects: [],
};

/** Shape produced by extraction before it is persisted. */
export interface ExtractedDecision {
  statement: string;
  rationale: string;
  alternatives: string[];
  keywords: string[];
  scope: string[];
  revisitWhen: string;
  ownerName: string;
  decidedAt: string;
  confidence: number;
}

export interface Judgement {
  decisionId: string;
  relation: Relation | 'unrelated';
  confidence: number;
  explanation: string;
  suggestion: string;
}

export interface WorkItem {
  key: string;
  summary: string;
  description: string;
  project: string;
}
