// Verifies which price-polish bundle the live storefront is actually serving.
// Fetches the storefront page, locates the live price-polish script URL,
// downloads it, and checks for markers introduced by FIX 9 / FIX 9b / FIX 10.
// Also prints length + a simple checksum of both live and local files.
const STORE_URL =
  "https://price-polish-test-2.myshopify.com/products/gift-card";
const LOCAL_PATH = new URL(
  "../extensions/price-polish-extension/assets/price-polish.js",
  import.meta.url,
);

const pageRes = await fetch(STORE_URL, {
  headers: { "User-Agent": "Mozilla/5.0" },
});
const html = await pageRes.text();
console.log("HTTP status:", pageRes.status);
console.log("HTML length:", html.length);
console.log("final URL:", pageRes.url);
console.log("first 400 chars:\n", html.slice(0, 400));
const fsMod = await import("node:fs");
fsMod.writeFileSync(new URL("../ScriptRanResult.html", import.meta.url), html);
console.log('(full HTML saved to ScriptRanResult.html for inspection)');

// Find every script src mentioning price-polish (could be app CDN or theme asset).
// NOTE: `[^>]*` not `[^>]+` — the theme renders `<script src=...>` with NO
// attributes between the tag name and src, so `[^>]+` matched nothing and
// falsely reported "no external script tag".
const srcs = [
  ...html.matchAll(/<script[^>]*src=["']([^"']*price-polish[^"']*)["']/gi),
].map((m) => m[1]);
console.log("Script tags referencing price-polish on live page:", srcs.length);
srcs.forEach((s) => console.log("  ", s));

if (srcs.length === 0) {
  console.log(
    "No external script tag found — the bundle may be inlined or served under a different name.",
  );
  // Extract inline <script> blocks containing polish code
  const blocks = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .filter((s) => s.includes("Price Polish") || s.includes("price-polish"));
  console.log("Inline blocks containing polish code:", blocks.length);
  const [{ default: crypto }, fs] = await Promise.all([
    import("node:crypto"),
    import("node:fs"),
  ]);
  const h = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
  const local = fs.readFileSync(LOCAL_PATH, "utf8");
  console.log("\n=== LOCAL FILE length:", local.length, "sha256[:16]:", h(local));
  blocks.forEach((live, i) => {
    console.log(`\n=== INLINE BLOCK #${i} length: ${live.length} sha256[:16]: ${h(live)}`);
    console.log(h(live) === h(local) ? "  >>> IDENTICAL to local" : "  >>> DIFFERS from local");
    const markers = {
      "FIX 9b refmt (value-unchanged comment)": live.includes("value-unchanged"),
      "applied-refmt trace": live.includes("applied-refmt"),
      "hasPriorPolishState identifier": live.includes("hasPriorPolishState"),
      "FIX 10 trimmed compare": live.includes("state.output.trim() !== textNode.textContent.trim()"),
      "replacement-restore trace": live.includes("replacement-restore"),
      "applied-restore trace": live.includes("applied-restore"),
    };
    for (const [k, v] of Object.entries(markers))
      console.log(`  ${v ? "PRESENT" : "MISSING "} - ${k}`);
    const idx = live.indexOf("Applied Price (Shopify-rendered, left untouched)");
    if (idx !== -1) {
      console.log("  --- live code around the log line ---");
      console.log(live.slice(Math.max(0, idx - 700), idx + 300));
    }
  });
  if (blocks.length === 0) {
    console.log("No inline polish block found. All script tags:");
    [...html.matchAll(/<script[^>]*>/gi)].forEach((m) => console.log("  ", m[0].slice(0, 120)));
  }
} else {
  for (const src of srcs) {
    const url = src.startsWith("http") ? src : new URL(src, STORE_URL).href;
    const res = await fetch(url);
    const live = await res.text();
    console.log("\n=== LIVE BUNDLE:", url);
    console.log("length:", live.length);

    const markers = {
      "FIX 9b refmt (value-unchanged comment)":
        live.includes("value-unchanged"),
      "applied-refmt trace": live.includes("applied-refmt"),
      "hasPriorPolishState identifier": live.includes("hasPriorPolishState"),
      "FIX 10 trimmed compare": live.includes(
        "state.output.trim() !== textNode.textContent.trim()",
      ),
      "replacement-restore trace": live.includes("replacement-restore"),
      "applied-restore trace": live.includes("applied-restore"),
    };
    for (const [k, v] of Object.entries(markers))
      console.log(`  ${v ? "PRESENT" : "MISSING "} - ${k}`);

    // Show the "Applied Price" log context from the live bundle
    const idx = live.indexOf(
      "Applied Price (Shopify-rendered, left untouched)",
    );
    if (idx !== -1) {
      console.log("  --- live code around the log line ---");
      console.log(live.slice(Math.max(0, idx - 600), idx + 200));
    }
  }
}

const fs = await import("node:fs");
const local = fs.readFileSync(LOCAL_PATH, "utf8");
console.log("\n=== LOCAL FILE:", LOCAL_PATH.pathname);
console.log("length:", local.length);
const crypto = await import("node:crypto");
const h = (s) =>
  crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
console.log("local  sha256[:16]:", h(local));

// Checksum any live bundle downloaded above for direct comparison
for (const src of srcs) {
  const url = src.startsWith("http") ? src : new URL(src, STORE_URL).href;
  const live = await (await fetch(url)).text();
  console.log(`live   sha256[:16]: ${h(live)}   (${url})`);
  console.log(
    live === local
      ? "  >>> IDENTICAL to local file"
      : "  >>> DIFFERS from local file (stale deployment)",
  );
}
