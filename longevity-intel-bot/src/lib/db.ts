import { neon } from "@neondatabase/serverless";
import { promises as fs } from "fs";
import path from "path";
import { config } from "./config";
import { defaultSources } from "./default-sources";
import type { Candidate, DashboardData, Report, RunRecord, Source } from "./types";
import { stableId, todayIsoDate } from "./utils";

type DbRow = Record<string, unknown>;

const sql = config.databaseUrl ? neon(config.databaseUrl) : null;
let schemaReady = false;

const memory = {
  sources: [...defaultSources],
  candidates: [] as Candidate[],
  reports: [] as Report[],
  runs: [] as RunRecord[]
};
let localLoaded = false;
const localStorePath = path.join(process.cwd(), "data", "local-store.json");

export function hasDatabase() {
  return Boolean(sql);
}

async function loadLocalStore() {
  if (sql || localLoaded) return;
  localLoaded = true;
  try {
    const raw = await fs.readFile(localStorePath, "utf8");
    const parsed = JSON.parse(raw) as typeof memory;
    memory.sources = parsed.sources?.length ? normalizeSources(parsed.sources) : [...defaultSources];
    memory.candidates = parsed.candidates ?? [];
    memory.reports = parsed.reports ?? [];
    memory.runs = parsed.runs ?? [];
  } catch {
    memory.sources = [...defaultSources];
  }
}

async function persistLocalStore() {
  if (sql) return;
  await fs.mkdir(path.dirname(localStorePath), { recursive: true });
  await fs.writeFile(localStorePath, JSON.stringify(memory, null, 2));
}

