import { getMe } from "@/lib/server/game";
import { withSession } from "@/lib/server/http";

export async function GET() {
  return withSession((ctx, s) => getMe(ctx, s));
}
