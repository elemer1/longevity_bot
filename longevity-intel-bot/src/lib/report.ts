import type { Candidate, Report, ReportContent, RunQuality } from "./types";
import type { FetchResult } from "./fetchers";
import { stableId } from "./utils";

export function buildMarkdownReport(content: ReportContent) {
  const lines = [
    `# ${content.reportTitle}`,
    "",
    content.executiveSummary,
    "",
    "## 今日核心判断",
    ...content.takeaways.map((item) => `- ${item}`),
    ""
  ];

  for (const item of content.items) {
    lines.push(
      `## ${item.rank}. ${item.translatedTitle}`,
      "",
      `**一句话结论：** ${item.oneLine}`,
      "",
      `**背景：** ${item.background ?? "这条内容需要放在 longevity science 的证据层级中理解：先看研究对象、证据类型和是否能转化到人体，再判断它的重要性。"}`,
      "",
      `**机制/科学逻辑：** ${item.mechanism ?? "机制信息不足，建议回到原文确认作者提出的是相关性、因果机制，还是早期假说。"}`,
      "",
      `**证据怎么读：** ${item.evidenceSummary ?? "目前只能根据来源和摘要做初步判断，仍需阅读原文确认样本量、模型、终点、效应大小和限制。"}`,
      "",
      `**为什么重要：** ${item.whyImportant}`,
      "",
      `**给非医学背景同事的解释：** ${item.explanation}`,
      "",
      `**内部解读：** ${item.teamImplication ?? "建议作为 watch item 保留，等更多证据出现后再判断是否值得深入研究。"}`,
      "",
      `**主要 caveat：** ${item.caveats}`,
      "",
      `**下一步看什么：** ${item.watchNext ?? "看是否有独立重复、人体数据、长期安全性、剂量信息和更清晰的机制验证。"}`,
      "",
      `**可信度：** ${credibilityLabel(item.credibility)} | **证据类型：** ${evidenceLabel(item.evidenceType)} | **影响评分：** ${item.impactScore}/100 | **行动建议：** ${actionLabel(item.actionability)}`,
      "",
      `**AI 排序理由：** ${item.aiRationale}`,
      "",
      `**来源：** ${item.sourceLabel} - ${item.originalUrl}`,
      ""
    );
  }

  return lines.join("\n").trim();
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

export function buildReportRecord(
  content: ReportContent,
  reportDate: string,
  status: Report["status"] = "generated"
): Report {
  return {
    id: stableId(`report:${reportDate}`),
    reportDate,
    title: content.reportTitle,
    summary: content.executiveSummary,
    contentMarkdown: buildMarkdownReport(content),
    contentJson: content,
    status,
    sentAt: null,
    deliveryResponse: null
  };
}

export function appendRunQualityNotes(
  report: Report,
  results: FetchResult[],
  totalCandidates: number,
  quality = buildRunQuality(results, [], report.contentJson.items.length)
): Report {
  const successful = results.filter((result) => result.candidates.length > 0);
  const warnings = results.filter((result) => result.error);
  const empty = results.filter((result) => !result.error && result.candidates.length === 0);
  const topTopics = quality.topicBreakdown.slice(0, 5);

  const lines = [
    "",
    "## 本轮抓取质量提示",
    "",
    `- 本轮共抓取到 ${totalCandidates} 条候选内容，来自 ${successful.length} 个有结果的信源。`,
    `- 覆盖评分：${quality.coverageScore}/100；人体/临床证据 ${quality.humanEvidenceCount} 条，高可信候选 ${quality.highCredibilityCount} 条，社区信号 ${quality.communitySignalCount} 条。`,
    `- 主题分布：${topTopics.length ? topTopics.map((item) => `${item.topic} ${item.count} 条`).join("、") : "暂无可稳定分类的主题"}。`,
    `- 成功信源：${successful.length ? successful.map((result) => `${result.source.name}（${result.candidates.length} 条）`).join("、") : "无" }。`
  ];

  if (warnings.length) {
    lines.push(
      `- 需要注意的信源：${warnings
        .map((result) => `${result.source.name}（${result.error ?? "未知错误"}）`)
        .join("、")}。这些失败不会中断日报，但会影响覆盖面。`
    );
  }

  if (empty.length) {
    lines.push(`- 无新增候选的信源：${empty.map((result) => result.source.name).join("、")}。`);
  }

  lines.push(
    "- 解释口径：高可信来源和人体证据会被优先考虑；社区内容、营销内容和个人经验只作为早期信号，不作为临床结论。"
  );

  return {
    ...report,
    contentMarkdown: `${report.contentMarkdown}\n${lines.join("\n")}`.trim()
  };
}

export function buildRunQuality(
  results: FetchResult[],
  candidates: Candidate[],
  selectedCount: number
): RunQuality {
  const successful = results.filter((result) => result.candidates.length > 0);
  const warnings = results.filter((result) => result.error);
  const empty = results.filter((result) => !result.error && result.candidates.length === 0);
  const topicCounts = new Map<string, number>();

  for (const candidate of candidates) {
    const topic = classifyCandidateTopic(candidate);
    topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
  }

  const highCredibilityCount = candidates.filter((candidate) => candidate.credibility === "High").length;
  const humanEvidenceCount = candidates.filter((candidate) =>
    ["Human RCT", "Human Observational", "Clinical Trial"].includes(candidate.evidenceType)
  ).length;
  const communitySignalCount = candidates.filter((candidate) =>
    candidate.sourceType === "reddit" || candidate.evidenceType === "Anecdote"
  ).length;

  const enabledSources = results.length;
  const diversityScore = Math.min(topicCounts.size / 6, 1) * 18;
  const coverageScore =
    enabledSources > 0 ? (successful.length / enabledSources) * 32 : 0;
  const candidateDepthScore = Math.min(candidates.length / 35, 1) * 18;
  const evidenceScore = Math.min((highCredibilityCount + humanEvidenceCount * 1.25) / 12, 1) * 25;
  const warningPenalty = Math.min(warnings.length * 6, 18);
  const communityPenalty = Math.min(Math.max(communitySignalCount - 8, 0) * 1.5, 8);

  const warningMessages = [
    ...warnings.map((result) => `${result.source.name}: ${result.error ?? "抓取失败"}`),
    ...(candidates.length < 10 ? ["候选池偏小，今天的覆盖面可能不足。"] : []),
    ...(humanEvidenceCount === 0 ? ["本轮没有抓到人体/临床证据，日报应避免给出强结论。"] : []),
    ...(successful.length <= Math.max(1, Math.floor(enabledSources / 3))
      ? ["有结果的信源偏少，排序可能受单一来源影响。"]
      : [])
  ];

  return {
    generatedAt: new Date().toISOString(),
    coverageScore: Math.max(0, Math.min(100, Math.round(coverageScore + candidateDepthScore + diversityScore + evidenceScore - warningPenalty - communityPenalty))),
    totalSources: results.length,
    enabledSources,
    successfulSources: successful.length,
    warningSources: warnings.length,
    emptySources: empty.length,
    totalCandidates: candidates.length,
    selectedCount,
    highCredibilityCount,
    humanEvidenceCount,
    communitySignalCount,
    sourceBreakdown: results.map((result) => ({
      sourceId: result.source.id,
      name: result.source.name,
      type: result.source.type,
      candidates: result.candidates.length,
      error: result.error
    })),
    topicBreakdown: [...topicCounts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count),
    warnings: warningMessages
  };
}

export function classifyCandidateTopic(candidate: Pick<Candidate, "title" | "summary" | "sourceType" | "evidenceType">) {
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

export function mergeRankedMetadata(candidates: Candidate[], content: ReportContent) {
  const ranked = new Map(content.items.map((item) => [item.candidateId, item]));
  return candidates.map((candidate) => {
    const item = ranked.get(candidate.id);
    if (!item) return candidate;
    return {
      ...candidate,
      credibility: item.credibility,
      evidenceType: item.evidenceType,
      impactScore: item.impactScore,
      aiReason: item.aiRationale
    };
  });
}
