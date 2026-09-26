import { readFileSync, writeFileSync } from "node:fs";

const p = "tests/price-polish.md";
let t = readFileSync(p, "utf8");
const start = t.indexOf(
  "However, decimal PRESENCE was previously NOT mirrored",
);
const end = t.indexOf("## Integration", start);
if (start < 0 || end < 0) {
  console.error("markers not found");
  process.exit(1);
}
const replacement = `However, decimal PRESENCE needs care: the output mirrors the original node's
decimal style for whole-number results, but a fractional calculated amount
(e.g. 20 + 12.5% = 22.50) must always keep its cents — never round it away to
match a whole-number original. The rule in \`formatPriceLikeOriginal\`:

- Calculated amount has a non-zero fraction (>0.001 tolerance for float error)
  → always 2 decimals, regardless of the original.
- Calculated amount is whole → 0 decimals if the original had none (\`₹40\` →
  \`₹45\`), 2 decimals if the original had them (\`Rs. 40.00\` → \`Rs. 45.00\`).

Regression cases (passing):

| Original | Calculated (12.5%) | Polished | Why |
| --- | --- | --- | --- |
| \`₹20\` | 22.50 (fractional) | \`₹22.50\` | cents kept, NOT rounded away to \`₹23\` |
| \`Rs. 20\` | 22.50 (fractional) | \`Rs. 22.50\` | same, abbreviation form |
| \`₹40\` | 45.00 (whole) | \`₹45\` | whole result + whole original → no decimals |
| \`Rs. 40.00\` | 45.00 (whole) | \`Rs. 45.00\` | whole result + decimal original → 2 decimals |
| \`₹300.00\` | 337.50 (fractional) | \`₹337.50\` | fractional → 2 decimals |

`;
writeFileSync(p, t.slice(0, start) + replacement + t.slice(end));
console.log("docs updated");
