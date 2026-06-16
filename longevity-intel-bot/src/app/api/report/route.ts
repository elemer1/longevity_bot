import { NextResponse } from "next/server";
import { getReport, saveReport } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    reportId?: string;
    contentMarkdown?: string;
    status?: "draft" | "generated" | "sent" | "failed";
  };

  if (!body.reportId) {
    return NextResponse.json({ error: "reportId is required" }, { status: 400 });
  }

  const report = await getReport(body.reportId);
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const updated = await saveReport({
    ...report,
    contentMarkdown: body.contentMarkdown ?? report.contentMarkdown,
    status: body.status ?? "draft",
    updatedAt: new Date().toISOString()
  });

  return NextResponse.json({ report: updated });
}
