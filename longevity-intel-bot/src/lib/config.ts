export const config = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Compound Longevity 科学情报后台",
  databaseUrl: process.env.DATABASE_URL ?? "",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  larkWebhookUrl: process.env.LARK_WEBHOOK_URL ?? "",
  larkWebhookSecret: process.env.LARK_WEBHOOK_SECRET ?? "",
  adminToken: process.env.ADMIN_TOKEN ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  tavilyApiKey: process.env.TAVILY_API_KEY ?? ""
};

export const isProductionLike = () => process.env.NODE_ENV === "production";
