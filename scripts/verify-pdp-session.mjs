// Live PDP verification through the browser skill's SESSION mode.
// Usage (persistent browser across calls):
//   node browser.mjs "https://.../products/gift-card" --session pdp --script ./scripts/verify-pdp-session.mjs
// The first call, if the store is password-walled, unlocks it using the
// PP_STORE_PASSWORD env var (or inline literal in the .cmd wrapper), then
// navigates to the PDP and watches the price for 12 seconds. Subsequent calls
// reuse the unlocked session (cookie persists in the session profile).

const PRODUCT_URL =
  process.env.PP_PRODUCT_URL ||
  "https://price-polish-test-2.myshopify.com/products/gift-card";
const PASSWORD = process.env.PP_STORE_PASSWORD || "";
const WATCH_MS = Number(process.env.PP_WATCH_MS || 12000);

export default async function run(page) {
  const out = { unlocked: false, url: "", priceAfter12s: null, trace: [] };

  // 1) Unlock if we landed on the password page.
  await page
    .goto(PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  const isPasswordPage = await page
    .evaluate(
      () =>
        !!document.querySelector("#password") &&
        /\/password/.test(location.pathname),
    )
    .catch(() => false);

  if (isPasswordPage) {
    if (!PASSWORD) {
      return { error: "Password page detected but PP_STORE_PASSWORD not set." };
    }
    await page.fill("#password", PASSWORD);
    // The Dawn password form submits via XHR on Enter/click; press the button.
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    out.unlocked = true;
    // After unlock we should be on / (or back on the requested path); go to PDP.
    await page
      .goto(PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 45000 })
      .catch(() => {});
  }

  out.url = page.url();

  // 2) Capture PricePolish console lines for the observation window.
  const lines = [];
  const onConsole = (m) => {
    const t = m.text();
    if (/PricePolish|Price Polish/.test(t))
      lines.push(`[${Date.now() % 100000}] ${t}`);
  };
  page.on("console", onConsole);

  // 3) Watch the price element(s) for WATCH_MS, recording every text change.
  await page.evaluate(async (ms) => {
    window.__ppWatch = [];
    const mo = new MutationObserver((muts) => {
      for (const mu of muts) {
        const el = mu.target.parentElement?.closest(".price-item") || mu.target;
        window.__ppWatch.push({
          t: Date.now() % 100000,
          text: String(el.textContent || "").trim(),
        });
      }
    });
    document.querySelectorAll(".price-item, .price, .money").forEach((el) => {
      mo.observe(el, { characterData: true, childList: true, subtree: true });
    });
    await new Promise((r) => setTimeout(r, ms));
    window.__ppDone = true;
  }, WATCH_MS);

  const watched = await page
    .evaluate(() => window.__ppWatch || [])
    .catch(() => []);

  // 4) Final price snapshot.
  out.priceAfter12s = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll(".price-item")).map((e) =>
        e.textContent.trim(),
      ),
    )
    .catch(() => null);

  out.trace = lines.slice(-60);
  out.watched = watched.slice(-60);
  return out;
}
