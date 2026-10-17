import { getState } from "@/lib/server/game";
import { withSession } from "@/lib/server/http";

export async function GET() {
  return withSession((ctx, s) => ({ status: 200, body: { ...getState(ctx, s) } }));
}
