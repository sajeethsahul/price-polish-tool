// Temporary: localize hardcoded strings in client-facing source files.
// Each replacement must match the EXACT expected count, else the script
// aborts WITHOUT writing, so partial/corrupted edits never happen.
import { readFileSync, writeFileSync } from "node:fs";

function applyReplacements(filePath, replacements) {
  let s = readFileSync(filePath, "utf8");
  let total = 0;
  for (const r of replacements) {
    let count;
    if (r.regex instanceof RegExp) {
      const g = new RegExp(r.regex.source, "g");
      count = (s.match(g) || []).length;
      if (count !== r.expected) {
        throw new Error(`[${r.name}] expected ${r.expected} match(es), found ${count} in ${filePath}`);
      }
      s = s.replace(g, r.replace);
    } else {
      count = s.split(r.search).length - 1;
      if (count !== r.expected) {
        throw new Error(`[${r.name}] expected ${r.expected} match(es), found ${count} in ${filePath}`);
      }
      s = s.split(r.search).join(r.replace);
    }
    total += count;
  }
  writeFileSync(filePath, s, "utf8");
  console.log(`[OK] ${filePath}: ${total} replacement(s)`);
}

// ---------------------------------------------------------------------------
// app/routes/app.preview.tsx
// ---------------------------------------------------------------------------
applyReplacements("app/routes/app.preview.tsx", [
  { name: "backToDashboard", search: `content: "Back to dashboard",`, replace: `content: t("preview.backToDashboard"),`, expected: 1 },
  { name: "currency subtitle", search: `subtitle={`Currency: ${currencyCode}`}`, replace: `subtitle={t("preview.currency").replace("{currencyCode}", currencyCode)}`, expected: 1 },
  { name: "empty heading", search: `heading="No products to preview yet"`, replace: `heading={t("preview.empty.heading")}`, expected: 1 },
  { name: "empty action", search: `content: "Adjust pricing rule",`, replace: `content: t("preview.empty.action"),`, expected: 1 },
  { name: "empty body", regex: /<p>\s*Once you create or refine a pricing rule, we'll show a live preview of the new prices here so you can review them before applying\.\s*<\/p>/g, replace: `<p>{t("preview.empty.body")}</p>`, expected: 1 },
  { name: "showingCount", regex: /\{`Showing [^`]*`\}/g, replace: `{t("preview.showingCount").replace("{visible}", visibleCount.toLocaleString()).replace("{total}", totalCount.toLocaleString())}`, expected: 1 },
  { name: "collapseAria", regex: /`Collapse the preview list back to the first \$\{PREVIEW_SAMPLE_SIZE\} products`/g, replace: `t("preview.collapseAria").replace("{count}", String(PREVIEW_SAMPLE_SIZE))`, expected: 1 },
  { name: "expandAria", regex: /`Expand the preview to show all \$\{totalCount\.toLocaleString\(\)\} products`/g, replace: `t("preview.expandAria").replace("{count}", totalCount.toLocaleString())`, expected: 1 },
  { name: "showFewer/viewFull", search: `{showAll ? "Show fewer" : "View Full Preview"}`, replace: `{showAll ? t("preview.showFewer") : t("preview.viewFull")}`, expected: 1 },
  { name: "priceChange", regex: /<Text as="p" tone="subdued">\s*Old: \{p\.oldPrice\} → New: \{p\.newPrice\}\s*<\/Text>/g, replace: `<Text as="p" tone="subdued">{t("preview.priceChange").replace("{old}", p.oldPrice).replace("{new}", p.newPrice)}</Text>`, expected: 1 },
  { name: "previousStepAria", search: `accessibilityLabel="Return to Step 1: Create Pricing Rule"`, replace: `accessibilityLabel={t("preview.previousStepAria")}`, expected: 1 },
  { name: "previousStep text", search: `← Previous Step`, replace: `{t("preview.previousStep")}`, expected: 1 },
  { name: "continueAria", search: `accessibilityLabel="Continue to Step 3: Apply Pricing"`, replace: `accessibilityLabel={t("preview.continueAria")}`, expected: 1 },
  { name: "continue text", search: `Continue →`, replace: `{t("preview.continue")}`, expected: 1 },
]);

// ---------------------------------------------------------------------------
// app/routes/app.settings.tsx
// ---------------------------------------------------------------------------
applyReplacements("app/routes/app.settings.tsx", [
  { name: "settings description", search: `Price Polish automatically uses your Shopify store currency. Advanced settings coming soon.`, replace: `{t("settings.page.description")}`, expected: 1 },
]);

// ---------------------------------------------------------------------------
// app/components/PricePolishLoader.tsx  (brand name -> t("loading.appName"))
// ---------------------------------------------------------------------------
applyReplacements("app/components/PricePolishLoader.tsx", [
  { name: "brand name", search: `Price Polish`, replace: `{t("loading.appName")}`, expected: 1 },
]);

console.log("ALL SOURCE FILES PATCHED.");
