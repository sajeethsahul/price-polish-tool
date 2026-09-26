const PRICE_SELECTOR = ".price";

async function snapshot(page) {
  return page.evaluate((selector) => {
    return Array.from(document.querySelectorAll(selector))
      .slice(0, 12)
      .map(
        (e) =>
          e.className +
          " || " +
          e.textContent.trim().replace(/\s+/g, " ").slice(0, 60),
      );
  }, PRICE_SELECTOR);
}

async function waitForPriceSettled(page, quietMs = 1500, timeoutMs = 10000) {
  return page.evaluate(
    ({ selector, quietMs, timeoutMs }) => {
      return new Promise((resolve) => {
        const nodes = document.querySelectorAll(selector);
        if (!nodes.length) return resolve(false);

        let timer;
        const done = (settled) => {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(settled);
        };

        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => done(true), quietMs);
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["class", "data-price", "aria-hidden"],
        });

        const timeout = setTimeout(() => done(true), timeoutMs);
        timer = setTimeout(() => done(true), quietMs);
      });
    },
    { selector: PRICE_SELECTOR, quietMs, timeoutMs },
  );
}

export default async function run(page) {
  // capture prices on first paint (initial HTML) vs after any script runs
  await page.waitForSelector(PRICE_SELECTOR, { timeout: 15000 });
  const initial = await snapshot(page);

  const settled = await waitForPriceSettled(page);
  const later = await snapshot(page);

  // Pairwise diff so we can see both sides of each change, not just "before".
  const changed = [];
  const len = Math.max(initial.length, later.length);
  for (let i = 0; i < len; i++) {
    if (initial[i] !== later[i]) {
      changed.push({
        index: i,
        initial: initial[i] ?? "(missing)",
        later: later[i] ?? "(missing)",
      });
    }
  }
  return { initial, later, changed, didChange: changed.length > 0, settled };
}

// CLI entry: node scripts/qa_price.mjs <url>
// Requires playwright installed (npx playwright install chromium on first run).
if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href
) {
  const { chromium } = await import("playwright");
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node scripts/qa_price.mjs <store-url>");
    process.exit(1);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const result = await run(page);
    console.log("Settled:", result.settled);
    console.log("Initial prices:");
    result.initial.forEach((v, i) => console.log(`  [${i}] ${v}`));
    if (result.didChange) {
      console.log("Changed after scripts ran:");
      result.changed.forEach((c) =>
        console.log(`  [${c.index}] ${c.initial}\n        -> ${c.later}`),
      );
    } else {
      console.log("No price changes after settle.");
    }
  } finally {
    await browser.close();
  }
}
