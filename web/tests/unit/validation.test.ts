import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractYouTubeId, parseCsv, parseLinksCsv, validateLinkInput } from "@/lib/server/validation";
import { adminImportCsv, verifyEmbeddable } from "@/lib/server/admin";
import { Store, loadAllSources, normalizeLooseLink } from "@/lib/server/store";

const ID = "dQw4w9WgXcQ";

describe("YouTube ID extraction", () => {
  it.each([
    [ID, ID],
    [`https://www.youtube.com/watch?v=${ID}&t=10s`, ID],
    [`https://youtube.com/shorts/${ID}?feature=share`, ID],
    [`https://m.youtube.com/shorts/${ID}`, ID],
    [`https://youtu.be/${ID}`, ID],
    [`youtu.be/${ID}`, ID],
    [`https://www.youtube.com/embed/${ID}`, ID],
    [`https://www.youtube-nocookie.com/embed/${ID}`, ID],
    ["https://vimeo.com/123", null],
    ["short", null],
    ["", null],
  ])("%s", (input, expected) => expect(extractYouTubeId(input)).toBe(expected));
});

describe("link validation", () => {
  const base = { kind: "edu", video_id: ID, title: "T", topic: "math", difficulty: 2, question: "Q?", options: ["a", "b", "c"], correct_index: 2, explanation: "E" };
  it("accepts a valid link", () => expect(validateLinkInput(base).ok).toBe(true));
  it.each([
    [{ kind: "x" }, "kind"],
    [{ video_id: "bad" }, "video id"],
    [{ options: ["a"] }, "2-4"],
    [{ options: ["a", "b", "c", "d", "e"] }, "2-4"],
    [{ options: ["a", "A"], correct_index: 0 }, "distinct"],
    [{ correct_index: 3 }, "range"],
    [{ correct_index: -1 }, "range"],
    [{ explanation: " " }, "explanation"],
    [{ difficulty: 4 }, "difficulty"],
  ])("rejects %j", (patch, msg) => {
    const r = validateLinkInput({ ...base, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });
});

describe("CSV", () => {
  it("parses quoted fields with commas, quotes and newlines", () => {
    const rows = parseCsv('a,"b, c","say ""hi"""\n1,"multi\nline",3\n');
    expect(rows[0].cells).toEqual(["a", "b, c", 'say "hi"']);
    expect(rows[1].cells).toEqual(["1", "multi\nline", "3"]);
    expect(rows[1].line).toBe(2);
  });

  it("imports valid rows and rejects bad ones with 1-based line numbers", () => {
    const csv = [
      "kind,video_id_or_url,title,topic,difficulty,question,option1,option2,option3,option4,correct_index,explanation",
      `edu,https://youtube.com/shorts/${ID},"Fractions, fast",math,1,What is 1/2 + 1/4?,3/4,2/6,1/8,,0,"Common denominator 4, so 2/4 + 1/4"`,
      `edu,not-a-url,Bad,math,1,Q?,a,b,,,0,E`,
      `fun,youtu.be/${ID},Cat,fun,1,What color?,red,blue,,,5,E`,
      `edu,${ID.replace("d", "e")},Two opts,math,3,Q?,yes,no,,,1,Because`,
    ].join("\n");
    const { valid, rejected } = parseLinksCsv(csv);
    expect(valid).toHaveLength(2);
    expect(valid[0].value.options).toEqual(["3/4", "2/6", "1/8"]);
    expect(valid[0].value.title).toBe("Fractions, fast");
    expect(rejected.map((r) => r.line)).toEqual([3, 4]);
    const store = new Store();
    expect(adminImportCsv(store, csv).imported).toBe(2);
    expect(adminImportCsv(store, csv).imported).toBe(2); // upsert, no duplicates
    expect(Object.keys(store.data.links)).toHaveLength(2);
  });

  it("works without a header row", () => {
    expect(parseLinksCsv(`edu,${ID},T,math,1,Q?,a,b,,,1,E`).valid).toHaveLength(1);
  });
});

describe("lenient custom sources", () => {
  it("normalizes strings, loose objects and SeedLinks", () => {
    expect(normalizeLooseLink(`https://youtu.be/${ID}`, "fun")).toMatchObject({ video_id: ID, active: true, has_quiz: false });
    expect(normalizeLooseLink({ link: ID, title: "x" }, "edu")).toMatchObject({ active: false, has_quiz: false });
    expect(normalizeLooseLink({ videoId: ID, question: "Q?", options: ["a", "b"], answer: "b", explanation: "E" }, "edu")).toMatchObject({ correct_index: 1, active: true, has_quiz: true });
    expect(normalizeLooseLink({ nothing: 1 }, "fun")).toBeNull();
  });

  it("loads data/ files and transcripts from a root dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sg-"));
    fs.mkdirSync(path.join(dir, "data"));
    fs.writeFileSync(path.join(dir, "data/fun-links.json"), JSON.stringify([ID, { url: `https://youtube.com/shorts/${ID.replace("d", "f")}` }]));
    fs.writeFileSync(path.join(dir, "data/transcripts.json"), JSON.stringify({ [ID]: { text: "hello", lang: "en" } }));
    const store = new Store();
    const c = loadAllSources(store, dir, {});
    expect(c.dataFun).toBe(2);
    expect(c.seedEdu).toBe(0);
    expect(store.getCachedTranscript(ID)?.transcript_text).toBe("hello");
    const s2 = new Store();
    fs.writeFileSync(path.join(dir, "t.json"), JSON.stringify([{ video_id: ID, transcript: [{ text: "a" }, { text: "b" }] }]));
    loadAllSources(s2, dir, { TRANSCRIPTS_PATH: "t.json" });
    expect(s2.getCachedTranscript(ID)?.transcript_text).toBe("a b");
  });
});

describe("verify embeddable (oEmbed)", () => {
  it.each([
    [200, "embeddable", true],
    [401, "notEmbeddable", false],
    [403, "notEmbeddable", false],
    [404, "gone", false],
  ])("status %i -> %s", async (status, result, emb) => {
    const store = new Store();
    const l = store.upsertLink({ kind: "edu", video_id: ID, url: "", title: "T", topic: "math", difficulty: 1, question: "Q", options: ["a", "b"], correct_index: 0, explanation: "E" });
    const fake = (async () => new Response("", { status })) as unknown as typeof fetch;
    const r = await verifyEmbeddable(store, l.id, fake);
    expect(r.body.result).toBe(result);
    expect(store.data.links[l.id].embeddable).toBe(emb);
  });
});
