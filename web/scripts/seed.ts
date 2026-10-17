// npm run seed: load seed/*.json + data/*.json into a fresh store, validate, print a summary.
// With --write (or STORE_PERSIST=1) the result is written to .data/store.json for the dev server.
import path from "node:path";
import { Store, loadAllSources } from "../lib/server/store";
import { validateLinkInput } from "../lib/server/validation";

const root = path.resolve(__dirname, "..");
const write = process.argv.includes("--write") || process.env.STORE_PERSIST === "1";
const store = new Store(undefined, write ? path.join(root, ".data/store.json") : null);
const counts = loadAllSources(store, root);
const links = Object.values(store.data.links);
const by: Record<string, { active: number; inactive: number; topics: Set<string> }> = {};
const invalid: string[] = [];
for (const l of links) {
  const b = (by[l.kind] ??= { active: 0, inactive: 0, topics: new Set() });
  if (l.active) b.active++;
  else b.inactive++;
  b.topics.add(l.topic);
  if (l.has_quiz) {
    const v = validateLinkInput({ ...l });
    if (!v.ok) invalid.push(`${l.kind} ${l.video_id}: ${v.error}`);
  }
}
console.log("Loaded from sources:", counts);
for (const [k, b] of Object.entries(by)) console.log(`${k}: ${b.active} active, ${b.inactive} inactive, topics=${[...b.topics].join(",")}`);
console.log(`transcripts: ${Object.keys(store.data.videos).length}`);
if (invalid.length) console.log("Invalid:\n  " + invalid.join("\n  "));
if (write) { store.flush(); console.log("Wrote .data/store.json"); }
