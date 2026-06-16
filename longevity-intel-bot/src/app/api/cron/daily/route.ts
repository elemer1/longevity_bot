import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { runDailyPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (config.cronSecret && authorization !== config.cronSecret) {
    return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  }

  const result = await runDailyPipeline({ send: true });
  return NextResponse.json({
    ok: true,
    reportId: result.report.id,
    selectedCount: result.report.contentJson.items.length,
    sent: result.delivery?.ok ?? false
  });
}
