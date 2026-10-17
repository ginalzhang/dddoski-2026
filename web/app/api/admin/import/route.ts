import { NextResponse } from "next/server";
import { adminImportCsv } from "@/lib/server/admin";
import { adminGuard } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

export async function POST(req: Request) {
  const g = adminGuard(req);
  if (g) return g;
  const raw = await req.text();
  let csv = raw;
  if ((req.headers.get("content-type") ?? "").includes("json") || raw.trimStart().startsWith("{")) {
    try {
      csv = String((JSON.parse(raw) as { csv?: unknown }).csv ?? "");
    } catch {
      return NextResponse.json({ error: "BadRequest", message: "invalid JSON" }, { status: 400 });
    }
  }
  return NextResponse.json(adminImportCsv(getStore(), csv));
}