async function ensureSchema() {
  if (!sql || schemaReady) return;

  await sql`
    create table if not exists sources (
      id text primary key,
      name text not null,
      type text not null,
      url text not null default '',
      enabled boolean not null default true,
      credibility_weight integer not null default 50,
      notes text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;

  await sql`
    create table if not exists candidates (
      id text primary key,
      source_id text not null,
      source_name text not null,
      source_type text not null,
      title text not null,
      url text not null,
      summary text not null default '',
      published_at timestamptz,
      authors text,
      journal text,
      raw jsonb not null default '{}'::jsonb,
      credibility text not null default 'Medium',
      evidence_type text not null default 'Unknown',
      impact_score integer not null default 50,
      ai_reason text not null default '',
      created_at timestamptz not null default now()
    )
  `;

  await sql`
    create table if not exists reports (
      id text primary key,
      report_date date not null unique,
      title text not null,
      summary text not null default '',
      content_markdown text not null,
      content_json jsonb not null,
      status text not null default 'generated',
      sent_at timestamptz,
      delivery_response jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;

  await sql`
    create table if not exists runs (
      id text primary key,
      status text not null,
      started_at timestamptz not null,
      finished_at timestamptz,
      message text not null default '',
      fetched_count integer not null default 0,
      selected_count integer not null default 0,
      quality_json jsonb
    )
  `;

  await sql`alter table runs add column if not exists quality_json jsonb`;

  schemaReady = true;

  const rows = await sql`select count(*)::int as count from sources`;
  if (Number(rows[0]?.count ?? 0) === 0) {
    for (const source of defaultSources) {
      await upsertSource(source);
    }
  }
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function sourceFromRow(row: DbRow): Source {
  return {
    id: String(row.id),
    name: String(row.name),
    type: String(row.type) as Source["type"],
    url: String(row.url ?? ""),
    enabled: Boolean(row.enabled),
    credibilityWeight: Number(row.credibility_weight ?? 50),
    notes: String(row.notes ?? ""),
    createdAt: iso(row.created_at) ?? undefined,
    updatedAt: iso(row.updated_at) ?? undefined
  };
}

function candidateFromRow(row: DbRow): Candidate {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    sourceName: String(row.source_name),
    sourceType: String(row.source_type) as Candidate["sourceType"],
    title: String(row.title),
    url: String(row.url),
    summary: String(row.summary ?? ""),
    publishedAt: iso(row.published_at),
    authors: row.authors ? String(row.authors) : undefined,
    journal: row.journal ? String(row.journal) : undefined,
    raw: (row.raw ?? {}) as Record<string, unknown>,
    credibility: String(row.credibility ?? "Medium") as Candidate["credibility"],
    evidenceType: String(row.evidence_type ?? "Unknown") as Candidate["evidenceType"],
    impactScore: Number(row.impact_score ?? 50),
    aiReason: String(row.ai_reason ?? ""),
    createdAt: iso(row.created_at) ?? undefined
  };
}

function reportFromRow(row: DbRow): Report {
  return {
    id: String(row.id),
    reportDate: String(row.report_date).slice(0, 10),
    title: String(row.title),
    summary: String(row.summary ?? ""),
    contentMarkdown: String(row.content_markdown ?? ""),
    contentJson: row.content_json as Report["contentJson"],
    status: String(row.status ?? "generated") as Report["status"],
    sentAt: iso(row.sent_at),
    deliveryResponse: (row.delivery_response ?? null) as Report["deliveryResponse"],
    createdAt: iso(row.created_at) ?? undefined,
    updatedAt: iso(row.updated_at) ?? undefined
  };
}

function runFromRow(row: DbRow): RunRecord {
  return {
    id: String(row.id),
    status: String(row.status) as RunRecord["status"],
    startedAt: iso(row.started_at) ?? new Date().toISOString(),
    finishedAt: iso(row.finished_at),
    message: String(row.message ?? ""),
    fetchedCount: Number(row.fetched_count ?? 0),
    selectedCount: Number(row.selected_count ?? 0),
    quality: (row.quality_json ?? null) as RunRecord["quality"]
  };
}

export async function getSources() {
  if (!sql) {
    await loadLocalStore();
    return memory.sources;
  }
  await ensureSchema();
  const rows = await sql`select * from sources order by enabled desc, credibility_weight desc, name asc`;
  return normalizeSources(rows.map(sourceFromRow));
}

export async function upsertSource(source: Source) {
  if (!sql) {
    await loadLocalStore();
    const index = memory.sources.findIndex((item) => item.id === source.id);
    if (index >= 0) memory.sources[index] = source;
    else memory.sources.push(source);
    await persistLocalStore();
    return source;
  }

  await ensureSchema();
  await sql`
    insert into sources (id, name, type, url, enabled, credibility_weight, notes, updated_at)
    values (
      ${source.id},
      ${source.name},
      ${source.type},
      ${source.url},
      ${source.enabled},
      ${source.credibilityWeight},
      ${source.notes},
      now()
    )
    on conflict (id) do update set
      name = excluded.name,
      type = excluded.type,
      url = excluded.url,
      enabled = excluded.enabled,
      credibility_weight = excluded.credibility_weight,
      notes = excluded.notes,
      updated_at = now()
  `;
  return source;
}

export async function updateSource(id: string, patch: Partial<Source>) {
  const sources = await getSources();
  const existing = sources.find((source) => source.id === id);
  if (!existing) throw new Error(`Source not found: ${id}`);
  return upsertSource({ ...existing, ...patch, id });
}

export async function saveCandidates(candidates: Candidate[]) {
  if (!sql) {
    await loadLocalStore();
    const next = new Map(memory.candidates.map((candidate) => [candidate.id, candidate]));
    for (const candidate of candidates) next.set(candidate.id, candidate);
    memory.candidates = [...next.values()].sort(sortCandidatesByDate).slice(0, 300);
    await persistLocalStore();
    return;
  }

  await ensureSchema();
  for (const candidate of candidates) {
    await sql`
      insert into candidates (
        id,
        source_id,
        source_name,
        source_type,
        title,
        url,
        summary,
        published_at,
        authors,
        journal,
        raw,
        credibility,
        evidence_type,
        impact_score,
        ai_reason
      )
      values (
        ${candidate.id},
        ${candidate.sourceId},
        ${candidate.sourceName},
        ${candidate.sourceType},
        ${candidate.title},
        ${candidate.url},
        ${candidate.summary},
        ${candidate.publishedAt},
        ${candidate.authors ?? null},
        ${candidate.journal ?? null},
        ${JSON.stringify(candidate.raw ?? {})},
        ${candidate.credibility},
        ${candidate.evidenceType},
        ${candidate.impactScore},
        ${candidate.aiReason}
      )
      on conflict (id) do update set
        source_id = excluded.source_id,
        source_name = excluded.source_name,
        source_type = excluded.source_type,
        title = excluded.title,
        url = excluded.url,
        summary = excluded.summary,
        published_at = excluded.published_at,
        authors = excluded.authors,
        journal = excluded.journal,
        raw = excluded.raw,
        credibility = excluded.credibility,
        evidence_type = excluded.evidence_type,
        impact_score = excluded.impact_score,
        ai_reason = excluded.ai_reason
    `;
  }
}

export async function getRecentCandidates(limit = 80) {
  if (!sql) {
    await loadLocalStore();
    return memory.candidates.sort(sortCandidatesByDate).slice(0, limit);
  }
  await ensureSchema();
  const rows = await sql`
    select *
    from candidates
    order by coalesce(published_at, created_at) desc
    limit ${limit}
  `;
  return rows.map(candidateFromRow);
}

export async function saveReport(report: Report) {
  if (!sql) {
    await loadLocalStore();
    const index = memory.reports.findIndex((item) => item.id === report.id);
    if (index >= 0) memory.reports[index] = report;
    else memory.reports.unshift(report);
    await persistLocalStore();
    return report;
  }

  await ensureSchema();
  await sql`
    insert into reports (
      id,
      report_date,
      title,
      summary,
      content_markdown,
      content_json,
      status,
      sent_at,
      delivery_response,
      updated_at
    )
    values (
      ${report.id},
      ${report.reportDate},
      ${report.title},
      ${report.summary},
      ${report.contentMarkdown},
      ${JSON.stringify(report.contentJson)},
      ${report.status},
      ${report.sentAt},
      ${report.deliveryResponse ? JSON.stringify(report.deliveryResponse) : null},
      now()
    )
    on conflict (report_date) do update set
      title = excluded.title,
      summary = excluded.summary,
      content_markdown = excluded.content_markdown,
      content_json = excluded.content_json,
      status = excluded.status,
      sent_at = excluded.sent_at,
      delivery_response = excluded.delivery_response,
      updated_at = now()
  `;

  return report;
}

export async function getLatestReport() {
  if (!sql) {
    await loadLocalStore();
    return memory.reports[0] ?? null;
  }
  await ensureSchema();
  const rows = await sql`
    select *
    from reports
    order by report_date desc, updated_at desc
    limit 1
  `;
  return rows[0] ? reportFromRow(rows[0]) : null;
}

export async function getReport(id: string) {
  if (!sql) {
    await loadLocalStore();
    return memory.reports.find((report) => report.id === id) ?? null;
  }
  await ensureSchema();
  const rows = await sql`select * from reports where id = ${id} limit 1`;
  return rows[0] ? reportFromRow(rows[0]) : null;
}

export async function saveRun(run: RunRecord) {
  if (!sql) {
    await loadLocalStore();
    const index = memory.runs.findIndex((item) => item.id === run.id);
    if (index >= 0) memory.runs[index] = run;
    else memory.runs.unshift(run);
    await persistLocalStore();
    return run;
  }

  await ensureSchema();
  await sql`
    insert into runs (id, status, started_at, finished_at, message, fetched_count, selected_count, quality_json)
    values (
      ${run.id},
      ${run.status},
      ${run.startedAt},
      ${run.finishedAt},
      ${run.message},
      ${run.fetchedCount},
      ${run.selectedCount},
      ${run.quality ? JSON.stringify(run.quality) : null}
    )
    on conflict (id) do update set
      status = excluded.status,
      finished_at = excluded.finished_at,
      message = excluded.message,
      fetched_count = excluded.fetched_count,
      selected_count = excluded.selected_count,
      quality_json = excluded.quality_json
  `;
  return run;
}

export async function getRuns(limit = 8) {
  if (!sql) {
    await loadLocalStore();
    return memory.runs.slice(0, limit);
  }
  await ensureSchema();
  const rows = await sql`
    select *
    from runs
    order by started_at desc
    limit ${limit}
  `;
  return rows.map(runFromRow);
}

export async function getDashboardData(): Promise<DashboardData> {
  const [sources, candidates, latestReport, runs] = await Promise.all([
    getSources(),
    getRecentCandidates(80),
    getLatestReport(),
    getRuns(8)
  ]);

  return {
    sources,
    candidates,
    latestReport,
    runs,
    stats: {
      enabledSources: sources.filter((source) => source.enabled).length,
      candidateCount: candidates.length,
      latestRunStatus: runs[0]?.status ?? "not run",
      lastSentAt: latestReport?.sentAt ?? null
    }
  };
}

export function buildReportShell(date = todayIsoDate()): Report {
  return {
    id: stableId(`report:${date}`),
    reportDate: date,
    title: `Longevity 日报 - ${date}`,
    summary: "",
    contentMarkdown: `# Longevity 日报 - ${date}\n\n还没有生成今日报告。点击“运行今日扫描”开始。`,
    contentJson: {
      reportTitle: `Longevity 日报 - ${date}`,
      executiveSummary: "",
      takeaways: [],
      items: []
    },
    status: "draft",
    sentAt: null,
    deliveryResponse: null
  };
}

function sortCandidatesByDate(a: Candidate, b: Candidate) {
  const left = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
  const right = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
  return right - left;
}

function normalizeSources(sources: Source[]) {
  const defaultById = new Map(defaultSources.map((source) => [source.id, source]));
  return sources.map((source) => {
    const defaults = defaultById.get(source.id);
    if (!defaults) return source;

    return {
      ...source,
      name: defaults.name,
      notes: defaults.notes,
      url: defaults.url || source.url,
      enabled: isCredentialBlockedSource(source.id) ? false : source.enabled,
      credibilityWeight: Number.isFinite(source.credibilityWeight)
        ? source.credibilityWeight
        : defaults.credibilityWeight
    };
  });
}

function isCredentialBlockedSource(sourceId: string) {
  if (sourceId === "tavily-web-longevity") return !config.tavilyApiKey;
  if (sourceId === "x-placeholder") return true;
  return false;
}
