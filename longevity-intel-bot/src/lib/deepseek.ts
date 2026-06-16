import { z } from "zod";
import { config } from "./config";
import type { Candidate, ReportContent } from "./types";
import { clampScore } from "./utils";

const rankedItemSchema = z.object({
  candidateId: z.string(),
  rank: z.number().int().min(1).max(5),
  translatedTitle: z.string(),
  oneLine: z.string(),
  background: z.string(),
  mechanism: z.string(),
  evidenceSummary: z.string(),
  explanation: z.string(),
  whyImportant: z.string(),
  credibility: z.enum(["High", "Medium", "Low"]),
  evidenceType: z.enum([
    "Human RCT",
    "Human Observational",
    "Clinical Trial",
    "Preclinical In Vivo",
    "Preclinical In Vitro",
    "Preprint",
    "Review",
    "Anecdote",
    "Industry",
    "Unknown"
  ]),
  impactScore: z.number().min(0).max(100),
  actionability: z.enum(["Now", "Watch", "Ignore"]),
  caveats: z.string(),
  teamImplication: z.string(),
  watchNext: z.string(),
  sourceLabel: z.string(),
  originalUrl: z.string(),
  aiRationale: z.string()
});

const reportSchema = z.object({
  reportTitle: z.string(),
  executiveSummary: z.string(),
  takeaways: z.array(z.string()).min(1).max(5),
  items: z.array(rankedItemSchema).min(1).max(5)
});

