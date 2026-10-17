import { answerStudyQuiz } from "@/lib/server/game";
import { readJson, withSession } from "@/lib/server/http";

export async function POST(req: Request) {
  const body = await readJson(req);
  return withSession((ctx, s) => answerStudyQuiz(ctx, s, body));
}
