"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  History,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  UsersRound
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Candidate, DashboardData, Report, RunRecord, Source, SourceType } from "@/lib/types";

type Props = {
  initialData: DashboardData;
};

type Tab = "daily" | "sources" | "candidates" | "history" | "settings";

const sourceTypes: SourceType[] = ["rss", "pubmed", "arxiv", "reddit", "tavily", "manual"];

type SettingsStatus = {
  generatedAt: string;
  appName: string;
  storage: StatusBlock;
  deepseek: StatusBlock & { model: string; baseUrl: string };
  lark: StatusBlock & { signed: boolean };
  cron: { endpoint: string; schedule: string; protected: boolean; detail: string };
  tavily: StatusBlock;
  admin: { protected: boolean; detail: string };
  latestRun: RunRecord | null;
  latestReport: {
    id: string;
    title: string;
    status: Report["status"];
    sentAt: string | null;
    reportDate: string;
  } | null;
  warnings: string[];
};

type StatusBlock = {
  configured: boolean;
  label?: string;
  detail: string;
};

type SettingsAction = "test-lark" | "test-deepseek";

type DeliveryResult = {
  ok?: boolean;
  skipped?: boolean;
  message?: string;
  status?: number;
};

type RunResult = {
  delivery?: DeliveryResult | null;
  report?: Report;
};

export function Dashboard({ initialData }: Props) {
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<Tab>("daily");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialData.latestReport?.contentJson.items[0]?.candidateId ?? initialData.candidates[0]?.id ?? null
  );
  const [reportMarkdown, setReportMarkdown] = useState(
    initialData.latestReport?.contentMarkdown ?? "# Longevity 日报\n\n点击“运行今日扫描”生成今日报告。"
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const didHydrate = useRef(false);

  const report = data.latestReport;
  const rankedRows = useMemo(() => buildRankedRows(report, data.candidates), [report, data.candidates]);
  const selected = rankedRows.find((row) => row.id === selectedId) ?? rankedRows[0] ?? null;

  useEffect(() => {
    if (didHydrate.current) return;
    didHydrate.current = true;
    refreshDashboard().catch((error) => {
      setNotice(error instanceof Error ? error.message : String(error));
    });
  }, []);

  async function refreshDashboard() {
    const response = await fetch("/api/dashboard");
    const next = (await response.json()) as DashboardData;
    setData(next);
    setReportMarkdown(next.latestReport?.contentMarkdown ?? reportMarkdown);
    setSelectedId(next.latestReport?.contentJson.items[0]?.candidateId ?? next.candidates[0]?.id ?? null);
    return next;
  }

  async function runDaily(send = false): Promise<RunResult> {
    setBusy(send ? "run-send" : "run");
    setNotice("");
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ send })
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as RunResult;
      const next = await refreshDashboard();
      setNotice(
        send
          ? deliveryNotice(result.delivery, `已生成并推送 ${next.latestReport?.contentJson.items.length ?? 0} 条日报内容。`)
          : `已生成 ${next.latestReport?.contentJson.items.length ?? 0} 条日报内容。`
      );
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setBusy(null);
    }
  }

  async function saveReport() {
    if (!report) return;
    setBusy("save");
    setNotice("");
    try {
      const response = await fetch("/api/report", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: report.id, contentMarkdown: reportMarkdown, status: "draft" })
      });
      if (!response.ok) throw new Error(await response.text());
      await refreshDashboard();
      setNotice("日报已保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function sendReport(): Promise<DeliveryResult | undefined> {
    if (!report) return undefined;
    setBusy("send");
    setNotice("");
    try {
      await saveReport();
      const response = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: report.id })
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { delivery?: DeliveryResult };
      await refreshDashboard();
      setNotice(deliveryNotice(result.delivery, "当前日报已推送到 Lark。"));
      return result.delivery;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setBusy(null);
    }
  }

  async function toggleSource(source: Source) {
    setBusy(source.id);
    await fetch("/api/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, enabled: !source.enabled })
    });
    await refreshDashboard();
    setBusy(null);
  }

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") ?? ""),
      type: String(form.get("type") ?? "rss"),
      url: String(form.get("url") ?? ""),
      credibilityWeight: Number(form.get("credibilityWeight") ?? 50),
      notes: String(form.get("notes") ?? "")
    };
    setBusy("source-add");
    await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    event.currentTarget.reset();
    await refreshDashboard();
    setBusy(null);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <span>COMPOUND</span>
        </div>
        <nav className="side-nav">
          <NavButton tab="sources" activeTab={activeTab} setActiveTab={setActiveTab} icon={<Database />} label="信源管理" />
          <NavButton tab="candidates" activeTab={activeTab} setActiveTab={setActiveTab} icon={<UsersRound />} label="候选内容" />
          <NavButton tab="daily" activeTab={activeTab} setActiveTab={setActiveTab} icon={<FileText />} label="今日日报" />
          <NavButton tab="history" activeTab={activeTab} setActiveTab={setActiveTab} icon={<History />} label="运行历史" />
          <NavButton tab="settings" activeTab={activeTab} setActiveTab={setActiveTab} icon={<Settings />} label="系统设置" />
        </nav>
        <div className="operator">
          <div className="avatar">AK</div>
          <div>
            <strong>内部运营</strong>
            <span>管理员</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{tabTitle(activeTab)}</h1>
            <p>Longevity 科学情报后台</p>
          </div>
          <div className="topbar-actions">
            <div className="date-chip">
              <CalendarDays size={16} />
              {formatDate(report?.reportDate ?? new Date().toISOString())}
            </div>
            <div className={`run-chip ${data.stats.latestRunStatus}`}>
              <span />
              {statusLabel(data.stats.latestRunStatus)}
            </div>
            <button className="secondary-button" onClick={() => refreshDashboard()} disabled={Boolean(busy)}>
              <RefreshCw size={16} />
              刷新
            </button>
            <button className="primary-button" onClick={() => sendReport()} disabled={!report || Boolean(busy)}>
              <Send size={16} />
              推送到 Lark
            </button>
          </div>
        </header>

        {notice ? <div className="notice">{notice}</div> : null}

        {activeTab === "daily" ? (
          <DailyReportView
            data={data}
            report={report}
            rankedRows={rankedRows}
            selected={selected}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            reportMarkdown={reportMarkdown}
            setReportMarkdown={setReportMarkdown}
            runDaily={runDaily}
            saveReport={saveReport}
            busy={busy}
          />
        ) : null}

        {activeTab === "sources" ? (
          <SourcesView data={data} addSource={addSource} toggleSource={toggleSource} busy={busy} />
        ) : null}

        {activeTab === "candidates" ? <CandidatesView candidates={data.candidates} /> : null}

        {activeTab === "history" ? <HistoryView data={data} /> : null}

        {activeTab === "settings" ? (
          <SettingsView
            data={data}
            report={report}
            busy={busy}
            runDaily={runDaily}
            sendReport={sendReport}
            refreshDashboard={refreshDashboard}
          />
        ) : null}
      </section>
    </main>
  );
}

