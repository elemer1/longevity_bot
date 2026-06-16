export type SourceType =
  | "rss"
  | "pubmed"
  | "arxiv"
  | "reddit"
  | "tavily"
  | "x"
  | "manual";

export type Source = {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  enabled: boolean;
  credibilityWeight: number;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Candidate = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  title: string;
  url: string;
  summary: string;
  publishedAt: string | null;
  authors?: string;
  journal?: string;
  raw?: Record<string, unknown>;
  credibility: CredibilityLabel;
  evidenceType: EvidenceType;
  impactScore: number;
  aiReason: string;
  createdAt?: string;
};

export type CredibilityLabel = "High" | "Medium" | "Low";

export type EvidenceType =
  | "Human RCT"
  | "Human Observational"
  | "Clinical Trial"
  | "Preclinical In Vivo"
  | "Preclinical In Vitro"
  | "Preprint"
  | "Review"
  | "Anecdote"
  | "Industry"
  | "Unknown";

export type Actionability = "Now" | "Watch" | "Ignore";

export type RankedItem = {
  candidateId: string;
  rank: number;
  translatedTitle: string;
  oneLine: string;
  background?: string;
  mechanism?: string;
  evidenceSummary?: string;
  explanation: string;
  whyImportant: string;
  credibility: CredibilityLabel;
  evidenceType: EvidenceType;
  impactScore: number;
  actionability: Actionability;
  caveats: string;
  teamImplication?: string;
  watchNext?: string;
  sourceLabel: string;
  originalUrl: string;
  aiRationale: string;
};

export type ReportContent = {
  reportTitle: string;
  executiveSummary: string;
  takeaways: string[];
  items: RankedItem[];
};

export type Report = {
  id: string;
  reportDate: string;
  title: string;
  summary: string;
  contentMarkdown: string;
  contentJson: ReportContent;
  status: "draft" | "generated" | "sent" | "failed";
  sentAt: string | null;
  deliveryResponse?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
};

export type SourceRunResult = {
  sourceId: string;
  name: string;
  type: SourceType;
  candidates: number;
  error?: string;
};

export type TopicRunResult = {
  topic: string;
  count: number;
};

export type RunQuality = {
  generatedAt: string;
  coverageScore: number;
  totalSources: number;
  enabledSources: number;
  successfulSources: number;
  warningSources: number;
  emptySources: number;
  totalCandidates: number;
  selectedCount: number;
  highCredibilityCount: number;
  humanEvidenceCount: number;
  communitySignalCount: number;
  sourceBreakdown: SourceRunResult[];
  topicBreakdown: TopicRunResult[];
  warnings: string[];
};

export type RunRecord = {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  message: string;
  fetchedCount: number;
  selectedCount: number;
  quality?: RunQuality | null;
};

export type DashboardData = {
  sources: Source[];
  candidates: Candidate[];
  latestReport: Report | null;
  runs: RunRecord[];
  stats: {
    enabledSources: number;
    candidateCount: number;
    latestRunStatus: string;
    lastSentAt: string | null;
  };
};
