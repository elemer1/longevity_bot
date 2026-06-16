import Parser from "rss-parser";
import { config } from "./config";
import type { Candidate, CredibilityLabel, EvidenceType, Source } from "./types";
import { clampScore, compactText, containsLongevitySignal, stableId } from "./utils";

const parser = new Parser({
  timeout: 12000,
  headers: {
    "User-Agent": "CompoundLongevityIntelBot/0.1 (+internal intelligence bot)"
  }
});

type RawCandidate = Omit<
  Candidate,
  "credibility" | "evidenceType" | "impactScore" | "aiReason"
>;

export type FetchResult = {
  source: Source;
  candidates: Candidate[];
  error?: string;
};

export async function fetchAllSources(sources: Source[]) {
  const enabled = sources.filter((source) => source.enabled);
  const results = await Promise.allSettled(enabled.map(fetchSource));
  const fetchResults: FetchResult[] = results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      source: enabled[index],
      candidates: [],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason)
    };
  });

  const seen = new Map<string, Candidate>();
  for (const result of fetchResults) {
    for (const candidate of result.candidates) {
      const key = stableId(candidate.url || candidate.title);
      if (!seen.has(key)) seen.set(key, candidate);
    }
  }

  return {
    candidates: [...seen.values()].sort((a, b) => {
      const left = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const right = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return right - left;
    }),
    results: fetchResults
  };
}

export async function fetchSource(source: Source): Promise<FetchResult> {
  if (source.type === "pubmed") return wrapFetch(source, () => fetchPubMed(source));
  if (source.type === "arxiv") return wrapFetch(source, () => fetchArxiv(source));
  if (source.type === "rss" || source.type === "reddit") return wrapFetch(source, () => fetchRss(source));
  if (source.type === "tavily") return wrapFetch(source, () => fetchTavily(source));
  return { source, candidates: [] };
}

async function wrapFetch(source: Source, fn: () => Promise<RawCandidate[]>): Promise<FetchResult> {
  try {
    const raw = await fn();
    const candidates = raw
      .filter((candidate) => {
        const text = `${candidate.title} ${candidate.summary} ${candidate.journal ?? ""}`;
        return isMateriallyRelevant(text, source.type);
      })
      .map((candidate) => enrichCandidate(source, candidate))
      .filter((candidate) => candidate.impactScore >= 28)
      .slice(0, 30);

    return { source, candidates };
  } catch (error) {
    return {
      source,
      candidates: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchRss(source: Source): Promise<RawCandidate[]> {
  if (!source.url) return [];
  const feed = await parser.parseURL(source.url);
  return (feed.items ?? []).slice(0, 20).map((item) => {
    const url = item.link ?? item.guid ?? source.url;
    return {
      id: stableId(`${source.id}:${url}:${item.title ?? ""}`),
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type,
      title: compactText(item.title ?? "Untitled", 220),
      url,
      summary: compactText(item.contentSnippet ?? item.content ?? item.summary ?? "", 520),
      publishedAt: normalizeDate(item.isoDate ?? item.pubDate ?? null),
      authors: compactText(item.creator ?? "", 160) || undefined,
      journal: feed.title ?? source.name,
      raw: item as Record<string, unknown>
    };
  });
}

async function fetchArxiv(source: Source): Promise<RawCandidate[]> {
  const query = source.url || 'all:"longevity" OR all:"aging"';
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(
    query
  )}&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending`;
  const feed = await parser.parseURL(url);
  return (feed.items ?? []).slice(0, 20).map((item) => ({
    id: stableId(`${source.id}:${item.link ?? item.guid ?? item.title}`),
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    title: compactText(item.title ?? "Untitled", 220),
    url: item.link ?? item.guid ?? url,
    summary: compactText(item.contentSnippet ?? item.content ?? "", 620),
    publishedAt: normalizeDate(item.isoDate ?? item.pubDate ?? null),
    authors: compactText(item.creator ?? "", 180) || undefined,
    journal: "arXiv",
    raw: item as Record<string, unknown>
  }));
}

async function fetchPubMed(source: Source): Promise<RawCandidate[]> {
  const query = source.url || "longevity OR aging OR healthspan";
  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  searchUrl.searchParams.set("db", "pubmed");
  searchUrl.searchParams.set("retmode", "json");
  searchUrl.searchParams.set("sort", "pub+date");
  searchUrl.searchParams.set("retmax", "40");
  searchUrl.searchParams.set("term", query);

  const search = await fetchJson<{
    esearchresult?: { idlist?: string[] };
  }>(searchUrl.toString());
  const ids = search.esearchresult?.idlist ?? [];
  if (!ids.length) return [];

  const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  summaryUrl.searchParams.set("db", "pubmed");
  summaryUrl.searchParams.set("retmode", "json");
  summaryUrl.searchParams.set("id", ids.join(","));

  const summary = await fetchJson<{
    result?: Record<string, PubMedSummary | string[]>;
  }>(summaryUrl.toString());
  const abstracts = await fetchPubMedAbstracts(ids);

  return ids
    .map((id) => summary.result?.[id])
    .filter((value): value is PubMedSummary => Boolean(value) && typeof value === "object")
    .map((item) => {
      const abstract = abstracts.get(item.uid) ?? "";
      const journalLine = `${item.fulljournalname ?? item.source ?? ""}. ${item.pubdate ?? ""}`.trim();
      return {
        id: stableId(`${source.id}:${item.uid}`),
        sourceId: source.id,
        sourceName: source.name,
        sourceType: source.type,
        title: compactText(item.title, 240),
        url: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`,
        summary: compactText(abstract || journalLine, 1200),
        publishedAt: normalizePubmedDate(item.pubdate),
        authors: compactText((item.authors ?? []).map((author) => author.name).join(", "), 240) || undefined,
        journal: item.fulljournalname ?? item.source,
        raw: {
          ...(item as unknown as Record<string, unknown>),
          abstract
        }
      };
    });
}

