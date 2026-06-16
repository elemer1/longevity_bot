import { NextResponse } from "next/server";
import { runDailyPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { send?: boolean; date?: string };
  const result = await runDailyPipeline({ send: Boolean(body.send), date: body.date });
  return NextResponse.json(result);
}