function DailyReportView({
  data,
  report,
  rankedRows,
  selected,
  selectedId,
  setSelectedId,
  reportMarkdown,
  setReportMarkdown,
  runDaily,
  saveReport,
  busy
}: {
  data: DashboardData;
  report: Report | null;
  rankedRows: RankedRow[];
  selected: RankedRow | null;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  reportMarkdown: string;
  setReportMarkdown: (value: string) => void;
  runDaily: (send?: boolean) => void;
  saveReport: () => void;
  busy: string | null;
}) {
  return (
    <div className="dashboard-grid">
      <div className="main-column">
        <QualityOverview data={data} />

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>今日 Longevity 核心候选</h2>
              <p>按 AI 判断的科学重要性、证据强度和转化潜力排序</p>
            </div>
            <div className="panel-actions">
              <span className="mini-metric">
                <Database size={15} />
                候选 {data.candidates.length}
              </span>
              <span className="mini-metric">
                <Activity size={15} />
                来源 {data.stats.enabledSources}
              </span>
              <button className="secondary-button" onClick={() => runDaily(false)} disabled={Boolean(busy)}>
                <RefreshCw size={16} />
                {busy === "run" ? "扫描中..." : "运行今日扫描"}
              </button>
            </div>
          </div>

          <div className="candidate-table" role="table">
            <div className="candidate-row candidate-head" role="row">
              <span>排序</span>
              <span>候选内容</span>
              <span>可信度</span>
              <span>证据类型</span>
              <span>影响评分</span>
              <span>信源类型</span>
              <span>时间</span>
            </div>
            {rankedRows.slice(0, 5).map((row, index) => (
              <button
                className={`candidate-row ${selectedId === row.id ? "selected" : ""}`}
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                role="row"
              >
                <span className="rank-number">{row.rank ?? index + 1}</span>
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.subtitle}</small>
                </span>
                <span>
                  <Badge label={row.credibility} />
                </span>
                <span>
                  <strong>{evidenceLabel(row.evidenceType)}</strong>
                  <small>{actionLabel(row.phase)}</small>
                </span>
                <span>
                  <strong>{row.impactScore}</strong>
                  <span className="score-bar">
                    <i style={{ width: `${row.impactScore}%` }} />
                  </span>
                </span>
                <span>{sourceTypeLabel(row.sourceType)}</span>
                <span>{formatDateTime(row.publishedAt)}</span>
              </button>
            ))}
          </div>
          <div className="table-foot">
            显示 {Math.min(rankedRows.length, 5)} / {data.candidates.length} 条候选
            <span>影响评分：AI 预测的 longevity 相关影响，范围 0-100</span>
          </div>
        </section>

        <section className="panel editor-panel">
          <div className="panel-header">
            <div>
              <h2>日报预览</h2>
              <p>{statusLabel(report?.status ?? "draft")}</p>
            </div>
            <div className="panel-actions">
              <span className="char-count">{reportMarkdown.length} 字符</span>
              <button className="secondary-button" onClick={saveReport} disabled={!report || Boolean(busy)}>
                <Save size={16} />
                {busy === "save" ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
          <textarea
            className="report-editor"
            value={reportMarkdown}
            onChange={(event) => setReportMarkdown(event.target.value)}
            spellCheck={false}
          />
        </section>
      </div>

      <aside className="inspector">
        <div className="inspector-tabs">
          <strong>详情</strong>
          <span>动态</span>
        </div>
        {selected ? (
          <>
            <section>
              <p className="eyebrow">当前选中</p>
              <h3>{selected.title}</h3>
              <p>{selected.subtitle}</p>
              <div className="big-score">
                <strong>{selected.impactScore}</strong>
                <span>/100</span>
              </div>
              <div className="score-bar wide">
                <i style={{ width: `${selected.impactScore}%` }} />
              </div>
            </section>
            <section>
              <h4>AI 排序理由</h4>
              <p>{selected.rationale}</p>
            </section>
            <section>
              <h4>信源信息</h4>
              <dl>
                <dt>来源</dt>
                <dd>{selected.sourceLabel}</dd>
                <dt>证据</dt>
                <dd>{evidenceLabel(selected.evidenceType)}</dd>
                <dt>可信度</dt>
                <dd>
                  <Badge label={selected.credibility} />
                </dd>
                <dt>链接</dt>
                <dd>
                  <a href={selected.url} target="_blank" rel="noreferrer">
                    查看原文
                  </a>
                </dd>
              </dl>
            </section>
          </>
        ) : (
          <p className="empty-state">运行今日扫描后，这里会显示候选内容详情。</p>
        )}
      </aside>
    </div>
  );
}

