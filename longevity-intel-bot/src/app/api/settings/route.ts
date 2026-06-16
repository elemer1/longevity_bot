import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getDashboardData, hasDatabase } from "@/lib/db";
import { sendLarkText } from "@/lib/lark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SettingsAction = "test-lark" | "test-deepseek";

export async function GET() {
  return NextResponse.json(await buildSettingsStatus());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: SettingsAction };

  if (body.action === "test-lark") {
    const delivery = await sendLarkText("Compound Longevity Bot 连接测试", [
      "这是一条来自系统设置页的 Lark webhook 测试消息。",
      `发送时间：${new Date().toISOString()}`,
      "如果你能在群里看到这条消息，说明 Lark webhook 已经可用。"
    ]);
    return NextResponse.json({
      action: body.action,
      ...delivery,
      status: await buildSettingsStatus()
    });
  }

  if (body.action === "test-deepseek") {
    const result = await testDeepSeek();
    return NextResponse.json({
      action: body.action,
      ...result,
      status: await buildSettingsStatus()
    });
  }

  return NextResponse.json({ error: "Unsupported settings action" }, { status: 400 });
}

async function buildSettingsStatus() {
  const dashboard = await getDashboardData();
  const warnings = [
    !hasDatabase() ? "当前使用本地 JSON 存储；部署到云端前建议配置 DATABASE_URL。" : "",
    !config.deepseekApiKey ? "未配置 DEEPSEEK_API_KEY，日报会使用本地降级排序和模板化解释。" : "",
    !config.larkWebhookUrl ? "未配置 LARK_WEBHOOK_URL，无法真正推送到 Lark。" : "",
    !config.cronSecret ? "未配置 CRON_SECRET，定时接口缺少额外保护。" : "",
    !config.adminToken ? "未配置 ADMIN_TOKEN，后台访问未启用口令保护。" : ""
  ].filter(Boolean);

  return {
    generatedAt: new Date().toISOString(),
    appName: config.appName,
    storage: {
      configured: hasDatabase(),
      label: hasDatabase() ? "Neon/Postgres" : "本地 JSON",
      detail: hasDatabase() ? "生产持久化已连接" : "适合本地预览，不适合云端长期运行"
    },
    deepseek: {
      configured: Boolean(config.deepseekApiKey),
      model: config.deepseekModel,
      baseUrl: config.deepseekBaseUrl,
      detail: config.deepseekApiKey ? "AI 深度排序与中文转述可用" : "当前使用本地降级逻辑"
    },
    lark: {
      configured: Boolean(config.larkWebhookUrl),
      signed: Boolean(config.larkWebhookSecret),
      detail: config.larkWebhookUrl
        ? config.larkWebhookSecret
          ? "Webhook 已配置，签名校验已启用"
          : "Webhook 已配置，未启用签名校验"
        : "Webhook 未配置"
    },
    cron: {
      endpoint: "/api/cron/daily",
      schedule: "UTC 01:00 / Asia-Shanghai 09:00",
      protected: Boolean(config.cronSecret),
      detail: config.cronSecret ? "Cron Bearer token 已配置" : "Cron token 未配置"
    },
    tavily: {
      configured: Boolean(config.tavilyApiKey),
      detail: config.tavilyApiKey ? "全网搜索扩展源可用" : "未启用 Tavily 全网搜索"
    },
    admin: {
      protected: Boolean(config.adminToken),
      detail: config.adminToken ? "后台口令保护已启用" : "后台口令保护未启用"
    },
    latestRun: dashboard.runs[0] ?? null,
    latestReport: dashboard.latestReport
      ? {
          id: dashboard.latestReport.id,
          title: dashboard.latestReport.title,
          status: dashboard.latestReport.status,
          sentAt: dashboard.latestReport.sentAt,
          reportDate: dashboard.latestReport.reportDate
        }
      : null,
    warnings
  };
}

async function testDeepSeek() {
  if (!config.deepseekApiKey) {
    return {
      ok: false,
      skipped: true,
      message: "DEEPSEEK_API_KEY is not configured."
    };
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
          content: "Return the exact text OK."
        },
        {
          role: "user",
          content: "Ping"
        }
      ],
      thinking: { type: "disabled" },
      temperature: 0,
      max_tokens: 16
    }),
    signal: AbortSignal.timeout(20000)
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    body
  };
}
