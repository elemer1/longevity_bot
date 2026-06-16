import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: string };

  if (!config.adminToken) {
    return NextResponse.json({ ok: true, message: "ADMIN_TOKEN is not configured; auth is disabled." });
  }

  if (body.token !== config.adminToken) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("longevity_admin", config.adminToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });
  return response;
}
