import { NextResponse } from "next/server";
import { verifyEmbeddable } from "@/lib/server/admin";
import { adminGuard, readJson } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

export async function POST(req: Request) {
  const g = adminGuard(req);
  if (g) return g;
  const { id } = await readJson(req);
  const r = await verifyEmbeddable(getStore(), String(id ?? ""));
  return NextResponse.json(r.body, { status: r.status });
}
