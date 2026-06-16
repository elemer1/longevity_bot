# Compound Longevity Intelligence Bot（长寿科学情报机器人）

> 一个云端运行的「长寿 / 抗衰老科学」每日情报机器人：自动从 PubMed、arXiv、权威期刊 RSS、Reddit 等信源抓取最新内容，用 DeepSeek 大模型筛选出当天最重要的 5 条，生成**面向非医学背景读者的中文深度日报**，并自动推送到飞书（Lark）群。

本项目是一个「云优先（cloud-first）」的 MVP，适合内部生物科技 / 投研团队每天用一条飞书消息持续跟踪长寿科学进展，同时通过内置的 Web 后台管理信源、审阅候选、编辑日报、查看运行质量。

---

## 目录

- [一、这款软件是做什么的](#一这款软件是做什么的)
- [二、核心功能](#二核心功能)
- [三、工作原理（每日流程）](#三工作原理每日流程)
- [四、技术栈](#四技术栈)
- [五、项目结构](#五项目结构)
- [六、环境变量配置](#六环境变量配置)
- [七、本地运行](#七本地运行)
- [八、云端部署（Vercel）](#八云端部署vercel)
- [九、依赖服务配置详解](#九依赖服务配置详解)
  - [9.1 Neon / Postgres 数据库](#91-neon--postgres-数据库)
  - [9.2 DeepSeek 大模型](#92-deepseek-大模型)
  - [9.3 飞书（Lark）自定义机器人](#93-飞书lark自定义机器人)
  - [9.4 Tavily 全网搜索（可选）](#94-tavily-全网搜索可选)
- [十、后台使用指南](#十后台使用指南)
- [十一、信源管理](#十一信源管理)
- [十二、定时任务（每日自动运行）](#十二定时任务每日自动运行)
- [十三、API 接口说明](#十三api-接口说明)
- [十四、排序与评分逻辑](#十四排序与评分逻辑)
- [十五、降级与容错](#十五降级与容错)
- [十六、安全与鉴权](#十六安全与鉴权)
- [十七、常见问题（FAQ）](#十七常见问题faq)
- [十八、免责声明](#十八免责声明)

---

## 一、这款软件是做什么的

长寿 / 抗衰老领域每天产生大量信息：机制研究、动物实验、人群观察、临床试验、产业融资、社区自我实验……信噪比很低，且大量是英文专业文献，团队很难每天逐一阅读判断。

本机器人解决的就是这个问题：

1. **自动采集** —— 每天定时从多个高质量信源拉取最新内容。
2. **智能去噪与排序** —— 先用本地启发式规则过滤明显无关内容，再交给 DeepSeek 按「证据强度 + 转化价值 + 新颖性 + 来源可信度」选出当天最重要的 5 条。
3. **深度中文转述** —— 不是简单的标题翻译，而是像一位科学编辑那样写出背景、机制、证据强弱、为什么重要、主要 caveat、下一步该看什么。
4. **一键 / 定时推送** —— 把日报推送到飞书群，团队每天打开飞书即可阅读。
5. **可管理、可追溯** —— 提供 Web 后台管理信源、审阅候选、编辑日报、查看每轮抓取的覆盖质量与历史。

> ⚠️ **应用代码位于子目录 [`longevity-intel-bot/`](./longevity-intel-bot) 中。** 下文所有命令默认在该目录下执行。

---

## 二、核心功能

| 功能 | 说明 |
| --- | --- |
| 多信源抓取 | PubMed E-utilities、arXiv Atom API、RSS / Atom feed、Reddit RSS，以及可选的 Tavily 全网搜索 |
| 去重与标准化 | 按 URL / 标题哈希去重，统一为标准候选结构 |
| 启发式预排序 | 本地按证据类型、来源可信度、新颖词、时效性、长寿主题相关性打分（0–100），过滤明显噪声 |
| AI 深度排序与撰写 | DeepSeek 选出 Top 5 并生成结构化中文解读（背景 / 机制 / 证据 / 重要性 / caveat / 下一步） |
| 证据标签 | 自动标注证据类型、可信度、影响评分、行动建议（可立即关注 / 持续观察 / 暂不优先） |
| 运行质量指标 | 覆盖评分、成功 / 失败 / 空结果信源数、主题分布、人体证据数、高可信候选数、质量警告 |
| Web 内部后台 | 管理信源、审阅候选、预览与编辑日报、查看推送状态与运行历史、系统配置自检 |
| 飞书推送 | 通过飞书自定义机器人 Webhook 推送富文本日报，支持签名校验 |
| 云端定时运行 | 通过 Vercel Cron 每天定时执行完整流程并推送 |

---

## 三、工作原理（每日流程）

```
Vercel Cron (每日 09:00 北京时间)
        │
        ▼
GET /api/cron/daily  ──►  runDailyPipeline({ send: true })
        │
        ├─ 1. 从数据库读取所有「已启用」信源
        ├─ 2. 并发抓取各信源最新内容（Promise.allSettled，单源失败不影响整体）
        │       • PubMed：esearch → esummary → efetch（含摘要）
        │       • arXiv：Atom API，按提交时间倒序
        │       • RSS / Reddit：rss-parser
        │       • Tavily：/search（需配置 key）
        ├─ 3. 相关性过滤 + 启发式打分（去除噪声、低分项）
        ├─ 4. 按 URL / 标题哈希去重
        ├─ 5. 保存候选到数据库
        ├─ 6. DeepSeek 排序：从候选池（最多 45 条）选出 Top 5，生成中文深度解读
        ├─ 7. 生成 Markdown 日报，并附加「本轮抓取质量提示」
        ├─ 8. 保存日报到数据库
        ├─ 9. 推送到飞书（如开启 send）
        └─ 10. 记录本轮运行：抓取数、选中数、覆盖评分、信源警告、推送状态
```

详细架构说明另见 [`longevity-intel-bot/docs/architecture.md`](./longevity-intel-bot/docs/architecture.md)。

---

## 四、技术栈

- **框架**：Next.js 16（App Router）+ React 19 + TypeScript
- **数据库**：Neon / Postgres（通过 `@neondatabase/serverless`）
- **大模型**：DeepSeek Chat Completions API
- **推送**：飞书（Lark）自定义机器人 Webhook
- **抓取**：`rss-parser` + 原生 `fetch`（PubMed / arXiv / Tavily）
- **校验**：`zod`（对 AI 返回的 JSON 做严格 schema 校验）
- **定时**：Vercel Cron
- **图标**：`lucide-react`

---

## 五、项目结构

```
longevity_bot/
├── README.md                       ← 本文件（仓库根目录）
└── longevity-intel-bot/            ← Next.js 应用（部署目标）
    ├── .env.example                ← 环境变量模板
    ├── vercel.json                 ← Vercel Cron 配置
    ├── next.config.ts
    ├── package.json
    ├── docs/
    │   └── architecture.md         ← 架构与排序原则说明
    └── src/
        ├── proxy.ts                ← 鉴权中间件（Next.js 16 proxy）
        ├── app/
        │   ├── layout.tsx
        │   ├── page.tsx            ← 后台首页（Dashboard）
        │   ├── login/page.tsx      ← 管理员登录页
        │   ├── globals.css
        │   └── api/
        │       ├── cron/daily/route.ts  ← 定时入口
        │       ├── dashboard/route.ts   ← 仪表盘数据
        │       ├── run/route.ts         ← 手动运行扫描
        │       ├── send/route.ts        ← 推送指定日报
        │       ├── report/route.ts      ← 编辑日报
        │       ├── settings/route.ts    ← 配置自检 / 连接测试
        │       ├── sources/route.ts     ← 信源增改查
        │       └── login/route.ts       ← 登录鉴权
        ├── components/
        │   └── Dashboard.tsx       ← 后台界面（5 个标签页）
        └── lib/
            ├── config.ts           ← 读取环境变量
            ├── db.ts               ← 数据库 / 本地存储 + 建表 + 默认信源
            ├── default-sources.ts  ← 默认信源列表
            ├── fetchers.ts         ← 各信源抓取 + 启发式评分
            ├── deepseek.ts         ← DeepSeek 排序 + 降级排序
            ├── lark.ts             ← 飞书推送 + 签名
            ├── pipeline.ts         ← 每日主流程编排
            ├── report.ts           ← Markdown 生成 + 质量指标
            ├── types.ts            ← 类型定义
            └── utils.ts            ← 工具函数（哈希、清洗、相关性词表）
```

---

## 六、环境变量配置

复制模板后填写：

```bash
cd longevity-intel-bot
cp .env.example .env.local
```

| 变量 | 必需性 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `DATABASE_URL` | **生产必需** | 空 | Neon / Postgres 连接串。未配置时使用本地 JSON 文件 `data/local-store.json`（仅供本地预览） |
| `DEEPSEEK_API_KEY` | **生产必需** | 空 | DeepSeek API 密钥。未配置时退化为本地启发式排序 + 模板化中文解释 |
| `LARK_WEBHOOK_URL` | **生产必需** | 空 | 飞书自定义机器人 Webhook 地址。未配置则无法真正推送 |
| `ADMIN_TOKEN` | 强烈推荐 | 空 | 后台访问口令。未配置时后台**完全无鉴权** |
| `CRON_SECRET` | 强烈推荐 | 空 | 保护 `/api/cron/daily`，以 Bearer Token 校验。未配置则定时接口无额外保护 |
| `LARK_WEBHOOK_SECRET` | 可选 | 空 | 飞书机器人开启「签名校验」时填写，用于对请求签名 |
| `DEEPSEEK_BASE_URL` | 可选 | `https://api.deepseek.com` | DeepSeek API 基地址，可指向兼容端点 |
| `DEEPSEEK_MODEL` | 可选 | `deepseek-v4-flash` | 使用的 DeepSeek 模型名 |
| `TAVILY_API_KEY` | 可选 | 空 | 配置后启用 Tavily 全网搜索信源，扩大覆盖面 |
| `NEXT_PUBLIC_APP_NAME` | 可选 | `Compound Longevity 科学情报后台` | 后台显示的应用名称 |

> 💡 三个「生产必需」变量任一缺失，系统都会**自动降级**而不是报错（见 [第十五节](#十五降级与容错)），因此你可以在没有任何 key 的情况下先把后台跑起来体验。

---

## 七、本地运行

要求 Node.js 18+（建议 20+）。

```bash
cd longevity-intel-bot

# 1. 安装依赖
npm install

# 2.（可选）配置环境变量
cp .env.example .env.local   # 按需填写

# 3. 启动开发服务器
npm run dev
# 打开 http://localhost:3000

# 其他命令
npm run build       # 生产构建
npm run start       # 运行生产构建
npm run typecheck   # TypeScript 类型检查
```

**纯本地体验（零配置）**：不填任何环境变量也能启动。此时：

- 数据存储在 `data/local-store.json`（内存 + 本地文件）；
- 排序使用本地启发式逻辑（无 DeepSeek）；
- 推送会被跳过（无飞书 Webhook）；
- 后台无登录口令，直接进入。

进入后台后点击「**运行今日扫描**」，即可看到真实抓取、去重、打分、生成日报的完整效果。

---

## 八、云端部署（Vercel）

本项目为 Vercel 优化，推荐用 Vercel 部署：

1. **准备数据库**：在 [Neon](https://neon.tech) 创建一个 Postgres 数据库，复制连接串作为 `DATABASE_URL`。
2. **准备飞书机器人**：在飞书群里添加「自定义机器人」，复制 Webhook 地址作为 `LARK_WEBHOOK_URL`（详见 [9.3](#93-飞书lark自定义机器人)）。
3. **准备 DeepSeek**：在 DeepSeek 开放平台申请 API Key 作为 `DEEPSEEK_API_KEY`。
4. **导入项目到 Vercel**：
   - 在 Vercel 中 Import 本仓库；
   - **Root Directory 设置为 `longevity-intel-bot`**（重要，因为应用在子目录里）；
   - 框架会被识别为 Next.js。
5. **配置环境变量**：在 Vercel 项目的 Settings → Environment Variables 中，填入 [第六节](#六环境变量配置) 的变量（至少 `DATABASE_URL`、`DEEPSEEK_API_KEY`、`LARK_WEBHOOK_URL`，并强烈建议设置 `ADMIN_TOKEN` 和 `CRON_SECRET`）。
6. **部署**。
7. **定时任务自动生效**：`vercel.json` 已声明 Cron，每天 `01:00 UTC`（即北京时间 `09:00`）调用 `/api/cron/daily`，自动运行并推送当天日报。

> **首次请求会自动建表并写入默认信源**，无需手动初始化数据库。

> **关于 Cron 鉴权**：Vercel Cron 调用受其平台机制保护。若你额外设置了 `CRON_SECRET`，则需要让调用方在 `Authorization: Bearer <CRON_SECRET>` 头中带上它，否则接口会返回 401。在 Vercel 上可通过项目设置使 Cron 携带该头，或将该接口的外部直接访问视为受保护。

---

## 九、依赖服务配置详解

### 9.1 Neon / Postgres 数据库

- 在 [neon.tech](https://neon.tech) 新建项目和数据库。
- 复制形如 `postgresql://USER:PASSWORD@HOST.neon.tech/DB?sslmode=require` 的连接串。
- 设置为环境变量 `DATABASE_URL`。
- 应用会在首次访问时自动创建以下表并写入默认信源：
  - `sources`（信源）、`candidates`（候选）、`reports`（日报）、`runs`（运行记录）。
- **无需手动执行任何 SQL**。

### 9.2 DeepSeek 大模型

- 在 DeepSeek 开放平台申请 API Key，设置为 `DEEPSEEK_API_KEY`。
- 默认基地址 `https://api.deepseek.com`、默认模型 `deepseek-v4-flash`，如需更改用 `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` 覆盖。
- 调用细节：Chat Completions 接口，强制 `response_format: json_object`，`temperature 0.2`，超时 45 秒；返回结果会用 `zod` 严格校验，并兜底补足到 5 条。
- 在后台「系统设置 → DeepSeek」点击「**测试 AI**」可验证连通性。

### 9.3 飞书（Lark）自定义机器人

1. 在飞书目标群聊中：**设置 → 群机器人 → 添加机器人 → 自定义机器人**。
2. 复制生成的 **Webhook 地址**，设置为 `LARK_WEBHOOK_URL`。
3. 如果你在机器人安全设置里启用了「**签名校验**」，把对应密钥填入 `LARK_WEBHOOK_SECRET`；应用会自动用 HMAC-SHA256 对请求签名。若未启用签名校验，则留空即可。
4. 推送内容为飞书富文本（`post` 类型），日报中的链接会被转成「原文链接」可点击文本。
5. 在后台「系统设置 → Lark 推送」点击「**测试 Lark**」会向群里发送一条测试消息。

> 国际版地址形如 `https://open.larksuite.com/open-apis/bot/v2/hook/...`；国内飞书形如 `https://open.feishu.cn/open-apis/bot/v2/hook/...`。两者均可。

### 9.4 Tavily 全网搜索（可选）

- 申请 Tavily API Key，设置为 `TAVILY_API_KEY`。
- 配置后，默认信源里被禁用的「可选 Tavily 全网搜索」会自动变为可启用，用于补充期刊 / 社区之外的全网新闻覆盖。
- 不配置则该信源保持禁用，不影响其他流程。

---

## 十、后台使用指南

访问部署后的域名（或本地 `http://localhost:3000`）。若设置了 `ADMIN_TOKEN`，会先跳转到登录页，输入口令后进入。后台左侧有 5 个标签页：

| 标签页 | 用途 |
| --- | --- |
| **信源管理** | 查看 / 开关各信源，新增自定义信源（RSS、PubMed/arXiv 检索式、Reddit、Tavily、手动） |
| **候选内容** | 浏览最近抓取并标准化的候选，支持按关键词、来源类型、可信度筛选，按影响评分 / 时间 / 可信度排序 |
| **今日日报** | 核心工作区：查看运行质量摘要、Top 5 候选表格、日报 Markdown 预览与编辑；可「运行今日扫描」「保存」「推送到 Lark」 |
| **运行历史** | 查看每轮运行状态、抓取 / 选中数量、覆盖质量明细、最近一次推送响应 |
| **系统设置** | 配置自检（存储 / DeepSeek / Lark / Cron / Tavily / 后台保护）、连接测试、手动触发运行控制 |

**典型操作流程：**

1. 在「信源管理」确认启用了需要的信源。
2. 在「今日日报」点击「**运行今日扫描**」→ 系统抓取、排序、生成日报。
3. 在日报预览区检查内容，必要时直接编辑 Markdown，点击「**保存**」。
4. 点击右上角「**推送到 Lark**」把日报发到飞书群。
5. 在「运行历史」查看覆盖评分与推送结果。

> 顶部还有「刷新」按钮和最近运行状态指示；首次进入后台会自动拉取一次最新仪表盘数据。

---

## 十一、信源管理

支持的信源类型（`SourceType`）：

| 类型 | 说明 | `url` 字段填什么 |
| --- | --- | --- |
| `pubmed` | PubMed 文献检索 | PubMed 检索式（支持 `[Title/Abstract]`、布尔逻辑等） |
| `arxiv` | arXiv 预印本 | arXiv 检索式，如 `all:"aging" OR all:"longevity"` |
| `rss` | 任意 RSS / Atom feed | feed 地址 |
| `reddit` | Reddit 子版块 RSS | 形如 `https://www.reddit.com/r/longevity/.rss` |
| `tavily` | Tavily 全网搜索 | 搜索查询词（需 `TAVILY_API_KEY`） |
| `x` | X / Twitter | 预留适配器，**默认禁用且暂未接入**官方 API |
| `manual` | 手动信源 | 自定义 |

**默认内置信源**（首次运行自动写入）：

- PubMed Longevity 与 Geroscience（带降噪过滤的检索式，权重 94）
- arXiv AI 与 Aging（权重 68）
- Nature Aging RSS（权重 96）
- ScienceDaily 健康衰老 RSS（权重 62）
- Lifespan.io News RSS（权重 58）
- Reddit r/longevity（权重 38）
- Reddit r/Biohackers（权重 28）
- 可选 Tavily 全网搜索（默认禁用，配置 key 后可用）
- X / Twitter 专家列表（默认禁用，占位适配器）

每个信源都有「**可信权重**（credibilityWeight，0–100）」，会直接参与候选打分——权威期刊权重高，社区源权重低，排序时社区 / 个人经验类内容会被明确降权。

**新增信源**：在「信源管理 → 新增信源」填写名称、类型、URL/检索式、可信权重、备注即可。也可通过 API（见下节）。

---

## 十二、定时任务（每日自动运行）

定时配置在 [`longevity-intel-bot/vercel.json`](./longevity-intel-bot/vercel.json)：

```json
{
  "crons": [
    { "path": "/api/cron/daily", "schedule": "0 1 * * *" }
  ]
}
```

- `0 1 * * *` = 每天 **01:00 UTC** = **北京时间 09:00**。
- 该接口会执行 `runDailyPipeline({ send: true })`：抓取 → 排序 → 生成 → **直接推送到飞书**。
- 修改推送时间：改 `schedule`（标准 cron 表达式，按 UTC）。例如想改成北京时间 08:00，则用 `0 0 * * *`。
- 若设置了 `CRON_SECRET`，外部调用需带 `Authorization: Bearer <CRON_SECRET>`。

你也可以随时在后台「系统设置 → 运行控制」手动「立即扫描生成」「生成并推送」「推送当前日报」。

---

## 十三、API 接口说明

所有接口运行在 Node.js runtime，均为动态接口。除登录与 Cron 外，其余接口受 `ADMIN_TOKEN` 鉴权保护（见 [第十六节](#十六安全与鉴权)）。

| 方法 & 路径 | 说明 | 请求体 / 参数 |
| --- | --- | --- |
| `GET /api/dashboard` | 返回信源、候选、最新日报、运行历史及统计 | — |
| `POST /api/run` | 抓取 + 排序 + 保存今日日报 | `{ "send"?: boolean, "date"?: string }` |
| `POST /api/send` | 将指定日报推送到飞书 | `{ "reportId": string }` |
| `PATCH /api/report` | 更新日报 Markdown / 状态 | `{ "reportId": string, "contentMarkdown"?: string, "status"?: "draft"|"generated"|"sent"|"failed" }` |
| `GET /api/settings` | 返回运行配置自检与最新运行状态 | — |
| `POST /api/settings` | 连接测试 | `{ "action": "test-lark" | "test-deepseek" }` |
| `GET /api/sources` | 列出所有信源 | — |
| `POST /api/sources` | 新增信源 | `{ name, type, url?, enabled?, credibilityWeight?, notes? }` |
| `PATCH /api/sources` | 更新信源 | `{ id, ...部分字段 }` |
| `GET /api/cron/daily` | 运行并推送当日日报（供 Cron 调用） | Header：`Authorization: Bearer <CRON_SECRET>` |
| `POST /api/login` | 校验管理员口令并下发 Cookie | `{ "token": string }` |

示例：手动触发一次扫描并推送

```bash
curl -X POST https://<你的域名>/api/run \
  -H "Content-Type: application/json" \
  -H "x-admin-token: <ADMIN_TOKEN>" \
  -d '{"send": true}'
```

---

## 十四、排序与评分逻辑

系统采用「**本地启发式预排序 + AI 终排序**」两段式：

**1. 本地启发式打分（`fetchers.ts`）**，影响评分（0–100）综合考虑：

- 来源可信权重（占比约 32%）
- 证据类型加成：人体 RCT > 临床试验 > 人体观察 > 动物 > 细胞 > 预印本 …
- 新颖词加成：clock、senolytic、rapamycin、reprogramming、biomarker、GLP-1 等
- 时效性加成：越新越高（≤2 天最高）
- 长寿主题特异性加成 / 标题特异性加成
- 相关性得分
- **扣分项**：噪声词（太阳能电池、农业害虫、植物花卉、住房、繁育等无关主题）、宽泛生物医学但无长寿信号、标题与正文长寿信号不匹配

低于阈值（影响评分 < 28）或不含长寿信号的内容会被直接过滤。

**2. AI 终排序（`deepseek.ts`）** 按以下优先级（系统 prompt 内置）选出 Top 5：

1. 人体证据、临床试验、强观察数据或可靠重复 > 动物 / 细胞 / 个人经验
2. 对人类健康寿命 / 寿命 / biomarker / 药物发现 / 预防 / 衰老生物学的转化相关性
3. 新机制、可信 biomarker 变化、安全性信号、验证过的靶点
4. 来源可信度：一手论文与权威科学媒体 > Reddit / X / 营销 / 单人实验
5. 惩罚炒作、补剂营销、样本不足的自我实验、无证据断言
6. 保持主题多样性，避免 5 条高度雷同

AI 会诚实标注证据类型，绝不把个人经验包装成临床结论；每条都写出背景、机制、证据强弱、重要性、caveat、下一步观察点。

---

## 十五、降级与容错

系统在缺少配置或部分失败时**不会崩溃，而是优雅降级**，便于逐步配置和调试：

| 情况 | 行为 |
| --- | --- |
| 未配置 `DATABASE_URL` | 使用内存 + 本地 JSON 文件 `data/local-store.json`（仅供本地预览） |
| 未配置 `DEEPSEEK_API_KEY` | 使用本地启发式排序 + 模板化中文解释，后台仍可用 |
| 未配置 `LARK_WEBHOOK_URL` | 推送被跳过并返回提示，流程其余部分正常 |
| 未配置 `ADMIN_TOKEN` | 后台无登录保护（任何人可访问，**生产务必配置**） |
| 个别信源抓取失败 / 被限流 | 通过 `Promise.allSettled` 隔离，单源失败不影响整体，仅在「质量警告」中提示 |
| AI 返回不足 5 条或不合法 | 用 `zod` 校验，并用启发式结果兜底补足 |

后台「系统设置」会列出所有需要处理的配置缺口，方便排查。

---

## 十六、安全与鉴权

鉴权由 [`src/proxy.ts`](./longevity-intel-bot/src/proxy.ts)（Next.js 16 的 proxy / 中间件）统一处理：

- **公开路径**：`/login`、`/api/login`、`/favicon.ico`、`/_next/*`、`/api/cron/*`。
- 其余页面与 API 需要通过校验：浏览器会带 `longevity_admin` Cookie，或在请求头带 `x-admin-token` / `Authorization: Bearer <token>`。
- 校验失败：页面重定向到 `/login`，API 返回 `401`。
- 登录：`POST /api/login` 校验口令后，下发 `httpOnly` Cookie（有效期 7 天）。
- **若未设置 `ADMIN_TOKEN`，鉴权整体关闭** —— 生产环境务必设置一个足够随机的长口令。
- `CRON_SECRET` 单独保护定时接口；`LARK_WEBHOOK_SECRET` 用于飞书请求签名。

---

## 十七、常见问题（FAQ）

**Q：一定要配齐三个 key 才能跑吗？**
不需要。零配置即可本地启动体验，缺哪个就降级哪个。但要在生产真正「每天自动出报告并推送飞书」，至少需要 `DATABASE_URL` + `DEEPSEEK_API_KEY` + `LARK_WEBHOOK_URL`。

**Q：为什么部署后访问报错或找不到页面？**
确认 Vercel 项目的 **Root Directory 设为 `longevity-intel-bot`**，应用不在仓库根目录。

**Q：飞书收不到消息？**
到后台「系统设置 → 测试 Lark」排查；检查 Webhook 是否正确、是否启用了签名校验（启用了就必须填 `LARK_WEBHOOK_SECRET`）、机器人是否还在群里。

**Q：日报内容像模板、不够「聪明」？**
说明没走 AI 排序——检查 `DEEPSEEK_API_KEY` 是否配置正确，用「测试 AI」验证 key、模型名与余额。

**Q：怎么改每天推送时间？**
改 `longevity-intel-bot/vercel.json` 里的 cron 表达式（按 UTC），重新部署。

**Q：候选太少 / 覆盖偏弱？**
在「信源管理」启用更多信源或新增 RSS / 检索式；可选配置 `TAVILY_API_KEY` 扩大全网覆盖。

**Q：X / Twitter 信源为什么不能用？**
它是预留的占位适配器，官方 API 需要授权凭证，尚未接入；接入后可在不改动其余流程的情况下作为新 fetcher 加入。

---

## 十八、免责声明

本工具输出仅用于**科研情报跟踪与团队学习**，不构成医疗建议。日报对证据强弱的标注由启发式规则与大模型生成，可能存在误差；社区与个人经验类内容仅作为早期信号，**不可视为临床结论**。任何与健康相关的决策，请以原始文献和专业医生意见为准。
