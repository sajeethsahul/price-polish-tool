import { readdir, readFile, writeFile } from "fs/promises";
import { join, extname } from "path";

const SEARCH_DIR = "./app";
const OUTPUT = "p0_search.txt";

const PATTERNS = [
  { label: "P0.1+P0.2 — 250 limit / pagination", regex: /250|first.*product|products.*first|\.first\(|take.*250|limit.*250/i },
  { label: "P0.1 — Preview fetch logic", regex: /preview|fetchProduct|loadProduct|getProducts|productsFetch/i },
  { label: "P0.3 — Scheduler billing check", regex: /setInterval|cron|processScheduled|scheduledJob|runScheduler/i },
  { label: "P0.4 — Webhook / subscription sync", regex: /APP_SUBSCRIPTIONS|SUBSCRIPTIONS_UPDATE|webhook|app_subscriptions/i },
  { label: "P0.5+P0.6 — Rollback / revert / compareAtPrice", regex: /rollback|revert|oldPrice|restorePrice|compareAtPrice|compare_at_price/i },
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...await walk(full));
    else if ([".ts", ".tsx"].includes(extname(e.name))) files.push(full);
  }
  return files;
}

const files = await walk(SEARCH_DIR);
const lines = [];

for (const { label, regex } of PATTERNS) {
  lines.push(`\n${"=".repeat(60)}`);
  lines.push(`${label}`);
  lines.push("=".repeat(60));

  let found = 0;
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const fileLines = content.split("\n");
    fileLines.forEach((line, i) => {
      if (regex.test(line)) {
        lines.push(`${file} | Line ${i + 1} | ${line.trim()}`);
        found++;
      }
    });
  }
  if (found === 0) lines.push("  (no matches found)");
}

await writeFile(OUTPUT, lines.join("\n"));
console.log(`Done → p0_search.txt (${lines.length} lines)`);