import { getFeed } from "@/lib/server/feed";
import { withSession } from "@/lib/server/http";

export async function GET(req: Request) {
  const u = new URL(req.url);
  return withSession((ctx, s) => getFeed(ctx, s, u.searchParams.get("cursor"), u.searchParams.get("after")));
}
