import { startFun } from "@/lib/server/feed";
import { readJson, withSession } from "@/lib/server/http";

export async function POST(req: Request) {
  const body = await readJson(req);
  return withSession((ctx, s) => startFun(ctx, s, body));
}
