// Verify the DEPLOYED price-polish bundle from inside a real browser session
// (the plain-fetch version gets bot-walled / password-walled and sees 0 scripts).
// Usage: node <browser.mjs> "https://.../products/gift-card" --script ./scripts/verify-deployed-browser.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL = path.join(
  __dirname,
  "..",
  "extensions",
  "price-polish-extension",
  "assets",
  "price-polish.js",
);

const MARKERS = {
  "FIX 9b refmt (value-unchanged)": "value-unchanged",
  "applied-refmt trace": "applied-refmt",
  "hasPriorPolishState identifier": "hasPriorPolishState",
  "FIX 10 trimmed compare": "state.output.trim() !== textNode.textContent.trim()",
  "replacement-restore trace": "replacement-restore",
  "applied-restore trace": "applied-restore",
};

export default async function run(page) {
  await page.waitForTimeout(4000);

  const live = await page.evaluate(async (markersJson) => {
    const sha256hex = async (s) => {
      const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(s),
      );
      return [...new Uint8Array(buf)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 16);
    };

    // 1) Find the bundle: any script element whose src or text mentions polish
    const external = [...document.querySelectorAll("script[src]")]
      .map((s) => s.src)
      .filter((s) => /price-polish|polish/i.test(s));

    let bundles = [];
    for (const src of external) {
      try {
        const txt = await (await fetch(src)).text();
        bundles.push({ kind: "external", src, text: txt });
      } catch (e) {
        bundles.push({
          kind: "external-fetch-failed",
          src,
          text: "",
          error: String(e),
        });
      }
    }
    if (bundles.length === 0) {
      const inline = [...document.querySelectorAll("script:not([src])")]
        .map((s) => s.textContent || "")
        .filter(
          (t) => t.includes("Price Polish") || t.includes("price-polish"),
        );
      bundles = inline.map((t, i) => ({
        kind: "inline",
        src: `inline#${i}`,
        text: t,
      }));
    }

    const summary = [];
    for (const b of bundles) {
      summary.push({
        kind: b.kind,
        src: b.src,
        length: b.text.length,
        sha256_16: await sha256hex(b.text),
        markers: Object.fromEntries(
          Object.entries(markersJson).map(([k, v]) => [k, b.text.includes(v)]),
        ),
      });
    }

    // 2) Capture current gift-card price element states
    const prices = [
      ...document.querySelectorAll(
        ".price, .price-item, .money, [data-polished]",
      ),
    ]
      .filter(
        (el) =>
          !el.closest("template, script, style") && el.textContent.trim(),
      )
      .slice(0, 20)
      .map((el) => ({
        cls: el.className,
        text: el.textContent.trim(),
        polished: el.dataset.polished || null,
        base: el.dataset.polishBase || null,
        orig: el.dataset.originalPriceText || null,
      }));

    return {
      url: location.href,
      scriptTagCount: external.length,
      bundles: summary,
      prices,
      currency:
        (window.Shopify &&
          window.Shopify.currency &&
          window.Shopify.currency.active) ||
        null,
      allScriptSrcs: [...document.scripts]
        .map((s) => s.src)
        .filter(Boolean),
    };
  }, MARKERS);

  const local = fs.readFileSync(LOCAL, "utf8");
  const localHash = crypto
    .createHash("sha256")
    .update(local)
    .digest("hex")
    .slice(0, 16);

  console.log("URL:", live.url, "| currency:", live.currency);
  console.log("script tags mentioning polish:", live.scriptTagCount);
  console.log("LOCAL file length:", local.length, "sha256[:16]:", localHash);
  for (const b of live.bundles) {
    console.log(`\n=== LIVE BUNDLE (${b.kind}) ${b.src}`);
    console.log("length:", b.length, "sha256[:16]:", b.sha256_16);
    console.log(
      b.sha256_16 === localHash
        ? ">>> IDENTICAL to local file"
        : ">>> DIFFERS from local (stale deploy?)",
    );
    for (const [k, v] of Object.entries(b.markers))
      console.log(`  ${v ? "PRESENT" : "MISSING "} - ${k}`);
  }
  if (live.bundles.length === 0) {
    console.log(
      "\n!!! No bundle found in this page's DOM either. All script srcs:",
    );
    live.allScriptSrcs.forEach((s) => console.log("  ", s));
  }
  console.log("\n=== PRICE ELEMENTS ON PAGE ===");
  for (const p of live.prices) console.log(JSON.stringify(p));
  return live;
}
