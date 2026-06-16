import { NextResponse } from "next/server";
import { sendExistingReport } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { reportId?: string };
  if (!body.reportId) {
    return NextResponse.json({ error: "reportId is required" }, { status: 400 });
  }
  const result = await sendExistingReport(body.reportId);
  return NextResponse.json(result);
}
