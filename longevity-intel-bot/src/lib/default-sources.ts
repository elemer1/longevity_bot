import type { Source } from "./types";

export const defaultSources: Source[] = [
  {
    id: "pubmed-longevity",
    name: "PubMed Longevity 与 Geroscience",
    type: "pubmed",
    url: '((longevity[Title/Abstract] OR healthspan[Title/Abstract] OR geroscience[Title/Abstract] OR "biological aging"[Title/Abstract] OR "healthy aging"[Title/Abstract] OR "accelerated aging"[Title/Abstract] OR "cellular senescence"[Title/Abstract] OR senolytic[Title/Abstract] OR rapamycin[Title/Abstract] OR "epigenetic clock"[Title/Abstract] OR "biological age"[Title/Abstract] OR "stem cell aging"[Title/Abstract] OR "muscle stem cell"[Title/Abstract] OR "age-related cognitive"[Title/Abstract] OR "aged mice"[Title/Abstract]) NOT (plant[Title/Abstract] OR floral[Title/Abstract] OR flower[Title/Abstract] OR crop[Title/Abstract] OR agriculture[Title/Abstract] OR housing[Title/Abstract] OR "aging in place"[Title/Abstract] OR "colony management"[Title/Abstract] OR breeding[Title/Abstract]))',
    enabled: true,
    credibilityWeight: 94,
    notes: "主要生物医学论文检索源。"
  },
  {
    id: "arxiv-ai-bio-aging",
    name: "arXiv AI 与 Aging",
    type: "arxiv",
    url: 'all:"aging" OR all:"longevity" OR all:"biomarker" OR all:"drug discovery"',
    enabled: true,
    credibilityWeight: 68,
    notes: "AI、计算生物学和预印本的早期信号。"
  },
  {
    id: "nature-aging-rss",
    name: "Nature Aging",
    type: "rss",
    url: "https://www.nature.com/nataging.rss",
    enabled: true,
    credibilityWeight: 96,
    notes: "高信号期刊 feed。"
  },
  {
    id: "science-daily-aging",
    name: "ScienceDaily 健康衰老",
    type: "rss",
    url: "https://www.sciencedaily.com/rss/health_medicine/healthy_aging.xml",
    enabled: true,
    credibilityWeight: 62,
    notes: "适合快速理解背景的科学新闻源。"
  },
  {
    id: "lifespan-news",
    name: "Lifespan.io News",
    type: "rss",
    url: "https://www.lifespan.io/feed/",
    enabled: true,
    credibilityWeight: 58,
    notes: "Longevity 社区和产业动态覆盖。"
  },
  {
    id: "reddit-longevity",
    name: "Reddit r/longevity",
    type: "reddit",
    url: "https://www.reddit.com/r/longevity/.rss",
    enabled: true,
    credibilityWeight: 38,
    notes: "社区发现信号；排序器应降低个人经验内容权重。"
  },
  {
    id: "reddit-biohackers",
    name: "Reddit r/Biohackers",
    type: "reddit",
    url: "https://www.reddit.com/r/Biohackers/.rss",
    enabled: true,
    credibilityWeight: 28,
    notes: "个人经验和行为趋势信号；不可视为临床证据。"
  },
  {
    id: "tavily-web-longevity",
    name: "可选 Tavily 全网搜索",
    type: "tavily",
    url: "longevity science aging biotech clinical trial healthspan today",
    enabled: false,
    credibilityWeight: 50,
    notes: "配置 TAVILY_API_KEY 后启用，用于扩大全网覆盖。"
  },
  {
    id: "x-placeholder",
    name: "X / Twitter 专家列表",
    type: "x",
    url: "",
    enabled: false,
    credibilityWeight: 35,
    notes: "为官方 X API credentials 预留的适配器。"
  }
];