export async function rankCandidatesWithDeepSeek(
  candidates: Candidate[],
  reportDate: string
): Promise<ReportContent> {
  const prepared = buildCandidatePool(candidates).map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    summary: candidate.summary,
    url: candidate.url,
    publishedAt: candidate.publishedAt,
    sourceName: candidate.sourceName,
    sourceType: candidate.sourceType,
    authors: candidate.authors,
    journal: candidate.journal,
    heuristicCredibility: candidate.credibility,
    heuristicEvidenceType: candidate.evidenceType,
    heuristicImpactScore: candidate.impactScore
  }));

  if (!config.deepseekApiKey) {
    return fallbackRank(prepared, reportDate);
  }

  const response = await fetch(`${config.deepseekBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deepseekApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      messages: [
        {
          role: "system",
          content: [
            "You are a senior longevity science intelligence editor for an internal biotech/finance team.",
            "Your job is to select the 5 most important daily items and explain them in clear, detailed Chinese for non-medical readers.",
            "This is not a headline digest. It should read like a compact science briefing: understandable, but with enough depth for a smart internal team to learn the field over time.",
            "Ranking principles, in order:",
            "1. Human evidence, clinical trials, strong observational data, or robust replication outrank animal/cell/anecdotal signals.",
            "2. Translational relevance to human healthspan, lifespan, biomarkers, drug discovery, prevention, or aging biology matters.",
            "3. Novel mechanisms, credible biomarker movement, safety implications, or validated target evidence matter.",
            "4. Source credibility matters; primary papers and reputable scientific outlets outrank Reddit, X, marketing, or single-person experiments.",
            "5. Penalize hype, supplement marketing, underpowered self-experiments, and claims without evidence.",
            "6. Preserve topic diversity; avoid choosing five near-duplicates unless the field truly has one dominant story today.",
            "Label evidence honestly. Never turn anecdote into clinical evidence.",
            "For each selected item, write with depth: explain the scientific background, the mechanism if inferable, what the evidence actually shows, why it matters, what is still uncertain, and what the team should watch next.",
            "Avoid empty phrases such as '值得关注' unless you explain exactly why. Avoid generic summaries that could fit any paper.",
            "Takeaways must be 3-5 specific learning points, not slogans. Each takeaway should say what changed in our understanding or what uncertainty remains.",
            "Length target: executiveSummary 250-450 Chinese characters; each item total 450-750 Chinese characters across fields. Do not compress the item into one or two short sentences.",
            "Return strict JSON only. No Markdown outside JSON."
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            reportDate,
            language: "zh-CN",
            outputSchema: {
              reportTitle: "string",
              executiveSummary: "string",
              takeaways: ["3-5 specific Chinese bullet points, each 35-80 Chinese characters"],
              items: [
                {
                  candidateId: "must equal one provided candidate id",
                  rank: 1,
                  translatedTitle: "Chinese title",
                  oneLine: "sharp one-sentence bottom line in Chinese",
                  background: "what non-medical readers need to know before reading this item",
                  mechanism: "mechanism or biological logic; say if unclear",
                  evidenceSummary: "what the source actually showed and how strong the evidence is",
                  explanation: "plain-language explanation in Chinese",
                  whyImportant: "why this matters for longevity in Chinese",
                  credibility: "High | Medium | Low",
                  evidenceType: "Human RCT | Human Observational | Clinical Trial | Preclinical In Vivo | Preclinical In Vitro | Preprint | Review | Anecdote | Industry | Unknown",
                  impactScore: "0-100",
                  actionability: "Now | Watch | Ignore",
                  caveats: "main caveat in Chinese",
                  teamImplication: "what an internal Compound reader should take away",
                  watchNext: "what follow-up evidence, trial, replication, or signal should be monitored",
                  sourceLabel: "source/journal/community name",
                  originalUrl: "url",
                  aiRationale: "brief ranking rationale in Chinese"
                }
              ]
            },
            candidates: prepared
          })
        }
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.2,
      max_tokens: 9000
    }),
    signal: AbortSignal.timeout(45000)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek failed ${response.status}: ${errorText.slice(0, 400)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned an empty response.");

  const parsed = reportSchema.parse(JSON.parse(content));
  const normalizedItems = normalizeRankedItems(parsed, prepared, reportDate);
  return {
    ...parsed,
    items: normalizedItems
  };
}

function buildCandidatePool(candidates: Candidate[]) {
  const sorted = [...candidates].sort((a, b) => candidateInputScore(b) - candidateInputScore(a));
  const pool = new Map<string, Candidate>();

  for (const candidate of sorted.slice(0, 34)) pool.set(candidate.id, candidate);
  for (const candidate of candidates.slice(0, 16)) pool.set(candidate.id, candidate);

  return [...pool.values()]
    .sort((a, b) => candidateInputScore(b) - candidateInputScore(a))
    .slice(0, 45);
}

function candidateInputScore(candidate: Candidate) {
  const ageDays = candidate.publishedAt
    ? (Date.now() - new Date(candidate.publishedAt).getTime()) / 86_400_000
    : 45;
  const recency = ageDays <= 2 ? 12 : ageDays <= 7 ? 8 : ageDays <= 30 ? 4 : 0;
  const source = candidate.credibility === "High" ? 9 : candidate.credibility === "Medium" ? 4 : 0;
  const evidence = ["Human RCT", "Clinical Trial", "Human Observational"].includes(candidate.evidenceType) ? 10 : 0;
  return candidate.impactScore + recency + source + evidence;
}

function normalizeRankedItems(
  parsed: ReportContent,
  prepared: Array<{
    id: string;
    title: string;
    summary: string;
    url: string;
    publishedAt: string | null;
    sourceName: string;
    sourceType: string;
    journal?: string;
    heuristicCredibility: Candidate["credibility"];
    heuristicEvidenceType: Candidate["evidenceType"];
    heuristicImpactScore: number;
  }>,
  reportDate: string
) {
  const preparedById = new Map(prepared.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  const valid = parsed.items
    .filter((item) => preparedById.has(item.candidateId) && !seen.has(item.candidateId))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map((item) => {
      seen.add(item.candidateId);
      const candidate = preparedById.get(item.candidateId);
      return {
        ...item,
        sourceLabel: item.sourceLabel || candidate?.journal || candidate?.sourceName || "Unknown source",
        originalUrl: candidate?.url || item.originalUrl,
        impactScore: clampScore(item.impactScore)
      };
    });

  if (valid.length < 5) {
    const fallbackItems = fallbackRank(prepared, reportDate).items.filter((item) => !seen.has(item.candidateId));
    valid.push(...fallbackItems.slice(0, 5 - valid.length));
  }

  return valid.map((item, index) => ({
    ...item,
    rank: index + 1,
    impactScore: clampScore(item.impactScore)
  }));
}

function fallbackRank(
  candidates: Array<{
    id: string;
    title: string;
    summary: string;
    url: string;
    publishedAt: string | null;
    sourceName: string;
    sourceType: string;
    journal?: string;
    heuristicCredibility: Candidate["credibility"];
    heuristicEvidenceType: Candidate["evidenceType"];
    heuristicImpactScore: number;
  }>,
  reportDate: string
): ReportContent {
  const selected = [...candidates]
    .sort((a, b) => b.heuristicImpactScore - a.heuristicImpactScore)
    .slice(0, 5);

  return {
    reportTitle: `Longevity 日报 - ${reportDate}`,
    executiveSummary:
      "今日报告先使用本地启发式排序生成，用于验证抓取、去重、证据标签和推送链路。它会优先把与 aging biology、健康寿命、代谢干预、神经退行、运动行为和 biomarker 相关的内容放到前面，但仍不能替代真正的语义审稿。接入 DEEPSEEK_API_KEY 后，系统会进一步阅读候选标题、摘要、来源和上下文，生成更像科学编辑写出的深度转述：不仅告诉团队发生了什么，还会解释证据强弱、机制逻辑、潜在转化意义和下一步应该观察的信号。",
    takeaways: [
      "排序逻辑优先考虑证据强度和转化潜力，而不是只按关键词或热度排序；人类研究和可验证 biomarker 会被放在更高优先级。",
      "社区和 biohacker 内容可以作为早期观察信号，但在证据分级上会被明确降权，避免把个人经验误读为临床结论。",
      "当前环境尚未配置 DeepSeek key，因此以下深度解释是本地模板化版本；正式部署时应使用 DeepSeek 生成更准确的中文科学转述。"
    ],
    items: selected.map((candidate, index) => ({
      candidateId: candidate.id,
      rank: index + 1,
      translatedTitle: candidate.title,
      oneLine: candidate.summary || "这条内容与 longevity 相关，但需要进一步阅读原文判断具体影响。",
      background:
        "Longevity 信息流里最容易混在一起的是机制发现、动物实验、人群观察和商业化叙事。阅读这条内容时，先把它放回证据层级里看：它提供的是一个可能影响健康寿命的线索，而不是马上可执行的医学结论。",
      mechanism:
        buildFallbackMechanism(candidate.title, candidate.summary),
      evidenceSummary:
        `这条候选来自 ${candidate.journal || candidate.sourceName}，系统初步标注为${evidenceLabel(candidate.heuristicEvidenceType)}。在未接入 DeepSeek 的降级模式下，系统只能根据标题、摘要、来源权重和关键词做初筛，不能替代完整论文阅读。`,
      explanation:
        "简单说，这条内容被选中，是因为它和 aging biology、健康寿命、代谢、神经退行、运动干预或 biomarker 之类主题存在交集。它的价值在于帮助团队发现新的研究方向或证据变化，而不是直接给出干预建议。",
      whyImportant:
        "对 longevity 团队来说，重要性不只来自标题热度，而来自它是否改变我们对机制、可测量指标、转化路径或风险边界的理解。即使是动物或观察性研究，也可能提示值得持续追踪的靶点或行为模式。",
      credibility: candidate.heuristicCredibility,
      evidenceType: candidate.heuristicEvidenceType,
      impactScore: candidate.heuristicImpactScore,
      actionability: candidate.heuristicImpactScore >= 82 ? "Now" : candidate.heuristicImpactScore >= 55 ? "Watch" : "Ignore",
      caveats: "降级模式下尚未进行深度语义审稿，请以原文为准。",
      teamImplication:
        "建议把这条作为研究雷达里的 watch item：先读原文确认样本、模型、终点和效应大小，再决定是否进入内部讨论或后续追踪列表。",
      watchNext:
        "下一步重点看是否有独立重复、人体数据、剂量/安全性信息、清晰的机制验证，以及是否被更高可信来源继续引用。",
      sourceLabel: candidate.journal || candidate.sourceName,
      originalUrl: candidate.url,
      aiRationale: "基于启发式评分：来源可信度、证据类型和近期性。"
    }))
  };
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

function buildFallbackMechanism(title: string, summary: string) {
  const text = `${title} ${summary}`.toLowerCase();
  if (text.includes("autophagy")) {
    return "这条内容可能与 autophagy 相关。Autophagy 可以理解为细胞内部的清理和回收系统；在 aging 语境下，它常被视为维持蛋白稳态、线粒体质量控制和抗压力能力的重要机制。";
  }
  if (text.includes("exercise") || text.includes("physical activity")) {
    return "这条内容可能与运动干预相关。运动对 longevity 的意义通常不是单一指标改善，而是通过代谢、炎症、肌肉功能、脑健康和心血管风险等多条路径共同影响健康寿命。";
  }
  if (text.includes("clock") || text.includes("epigenetic")) {
    return "这条内容可能与生物年龄或 epigenetic clock 相关。这类指标试图把 aging 的系统性变化压缩成可追踪的读数，但它们是否能代表真实健康收益，需要谨慎判断。";
  }
  if (text.includes("glp") || text.includes("ozempic")) {
    return "这条内容可能与 GLP-1 或代谢干预相关。代谢健康是 longevity 的核心入口之一，但体重、炎症、肌肉量、依从性和长期安全性需要放在一起看。";
  }
  return "这条内容可能涉及 aging biology、健康寿命、疾病负担、行为干预或 biomarker。机制层面需要回到原文判断：它到底是在观察相关性、验证因果机制，还是提出一个早期假说。";
}
