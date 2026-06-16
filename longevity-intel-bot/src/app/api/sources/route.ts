import { NextResponse } from "next/server";
import { getSources, updateSource, upsertSource } from "@/lib/db";
import type { Source, SourceType } from "@/lib/types";
import { stableId } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedTypes: SourceType[] = ["rss", "pubmed", "arxiv", "reddit", "tavily", "x", "manual"];

export async function GET() {
  return NextResponse.json({ sources: await getSources() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<Source>;
  if (!body.name || !body.type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }
  if (!allowedTypes.includes(body.type)) {
    return NextResponse.json({ error: "Invalid source type" }, { status: 400 });
  }

  const source: Source = {
    id: body.id || stableId(`source:${body.name}:${body.url ?? ""}`),
    name: body.name,
    type: body.type,
    url: body.url ?? "",
    enabled: body.enabled ?? true,
    credibilityWeight: Number(body.credibilityWeight ?? 50),
    notes: body.notes ?? ""
  };

  await upsertSource(source);
  return NextResponse.json({ source });
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<Source> & { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updated = await updateSource(body.id, body);
  return NextResponse.json({ source: updated });
}
