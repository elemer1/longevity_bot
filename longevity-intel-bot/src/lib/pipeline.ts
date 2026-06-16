import {
  getReport,
  getSources,
  saveCandidates,
  saveReport,
  saveRun
} from "./db";
import { rankCandidatesWithDeepSeek } from "./deepseek";
import { fetchAllSources } from "./fetchers";
import { sendReportToLark } from "./lark";
import { appendRunQualityNotes, buildReportRecord, buildRunQuality, mergeRankedMetadata } from "./report";
import type { RunRecord } from "./types";
import { stableId, todayIsoDate } from "./utils";

export async function runDailyPipeline(options: { date?: string; send?: boolean } = {}) {
  const reportDate = options.date ?? todayIsoDate();
  const run: RunRecord = {
    id: stableId(`run:${reportDate}:${Date.now()}`),
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message: "Daily scan started.",
    fetchedCount: 0,
    selectedCount: 0
  };

  await saveRun(run);

  try {
    const sources = await getSources();
    const { candidates, results } = await fetchAllSources(sources);
    await saveCandidates(candidates);

    const reportContent = await rankCandidatesWithDeepSeek(candidates, reportDate);
    const candidatesWithAi = mergeRankedMetadata(candidates, reportContent);
    await saveCandidates(candidatesWithAi);
    const quality = buildRunQuality(results, candidatesWithAi, reportContent.items.length);

    let report = appendRunQualityNotes(
      buildReportRecord(reportContent, reportDate, "generated"),
      results,
      candidates.length,
      quality
    );
    await saveReport(report);

    let delivery: Awaited<ReturnType<typeof sendReportToLark>> | null = null;
    if (options.send) {
      delivery = await sendReportToLark(report);
      report = {
        ...report,
        status: delivery.ok ? "sent" : "failed",
        sentAt: delivery.ok ? new Date().toISOString() : null,
        deliveryResponse: delivery as Record<string, unknown>
      };
      await saveReport(report);
    }

    const failures = results.filter((result) => result.error);
    await saveRun({
      ...run,
      status: "completed",
      finishedAt: new Date().toISOString(),
      fetchedCount: candidates.length,
      selectedCount: report.contentJson.items.length,
      quality,
      message:
        failures.length > 0
          ? `Completed with ${failures.length} source warning(s).`
          : "Completed successfully."
    });

    return {
      report,
      candidates,
      sourceResults: results,
      delivery
    };
  } catch (error) {
    await saveRun({
      ...run,
      status: "failed",
      finishedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export async function sendExistingReport(reportId: string) {
  const report = await getReport(reportId);
  if (!report) throw new Error(`Report not found: ${reportId}`);

  const delivery = await sendReportToLark(report);
  const updated = {
    ...report,
    status: delivery.ok ? ("sent" as const) : ("failed" as const),
    sentAt: delivery.ok ? new Date().toISOString() : report.sentAt,
    deliveryResponse: delivery as Record<string, unknown>
  };

  await saveReport(updated);
  return {
    report: updated,
    delivery
  };
}