async function fetchTavily(source: Source): Promise<RawCandidate[]> {
  if (!config.tavilyApiKey) return [];

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      api_key: config.tavilyApiKey,
      query: source.url || "longevity science aging healthspan latest",
      search_depth: "advanced",
      max_results: 12,
      include_answer: false,
      topic: "news"
    }),
    signal: AbortSignal.timeout(18000)
  });

  if (!response.ok) {
    throw new Error(`Tavily failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      published_date?: string;
      score?: number;
    }>;
  };

  return (data.results ?? []).map((item) => ({
    id: stableId(`${source.id}:${item.url ?? item.title}`),
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    title: compactText(item.title ?? "Untitled", 220),
    url: item.url ?? "",
    summary: compactText(item.content ?? "", 560),
    publishedAt: normalizeDate(item.published_date ?? null),
    journal: "Web",
    raw: item
  }));
}

function enrichCandidate(source: Source, candidate: RawCandidate): Candidate {
  const sourceCred = source.credibilityWeight;
  const text = `${candidate.title} ${candidate.summary} ${candidate.journal ?? ""}`.toLowerCase();
  const titleText = candidate.title.toLowerCase();
  const evidenceType = inferEvidenceType(text, source.type);
  const credibility = inferCredibility(sourceCred, evidenceType, source.type);
  const relevance = relevanceScore(text, source.type);
  const impactScore = clampScore(
    sourceCred * 0.32 +
      evidenceBoost(evidenceType) +
      noveltyBoost(text) +
      recencyBoost(candidate.publishedAt) +
      longevitySpecificityBoost(text) +
      titleSpecificityBoost(titleText, source.type) +
      relevance * 0.35 -
      noisePenalty(text) -
      broadBiomedicalPenalty(text, source.type) -
      titleMismatchPenalty(titleText, text, source.type)
  );

  return {
    ...candidate,
    credibility,
    evidenceType,
    impactScore,
    aiReason: "Pre-AI heuristic score based on source credibility, evidence type, relevance, novelty terms, and recency."
  };
}

function inferEvidenceType(text: string, sourceType: Source["type"]): EvidenceType {
  if (sourceType === "reddit") return "Anecdote";
  if (text.includes("randomized") || text.includes("randomised") || text.includes("rct")) return "Human RCT";
  if (text.includes("clinical trial") || text.includes("phase i") || text.includes("phase ii") || text.includes("phase iii")) {
    return "Clinical Trial";
  }
  if (
    text.includes("cohort") ||
    text.includes("observational") ||
    text.includes("biobank") ||
    text.includes("gbd ") ||
    text.includes("disease burden") ||
    text.includes("older adults") ||
    text.includes("older women")
  ) {
    return "Human Observational";
  }
  if (text.includes("mouse") || text.includes("mice") || text.includes("rat") || text.includes("in vivo")) return "Preclinical In Vivo";
  if (text.includes("cell") || text.includes("in vitro") || text.includes("organoid")) return "Preclinical In Vitro";
  if (text.includes("review") || text.includes("meta-analysis")) return "Review";
  if (sourceType === "arxiv") return "Preprint";
  if (sourceType === "tavily" || text.includes("startup") || text.includes("funding")) return "Industry";
  return "Unknown";
}

function inferCredibility(
  sourceCredibility: number,
  evidenceType: EvidenceType,
  sourceType: Source["type"]
): CredibilityLabel {
  const score =
    sourceCredibility +
    (["Human RCT", "Clinical Trial", "Human Observational"].includes(evidenceType) ? 14 : 0) -
    (["Anecdote", "Industry"].includes(evidenceType) ? 18 : 0) -
    (sourceType === "reddit" ? 18 : 0);

  if (score >= 78) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

function evidenceBoost(evidenceType: EvidenceType) {
  const boosts: Record<EvidenceType, number> = {
    "Human RCT": 35,
    "Clinical Trial": 30,
    "Human Observational": 22,
    "Preclinical In Vivo": 16,
    "Preclinical In Vitro": 10,
    Preprint: 9,
    Review: 14,
    Anecdote: 0,
    Industry: 4,
    Unknown: 6
  };
  return boosts[evidenceType];
}

function noveltyBoost(text: string) {
  let boost = 0;
  for (const term of ["clock", "senolytic", "rapamycin", "reprogramming", "biomarker", "glp-1", "mitochondria", "autophagy"]) {
    if (text.includes(term)) boost += 3;
  }
  return Math.min(boost, 18);
}

function relevanceScore(text: string, sourceType: Source["type"]) {
  const lower = text.toLowerCase();
  let score = 0;

  for (const term of [
    "longevity",
    "healthspan",
    "lifespan",
    "geroscience",
    "biological aging",
    "ageing biology",
    "hallmarks of aging",
    "rejuvenation",
    "senescence",
    "senolytic",
    "epigenetic clock",
    "biological age",
    "aging research",
    "cellular aging",
    "stem cell aging",
    "brain aging",
    "immune aging",
    "vascular aging",
    "organismal aging",
    "accelerated aging",
    "rapamycin",
    "metformin",
    "mtor",
    "caloric restriction",
    "time-restricted feeding"
  ]) {
    if (lower.includes(term)) score += 18;
  }

  for (const term of [
    "autophagy",
    "mtor",
    "rapamycin",
    "metformin",
    "nad",
    "nmn",
    "sirtuin",
    "mitochondria",
    "inflammaging",
    "cellular reprogramming",
    "caloric restriction",
    "frailty",
    "sarcopenia",
    "glp-1",
    "biomarker",
    "exercise",
    "physical activity"
  ]) {
    if (lower.includes(term)) score += 9;
  }

  for (const term of ["older adults", "older women", "aged mice", "aged mouse", "elderly rats", "elderly mice", "age-related", "aging-related"]) {
    if (lower.includes(term)) score += 6;
  }

  if (lower.includes("stem cell") && lower.includes("aging")) score += 18;

  if (sourceType === "reddit") score -= 8;
  return Math.max(0, Math.min(100, score - noisePenalty(lower)));
}

function isMateriallyRelevant(text: string, sourceType: Source["type"]) {
  const lower = text.toLowerCase();
  const penalty = noisePenalty(lower);
  if (penalty >= 60) return false;
  if (!containsLongevitySignal(lower)) return false;
  if (relevanceScore(lower, sourceType) < minimumRelevance(sourceType)) return false;

  const hasPrimaryAgingSignal = hasPrimaryLongevitySignal(lower);

  if (hasPrimaryAgingSignal) return true;

  const hasWeakAgeSignal = [
    "older adults",
    "older women",
    "older people",
    "age-related",
    "aging-related",
    "aged mice",
    "aged mouse",
    "elderly rats",
    "elderly mice",
    "aging research",
    "cellular aging",
    "stem cell aging",
    "brain aging"
  ].some((term) => lower.includes(term)) || (lower.includes("stem cell") && lower.includes("aging"));

  const hasHealthspanEndpoint = [
    "mortality",
    "morbidity",
    "cognitive",
    "dementia",
    "alzheimer",
    "cardiovascular",
    "metabolic",
    "diabetes",
    "muscle",
    "physical function",
    "functional decline",
    "biomarker",
    "inflammation",
    "osteoarthritis",
    "osteoporosis",
    "neurodegeneration",
    "disease burden"
  ].some((term) => lower.includes(term));

  return hasWeakAgeSignal && hasHealthspanEndpoint;
}

function minimumRelevance(sourceType: Source["type"]) {
  if (sourceType === "pubmed" || sourceType === "arxiv") return 14;
  if (sourceType === "reddit") return 14;
  return 8;
}

function hasPrimaryLongevitySignal(text: string) {
  return [
    "longevity",
    "healthspan",
    "lifespan",
    "geroscience",
    "biological aging",
    "healthy aging",
    "hallmarks of aging",
    "cellular senescence",
    "senescence",
    "epigenetic clock",
    "biological age",
    "brain age",
    "age-related cognitive",
    "skeletal aging",
    "accelerated aging",
    "progeria",
    "senolytic",
    "rapamycin",
    "reprogramming",
    "rejuvenation",
    "inflammaging",
    "sarcopenia",
    "frailty"
  ].some((term) => text.includes(term));
}

function longevitySpecificityBoost(text: string) {
  if (!hasPrimaryLongevitySignal(text)) return 0;
  let boost = 18;
  if (text.includes("healthspan") || text.includes("lifespan") || text.includes("geroscience")) boost += 8;
  if (text.includes("epigenetic clock") || text.includes("biological age") || text.includes("brain age")) boost += 6;
  return Math.min(boost, 32);
}

function broadBiomedicalPenalty(text: string, sourceType: Source["type"]) {
  if (hasPrimaryLongevitySignal(text)) return 0;

  let penalty = sourceType === "pubmed" ? 26 : 12;
  for (const term of [
    "hemodialysis",
    "arteriovenous fistula",
    "dental implant",
    "osseointegration",
    "tuberous sclerosis",
    "lipomatosis",
    "chemotherapy",
    "hepatocyte",
    "lung fibrosis",
    "pulmonary fibrosis",
    "cancer",
    "tumor",
    "tumour"
  ]) {
    if (text.includes(term)) penalty += 10;
  }
  return penalty;
}

function titleSpecificityBoost(title: string, sourceType: Source["type"]) {
  if (sourceType !== "pubmed" && sourceType !== "arxiv") return 0;
  return hasPrimaryLongevitySignal(title) ? 14 : 0;
}

function titleMismatchPenalty(title: string, fullText: string, sourceType: Source["type"]) {
  if (sourceType !== "pubmed" && sourceType !== "arxiv") return 0;
  if (hasPrimaryLongevitySignal(title)) return 0;
  if (hasPrimaryLongevitySignal(fullText)) return 28;
  return 42;
}

function noisePenalty(text: string) {
  let penalty = 0;
  for (const term of [
    "solar cell",
    "perovskite",
    "photovoltaic",
    "battery",
    "semiconductor",
    "schizophrenia literacy",
    "language learning",
    "immigration",
    "geology",
    "astronomy",
    "grain borer",
    "host grains",
    "stored grain",
    "coleoptera",
    "bostrichidae",
    "burkina faso",
    "pest management",
    "insect pest",
    "crop yield",
    "agricultural",
    "floral",
    "flower",
    "flowers",
    "gardenia",
    "jasminoides",
    "plant senescence",
    "shrub",
    "crop",
    "seedling",
    "decidualization",
    "endometrial",
    "pregnancy",
    "housing insecurity",
    "aging in place",
    "community housing",
    "social isolation",
    "loneliness",
    "colony management",
    "reproductive performance",
    "breeding strategy",
    "early survival",
    "stereotaxic container",
    "cutting guide",
    "brain fixation"
  ]) {
    if (text.includes(term)) penalty += 30;
  }
  return penalty;
}

function recencyBoost(dateLike: string | null) {
  if (!dateLike) return 0;
  const ageDays = (Date.now() - new Date(dateLike).getTime()) / 86_400_000;
  if (ageDays <= 2) return 10;
  if (ageDays <= 7) return 7;
  if (ageDays <= 30) return 4;
  return 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "CompoundLongevityIntelBot/0.1"
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  return (await response.json()) as T;
}

async function fetchPubMedAbstracts(ids: string[]) {
  const abstracts = new Map<string, string>();
  if (!ids.length) return abstracts;

  const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("retmode", "xml");
  url.searchParams.set("id", ids.join(","));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/xml,text/xml",
      "User-Agent": "CompoundLongevityIntelBot/0.1"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) return abstracts;

  const xml = await response.text();
  const articles = xml.match(/<PubmedArticle[\s\S]*?<\/PubmedArticle>/g) ?? [];
  for (const article of articles) {
    const pmid = article.match(/<PMID[^>]*>([\s\S]*?)<\/PMID>/)?.[1]?.trim();
    if (!pmid) continue;

    const chunks = [...article.matchAll(/<AbstractText\b[^>]*>([\s\S]*?)<\/AbstractText>/g)]
      .map((match) => decodeXmlEntities(stripXmlTags(match[1])).trim())
      .filter(Boolean);

    if (chunks.length) {
      abstracts.set(pmid, compactText(chunks.join(" "), 1600));
    }
  }

  return abstracts;
}

function stripXmlTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizePubmedDate(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const year = value.match(/\b(19|20)\d{2}\b/)?.[0];
  return year ? new Date(`${year}-01-01T00:00:00.000Z`).toISOString() : null;
}

type PubMedSummary = {
  uid: string;
  title: string;
  fulljournalname?: string;
  source?: string;
  pubdate?: string;
  authors?: Array<{ name: string }>;
};
