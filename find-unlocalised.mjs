import { readdir, readFile, writeFile } from "fs/promises";
import { join, extname } from "path";

const EXCLUDE_FILES = ["PricingRuleForm.tsx"];
const SEARCH_DIR = "./app";
const OUTPUT_FILE = "unlocalised_strings.txt";

const PATTERNS = [
  /label="([^"]+)"/g,
  /placeholder="([^"]+)"/g,
  /title="([^"]+)"/g,
  />([A-Z][a-z][\w\s]{2,40})</g,
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...await walk(full));
    else if ([".tsx", ".ts"].includes(extname(e.name))) files.push(full);
  }
  return files;
}

const files = await walk(SEARCH_DIR);
const results = [];

for (const file of files) {
  if (EXCLUDE_FILES.some(ex => file.includes(ex))) continue;
  const content = await readFile(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    for (const pattern of PATTERNS) {
      const matches = [...line.matchAll(pattern)];
      for (const m of matches) {
        results.push(`${file} | Line ${i + 1} | ${m[0].trim()}`);
      }
    }
  });
}

await writeFile(OUTPUT_FILE, results.join("\n"));
console.log(`Done! Found ${results.length} strings → unlocalised_strings.txt`);