function QualityOverview({ data }: { data: DashboardData }) {
  const quality = data.runs[0]?.quality;
  const warnings = quality?.warnings ?? [];

  if (!quality) {
    return (
      <section className="quality-strip">
        <MetricCard icon={<BarChart3 />} label="覆盖评分" value="待生成" detail="运行今日扫描后生成质量摘要" tone="neutral" />
        <MetricCard icon={<Database />} label="候选池" value={`${data.candidates.length}`} detail="最近标准化候选内容" tone="neutral" />
        <MetricCard icon={<CheckCircle2 />} label="启用信源" value={`${data.stats.enabledSources}`} detail="当前参与抓取的来源" tone="neutral" />
      </section>
    );
  }

  return (
    <section className="quality-strip">
      <MetricCard
        icon={<BarChart3 />}
        label="覆盖评分"
        value={`${quality.coverageScore}`}
        detail={quality.coverageScore >= 72 ? "覆盖较稳" : quality.coverageScore >= 48 ? "可用但需留意" : "覆盖偏弱"}
        tone={quality.coverageScore >= 72 ? "good" : quality.coverageScore >= 48 ? "warn" : "bad"}
      />
      <MetricCard
        icon={<Database />}
        label="有结果信源"
        value={`${quality.successfulSources}/${quality.enabledSources}`}
        detail={`${quality.warningSources} 个失败，${quality.emptySources} 个为空`}
        tone={quality.warningSources ? "warn" : "good"}
      />
      <MetricCard
        icon={<CheckCircle2 />}
        label="人体/临床证据"
        value={`${quality.humanEvidenceCount}`}
        detail={`高可信候选 ${quality.highCredibilityCount} 条`}
        tone={quality.humanEvidenceCount ? "good" : "warn"}
      />
      <MetricCard
        icon={<AlertTriangle />}
        label="质量警告"
        value={`${warnings.length}`}
        detail={warnings[0] ?? "暂无明显覆盖风险"}
        tone={warnings.length ? "warn" : "good"}
      />
      {quality.topicBreakdown.length ? (
        <div className="topic-cloud" aria-label="本轮主题分布">
          {quality.topicBreakdown.slice(0, 6).map((item) => (
            <span key={item.topic}>
              {item.topic}
              <strong>{item.count}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </div>
  );
}

function SourcesView({
  data,
  addSource,
  toggleSource,
  busy
}: {
  data: DashboardData;
  addSource: (event: FormEvent<HTMLFormElement>) => void;
  toggleSource: (source: Source) => void;
  busy: string | null;
}) {
  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>信源覆盖</h2>
            <p>{data.stats.enabledSources} 个信源已启用</p>
          </div>
        </div>
        <div className="source-list">
          {data.sources.map((source) => (
            <div className="source-row" key={source.id}>
              <div>
                <strong>{source.name}</strong>
                <span>
                  {sourceTypeLabel(source.type)} · 可信权重 {source.credibilityWeight}
                  {source.type === "x" ? " · 适配器未接入" : ""}
                </span>
                <small>{source.url || source.notes}</small>
              </div>
              <button
                className={`toggle ${source.enabled ? "on" : ""}`}
                onClick={() => toggleSource(source)}
                disabled={busy === source.id || source.type === "x"}
                aria-label={`切换 ${source.name}`}
              >
                <i />
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel add-source">
        <div className="panel-header">
          <div>
            <h2>新增信源</h2>
            <p>支持 RSS、PubMed 检索式、arXiv 检索式、Reddit RSS、Tavily 和手动信源</p>
          </div>
        </div>
        <form onSubmit={addSource}>
          <label>
            名称
            <input name="name" placeholder="Nature Biotechnology" required />
          </label>
          <label>
            类型
            <select name="type" defaultValue="rss">
              {sourceTypes.map((type) => (
                <option key={type} value={type}>
                  {sourceTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            URL 或检索式
            <input name="url" placeholder="https://... 或 PubMed/arXiv 检索式" />
          </label>
          <label>
            可信权重
            <input name="credibilityWeight" type="number" min="0" max="100" defaultValue="60" />
          </label>
          <label>
            备注
            <textarea name="notes" placeholder="这个信源应该如何被排序器理解？" />
          </label>
          <button className="primary-button" type="submit" disabled={busy === "source-add"}>
            <Plus size={16} />
            新增信源
          </button>
        </form>
      </section>
    </div>
  );
}

function CandidatesView({ candidates }: { candidates: Candidate[] }) {
  const [query, setQuery] = useState("");
  const [sourceType, setSourceType] = useState("all");
  const [credibility, setCredibility] = useState("all");
  const [sortBy, setSortBy] = useState("impact");

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return candidates
      .filter((candidate) => {
        const text = `${candidate.title} ${candidate.summary} ${candidate.sourceName} ${candidate.journal ?? ""}`.toLowerCase();
        return (
          (!normalizedQuery || text.includes(normalizedQuery)) &&
          (sourceType === "all" || candidate.sourceType === sourceType) &&
          (credibility === "all" || candidate.credibility === credibility)
        );
      })
      .sort((a, b) => {
        if (sortBy === "time") {
          return dateValue(b.publishedAt) - dateValue(a.publishedAt);
        }
        if (sortBy === "credibility") {
          return credibilityValue(b.credibility) - credibilityValue(a.credibility) || b.impactScore - a.impactScore;
        }
        return b.impactScore - a.impactScore || dateValue(b.publishedAt) - dateValue(a.publishedAt);
      });
  }, [candidates, credibility, query, sortBy, sourceType]);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>候选内容收件箱</h2>
          <p>
            显示 {filtered.length} / {candidates.length} 条，来自所有启用信源的近期标准化记录
          </p>
        </div>
      </div>
      <div className="filter-bar">
        <label className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、摘要、来源或期刊"
          />
        </label>
        <label>
          来源类型
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
            <option value="all">全部来源</option>
            {sourceTypes.map((type) => (
              <option key={type} value={type}>
                {sourceTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <label>
          可信度
          <select value={credibility} onChange={(event) => setCredibility(event.target.value)}>
            <option value="all">全部可信度</option>
            <option value="High">高</option>
            <option value="Medium">中</option>
            <option value="Low">低</option>
          </select>
        </label>
        <label>
          排序
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="impact">影响评分</option>
            <option value="time">发布时间</option>
            <option value="credibility">可信度</option>
          </select>
        </label>
      </div>
      <div className="inbox-list">
        {filtered.map((candidate) => (
          <article key={candidate.id} className="inbox-item">
            <div>
              <strong>{candidate.title}</strong>
              <p>{candidate.summary}</p>
              <small>
                {candidate.sourceName} · {formatDateTime(candidate.publishedAt)}
              </small>
            </div>
            <div className="inbox-meta">
              <span className="topic-pill">{candidateTopic(candidate)}</span>
              <Badge label={candidate.credibility} />
              <span>{evidenceLabel(candidate.evidenceType)}</span>
              <strong>{candidate.impactScore}</strong>
            </div>
          </article>
        ))}
        {!filtered.length ? <p className="empty-state">没有符合当前筛选条件的候选内容。</p> : null}
      </div>
    </section>
  );
}

function HistoryView({ data }: { data: DashboardData }) {
  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>运行历史</h2>
            <p>抓取、排序、生成和推送 loop 的状态</p>
          </div>
        </div>
        <div className="history-list">
          {data.runs.map((run) => (
            <div className="history-row" key={run.id}>
              <div className={`status-dot ${run.status}`} />
              <div>
                <strong>{statusLabel(run.status)}</strong>
                <span>{runMessageLabel(run.message)}</span>
              </div>
              <small>
                抓取 {run.fetchedCount} 条 · 选中 {run.selectedCount} 条 · {formatDateTime(run.startedAt)}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>最近一次推送</h2>
            <p>{statusLabel(data.latestReport?.status ?? "not run")}</p>
          </div>
        </div>
        {data.runs[0]?.quality ? (
          <div className="run-quality-detail">
            <div>
              <strong>{data.runs[0].quality.coverageScore}</strong>
              <span>覆盖评分</span>
            </div>
            <div>
              <strong>{data.runs[0].quality.successfulSources}/{data.runs[0].quality.enabledSources}</strong>
              <span>有结果信源</span>
            </div>
            <div>
              <strong>{data.runs[0].quality.humanEvidenceCount}</strong>
              <span>人体/临床证据</span>
            </div>
            <div>
              <strong>{data.runs[0].quality.highCredibilityCount}</strong>
              <span>高可信候选</span>
            </div>
            {data.runs[0].quality.topicBreakdown.length ? (
              <p>
                主题分布：
                {data.runs[0].quality.topicBreakdown
                  .slice(0, 5)
                  .map((item) => `${item.topic} ${item.count}`)
                  .join("、")}
              </p>
            ) : null}
            {data.runs[0].quality.warnings.length ? (
              <p className="warning-text">
                {data.runs[0].quality.warnings.slice(0, 2).join("；")}
              </p>
            ) : null}
          </div>
        ) : null}
        <pre className="json-preview">
          {JSON.stringify(data.latestReport?.deliveryResponse ?? { message: "还没有推送响应。" }, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function SettingsView({
  data,
  report,
  busy,
  runDaily,
  sendReport,
  refreshDashboard
}: {
  data: DashboardData;
  report: Report | null;
  busy: string | null;
  runDaily: (send?: boolean) => Promise<RunResult>;
  sendReport: () => Promise<DeliveryResult | undefined>;
  refreshDashboard: () => Promise<DashboardData>;
}) {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [settingsBusy, setSettingsBusy] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState("");

  useEffect(() => {
    loadSettingsStatus().catch((error) => {
      setSettingsNotice(error instanceof Error ? error.message : String(error));
    });
  }, []);

  const activeBusy = Boolean(busy || settingsBusy);
  const statusWarnings = status?.warnings ?? [];

  async function loadSettingsStatus() {
    setSettingsBusy("settings-refresh");
    try {
      const response = await fetch("/api/settings");
      if (!response.ok) throw new Error(await response.text());
      const next = (await response.json()) as SettingsStatus;
      setStatus(next);
      return next;
    } finally {
      setSettingsBusy(null);
    }
  }

  async function runSettingsAction(action: SettingsAction) {
    setSettingsBusy(action);
    setSettingsNotice("");
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? JSON.stringify(result));
      if (result.status) setStatus(result.status as SettingsStatus);
      setSettingsNotice(settingsActionLabel(action, Boolean(result.ok), Boolean(result.skipped), result.message));
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsBusy(null);
    }
  }

  async function runAndRefresh(send = false) {
    setSettingsNotice("");
    try {
      const result = await runDaily(send);
      await refreshDashboard();
      await loadSettingsStatus();
      setSettingsNotice(send ? deliveryNotice(result.delivery, "已重新生成并推送日报。") : "已重新生成日报。");
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function sendCurrentAndRefresh() {
    setSettingsNotice("");
    try {
      const delivery = await sendReport();
      await refreshDashboard();
      await loadSettingsStatus();
      setSettingsNotice(deliveryNotice(delivery, "当前日报已推送到 Lark。"));
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="settings-page">
      <section className="panel settings-hero-panel">
        <div className="panel-header">
          <div>
            <h2>系统状态</h2>
            <p>{status ? `最近检查：${formatDateTime(status.generatedAt)}` : "正在读取运行配置"}</p>
          </div>
          <button className="secondary-button" onClick={() => loadSettingsStatus()} disabled={activeBusy}>
            <RefreshCw size={16} />
            {settingsBusy === "settings-refresh" ? "检查中..." : "重新检查"}
          </button>
        </div>

        <div className="settings-status-grid">
          <SettingsStatusCard
            icon={<Database />}
            title="数据存储"
            value={status?.storage.label ?? "读取中"}
            detail={status?.storage.detail ?? "检查 DATABASE_URL"}
            ok={status?.storage.configured}
          />
          <SettingsStatusCard
            icon={<Activity />}
            title="DeepSeek"
            value={status?.deepseek.configured ? status.deepseek.model : "未配置"}
            detail={status?.deepseek.detail ?? "检查 DEEPSEEK_API_KEY"}
            ok={status?.deepseek.configured}
            action={
              <button className="secondary-button compact" onClick={() => runSettingsAction("test-deepseek")} disabled={activeBusy}>
                {settingsBusy === "test-deepseek" ? "测试中..." : "测试 AI"}
              </button>
            }
          />
          <SettingsStatusCard
            icon={<Bell />}
            title="Lark 推送"
            value={status?.lark.configured ? "已配置" : "未配置"}
            detail={status?.lark.detail ?? "检查 LARK_WEBHOOK_URL"}
            ok={status?.lark.configured}
            action={
              <button className="secondary-button compact" onClick={() => runSettingsAction("test-lark")} disabled={activeBusy}>
                {settingsBusy === "test-lark" ? "发送中..." : "测试 Lark"}
              </button>
            }
          />
          <SettingsStatusCard
            icon={<Clock3 />}
            title="每日定时"
            value={status?.cron.protected ? "已保护" : "未保护"}
            detail={status ? `${status.cron.schedule} · ${status.cron.endpoint}` : "检查 CRON_SECRET"}
            ok={status?.cron.protected}
          />
          <SettingsStatusCard
            icon={<Search />}
            title="Tavily 扩展"
            value={status?.tavily.configured ? "已启用" : "未启用"}
            detail={status?.tavily.detail ?? "检查 TAVILY_API_KEY"}
            ok={status?.tavily.configured}
            neutralWhenMissing
          />
          <SettingsStatusCard
            icon={<CheckCircle2 />}
            title="后台保护"
            value={status?.admin.protected ? "已启用" : "未启用"}
            detail={status?.admin.detail ?? "检查 ADMIN_TOKEN"}
            ok={status?.admin.protected}
          />
        </div>
      </section>

      {settingsNotice ? <div className="notice settings-notice">{settingsNotice}</div> : null}

      <div className="settings-grid">
        <section className="panel settings-actions-panel">
          <div className="panel-header">
            <div>
              <h2>运行控制</h2>
              <p>直接触发一次完整 loop，或推送当前已生成日报</p>
            </div>
          </div>
          <div className="settings-action-list">
            <button className="primary-button" onClick={() => runAndRefresh(false)} disabled={activeBusy}>
              <RefreshCw size={16} />
              {busy === "run" ? "扫描中..." : "立即扫描生成"}
            </button>
            <button className="primary-button" onClick={() => runAndRefresh(true)} disabled={activeBusy}>
              <Send size={16} />
              {busy === "run-send" ? "推送中..." : "生成并推送"}
            </button>
            <button className="secondary-button" onClick={() => sendCurrentAndRefresh()} disabled={!report || activeBusy}>
              <Bell size={16} />
              推送当前日报
            </button>
          </div>
          <div className="settings-run-summary">
            <div>
              <strong>{status?.latestRun ? statusLabel(status.latestRun.status) : statusLabel(data.stats.latestRunStatus)}</strong>
              <span>最近运行状态</span>
            </div>
            <div>
              <strong>{status?.latestRun?.fetchedCount ?? data.stats.candidateCount}</strong>
              <span>最近候选数</span>
            </div>
            <div>
              <strong>{status?.latestRun?.selectedCount ?? report?.contentJson.items.length ?? 0}</strong>
              <span>日报条数</span>
            </div>
          </div>
        </section>

        <section className="panel settings-actions-panel">
          <div className="panel-header">
            <div>
              <h2>需要处理</h2>
              <p>影响云端运行稳定性的配置项</p>
            </div>
          </div>
          <div className="settings-warning-list">
            {statusWarnings.length ? (
              statusWarnings.map((warning) => (
                <div key={warning} className="settings-warning-row">
                  <AlertTriangle size={16} />
                  <span>{warning}</span>
                </div>
              ))
            ) : (
              <div className="settings-ok-row">
                <CheckCircle2 size={16} />
                <span>核心配置没有明显缺口。</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingsStatusCard({
  icon,
  title,
  value,
  detail,
  ok,
  action,
  neutralWhenMissing
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: string;
  ok?: boolean;
  action?: React.ReactNode;
  neutralWhenMissing?: boolean;
}) {
  const tone = ok ? "good" : neutralWhenMissing ? "neutral" : "warn";
  return (
    <div className={`settings-status-card ${tone}`}>
      <div className="settings-status-icon">{icon}</div>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {action ? <div className="settings-status-action">{action}</div> : null}
    </div>
  );
}

function settingsActionLabel(action: SettingsAction, ok: boolean, skipped: boolean, message?: string) {
  if (skipped) return message ?? "当前配置缺失，测试已跳过。";
  if (action === "test-lark") return ok ? "Lark 测试消息已发送。" : "Lark 测试失败，请检查 webhook。";
  if (action === "test-deepseek") return ok ? "DeepSeek 测试通过。" : "DeepSeek 测试失败，请检查 API key、模型名或余额。";
  return ok ? "测试完成。" : "测试失败。";
}

function deliveryNotice(delivery: DeliveryResult | null | undefined, successMessage: string) {
  if (delivery?.ok) return successMessage;
  if (delivery?.skipped) return `日报已生成，但未推送：${delivery.message ?? "Lark webhook 未配置。"}`;
  if (delivery) return `日报已生成，但 Lark 推送失败：${delivery.status ? `HTTP ${delivery.status}` : "请检查 webhook 配置。"}`;
  return successMessage;
}

function NavButton({
  tab,
  activeTab,
  setActiveTab,
  icon,
  label
}: {
  tab: Tab;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
      {icon}
      {label}
    </button>
  );
}

function Badge({ label }: { label: string }) {
  return <span className={`badge ${label.toLowerCase()}`}>{credibilityLabel(label)}</span>;
}

type RankedRow = {
  id: string;
  rank?: number;
  title: string;
  subtitle: string;
  credibility: string;
  evidenceType: string;
  phase: string;
  impactScore: number;
  sourceType: string;
  sourceLabel: string;
  publishedAt: string | null;
  rationale: string;
  url: string;
};

function buildRankedRows(report: Report | null, candidates: Candidate[]): RankedRow[] {
  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  if (report?.contentJson.items.length) {
    return report.contentJson.items.map((item) => {
      const candidate = candidateMap.get(item.candidateId);
      return {
        id: item.candidateId,
        rank: item.rank,
        title: item.translatedTitle,
        subtitle: item.oneLine,
        credibility: item.credibility,
        evidenceType: item.evidenceType,
        phase: item.actionability,
        impactScore: item.impactScore,
        sourceType: candidate?.sourceType ?? "source",
        sourceLabel: item.sourceLabel,
        publishedAt: candidate?.publishedAt ?? null,
        rationale: item.aiRationale,
        url: item.originalUrl
      };
    });
  }

  return candidates.slice(0, 5).map((candidate, index) => ({
    id: candidate.id,
    rank: index + 1,
    title: candidate.title,
    subtitle: candidate.summary,
    credibility: candidate.credibility,
    evidenceType: candidate.evidenceType,
    phase: candidate.sourceName,
    impactScore: candidate.impactScore,
    sourceType: candidate.sourceType,
    sourceLabel: candidate.journal ?? candidate.sourceName,
    publishedAt: candidate.publishedAt,
    rationale: candidate.aiReason,
    url: candidate.url
  }));
}

function tabTitle(tab: Tab) {
  const titles: Record<Tab, string> = {
    daily: "今日日报",
    sources: "信源管理",
    candidates: "候选内容",
    history: "运行历史",
    settings: "系统设置"
  };
  return titles[tab];
}

function formatDate(dateLike: string) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return dateLike;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatDateTime(dateLike: string | null) {
  if (!dateLike) return "未知";
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return dateLike;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function dateValue(dateLike: string | null) {
  if (!dateLike) return 0;
  const date = new Date(dateLike);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function credibilityValue(value: string) {
  const scores: Record<string, number> = {
    High: 3,
    Medium: 2,
    Low: 1
  };
  return scores[value] ?? 0;
}

function candidateTopic(candidate: Candidate) {
  const text = `${candidate.title} ${candidate.summary}`.toLowerCase();
  if (candidate.sourceType === "reddit" || candidate.evidenceType === "Anecdote") return "社区/自我实验";
  if (text.includes("clock") || text.includes("epigenetic") || text.includes("biomarker") || text.includes("biological age")) {
    return "生物年龄/指标";
  }
  if (text.includes("glp") || text.includes("metformin") || text.includes("rapamycin") || text.includes("mtor") || text.includes("nad") || text.includes("nmn")) {
    return "药物/代谢干预";
  }
  if (text.includes("autophagy") || text.includes("mitochondria") || text.includes("sirtuin") || text.includes("senescence") || text.includes("inflammaging")) {
    return "细胞机制";
  }
  if (text.includes("reprogramming") || text.includes("stem cell") || text.includes("regeneration") || text.includes("rejuvenation")) {
    return "再生/重编程";
  }
  if (text.includes("exercise") || text.includes("physical activity") || text.includes("sarcopenia") || text.includes("muscle") || text.includes("frailty")) {
    return "运动/肌肉/衰弱";
  }
  if (text.includes("brain") || text.includes("cognitive") || text.includes("dementia") || text.includes("neuro") || text.includes("white matter")) {
    return "脑健康/认知";
  }
  if (text.includes("clinical trial") || text.includes("randomized") || text.includes("cohort") || text.includes("older adults")) {
    return "人体证据";
  }
  if (text.includes("startup") || text.includes("funding") || text.includes("company") || text.includes("fda")) return "产业/监管";
  return "其他 aging 信号";
}

function credibilityLabel(value: string) {
  const labels: Record<string, string> = {
    High: "高",
    Medium: "中",
    Low: "低"
  };
  return labels[value] ?? value;
}

function evidenceLabel(value: string) {
  const labels: Record<string, string> = {
    "Human RCT": "人体随机对照试验",
    "Human Observational": "人体观察研究",
    "Clinical Trial": "临床试验",
    "Preclinical In Vivo": "动物/体内研究",
    "Preclinical In Vitro": "细胞/体外研究",
    Preprint: "预印本",
    Review: "综述",
    Anecdote: "个人经验",
    Industry: "产业动态",
    Unknown: "未知"
  };
  return labels[value] ?? value;
}

function actionLabel(value: string) {
  const labels: Record<string, string> = {
    Now: "可立即关注",
    Watch: "持续观察",
    Ignore: "暂不优先"
  };
  return labels[value] ?? value;
}

function sourceTypeLabel(value: string) {
  const labels: Record<string, string> = {
    rss: "RSS",
    pubmed: "PubMed",
    arxiv: "arXiv",
    reddit: "Reddit",
    tavily: "Tavily",
    x: "X",
    manual: "手动"
  };
  return labels[value] ?? value;
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    draft: "草稿",
    generated: "已生成",
    sent: "已推送",
    "not run": "未运行"
  };
  return labels[value] ?? value;
}

function runMessageLabel(value: string) {
  if (value.includes("Completed with")) return "已完成，但部分信源抓取失败或被限流。";
  if (value.includes("Completed successfully")) return "已成功完成。";
  if (value.includes("Daily scan started")) return "今日扫描已开始。";
  return value;
}
