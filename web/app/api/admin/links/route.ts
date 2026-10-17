import { NextResponse } from "next/server";
import { adminCreateLink, adminListLinks } from "@/lib/server/admin";
import { adminGuard, readJson } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

export async function GET(req: Request) {
  const g = adminGuard(req);
  if (g) return g;
  return NextResponse.json({ links: adminListLinks(getStore()) });
}

export async function POST(req: Request) {
  const g = adminGuard(req);
  if (g) return g;
  const r = adminCreateLink(getStore(), await readJson(req));
  return NextResponse.json(r.body, { status: r.status });
}
