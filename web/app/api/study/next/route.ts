import { studyNext } from "@/lib/server/game";
import { withSession } from "@/lib/server/http";

export async function GET() {
  return withSession((ctx, s) => studyNext(ctx, s));
}
