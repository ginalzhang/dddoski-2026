import { NextResponse } from "next/server";
import { adminDeactivateLink, adminUpdateLink } from "@/lib/server/admin";
import { adminGuard, readJson } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const g = adminGuard(req);
  if (g) return g;
  const { id } = await ctx.params;
  const r = adminUpdateLink(getStore(), id, await readJson(req));
  return NextResponse.json(r.body, { status: r.status });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const g = adminGuard(req);
  if (g) return g;
  const { id } = await ctx.params;
  const r = adminDeactivateLink(getStore(), id);
  return NextResponse.json(r.body, { status: r.status });
}
