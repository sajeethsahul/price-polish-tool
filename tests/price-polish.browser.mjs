import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

// Run with the browser skill: browser.mjs about:blank --script ./tests/price-polish.browser.mjs
export default async function run(page) {
  const source = await readFile(new URL("../extensions/price-polish-extension/assets/price-polish.js", import.meta.url), "utf8");
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const config = {
    adjustmentType: "percentage", adjustmentDirection: "increase",
    adjustmentValue: 12.5, roundingPrecision: "standard", endingOption: "none",
    manualIds: ["applied"], appliedPrices: [337.5],
  };
  const html = `<!doctype html><title>Price Polish regression</title><body>
    <article data-variant-id="card"><span id="card" class="price">₹300.00</span></article>
    <form action="/cart/add"><input name="id" value="wax">
      <select name="selling_plan" aria-label="Plan"><option>One-time</option><option>Subscription</option><option>Prepaid</option></select>
      <span id="wax" class="price"><span>₹300.00</span></span>
    </form>
    <span id="second" data-product-price>Rs. 300.00</span>
    <span id="eu" class="money">€1.000,00</span>
    <span id="us" class="money">$1,000.00</span>
    <span id="chf" class="money">Fr. 1.000,00</span>
    <span id="nok" class="money">kr. 1.000,00</span>
    <span id="big" class="money">Fr. 1.234.567,89</span>
    <span id="suf-sym" class="money">1.000,00 €</span>
    <span id="suf-code" class="money">1.000,00 EUR</span>
    <span id="whole" class="price">₹20</span>
    <span id="whole-abbr" class="money">Rs. 20</span>
    <span id="whole-even" class="price">₹40</span>
    <span id="whole-even-abbr" class="money">Rs. 40.00</span>
    <span id="inr-whole" class="price">₹130</span>
    <span id="inr-even" class="price">₹80</span>
    <span id="usd-live" class="price">$20</span>
    <span id="usd-hundred" class="price">$100</span>
    <span id="usd-frac" class="price">$39.50</span>
    <span id="usd-charm" class="price">$39.99</span>
    <span id="eur-comma" class="money">€20,00</span>
    <span id="eur-dotted" class="money">1.200,00 €</span>
    <span id="eur-space" class="money">1 200,00 €</span>
    <span id="jpy" class="money">¥2000</span>
    <span id="applied" data-variant-id="applied" class="price">₹337.50</span>
    <span id="applied-stripped" data-variant-id="applied" class="price">₹225.5</span>
    <div class="price price--large price--sold-out  price--show-badge"><div class="price__regular"><span class="visually-hidden visually-hidden--inline">Regular price</span><span id="dawn-pdp" class="price-item price-item--regular">₹205.6</span></div></div>
    <span id="badge" class="price-badge">Save 15%</span>
    <span id="combined" class="price">Save 15% / Rs. 300.00</span>
    <span id="id-only" data-variant-id="123">0.20</span>
    <span id="hidden" hidden class="price">₹0.32</span>
    <div class="discount"><span id="discount" class="price">15</span></div>
    <div data-price-polish-skip><span id="skip" class="price">₹0.89</span></div>
    <del><span id="compare" class="price">₹400.00</span></del>
    <script id="payload" class="price" type="application/json">{"price":32200}${String.fromCharCode(60, 47)}script>
  </body>`;
  // Mid-run toggle: after the 12.5% suite, a +10% no-ending config is served
  // so the exact reported live case ($20 base → $22.00 output) is reproduced.
  let useTenPercent = false;
  const tenPercentConfig = {
    adjustmentType: "percentage", adjustmentDirection: "increase",
    adjustmentValue: 10, roundingPrecision: "standard", endingOption: "none",
  };
  const server = createServer((req, res) => {
    if (req.url.startsWith("/config-ten-percent")) {
      useTenPercent = true;
      res.writeHead(204);
      return res.end();
    }
    if (req.url.startsWith("/apps/price-polish")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(useTenPercent ? tenPercentConfig : config));
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise(resolve => server.listen(59999, "127.0.0.1", resolve));
  try {
    await page.goto("http://127.0.0.1:59999/products/selling-plans-ski-wax");
  await page.addScriptTag({ content: source });
  const check = async (id2) => page.evaluate((id) => {
    const el = document.getElementById(id);
    return { actual: el.textContent, base: el.dataset.polishBase, polished: el.dataset.polished, html: el.outerHTML };
  }, id2);
  const expectPrice = async (id, text) => {
    try {
      await page.waitForFunction(({ id, text }) => document.getElementById(id).textContent === text, { id, text });
    } catch (error) {
      const diag = await check(id);
      throw new Error(`${id}: expected ${text}, got ${JSON.stringify(diag)}`);
    }
  };
  await expectPrice("card", "₹337.50");
  // Leading-prefix regression: period-containing abbreviations (Fr., kr.) and
  // multi-group thousands separators must resolve to full values, and
  // suffix-style notation must be unaffected.
  await expectPrice("chf", "Fr. 1.125,00");
  await expectPrice("nok", "kr. 1.125,00");
  await expectPrice("big", "Fr. 1.388.888,88");
  await expectPrice("suf-sym", "1.125,00 €");
  await expectPrice("suf-code", "1.125,00 EUR");
  // Fractional results always keep cents (20 * 1.125 = 22.50, NOT 23);
  // REVERSED RULE: whole results now show full currency decimals too —
  // precision comes from the active currency, never from the original
  // element's (possibly trailing-zero-stripped) decimal style.
  await expectPrice("whole", "₹22.50");
  await expectPrice("whole-abbr", "Rs. 22.50");
  await expectPrice("whole-even", "₹45.00");
  await expectPrice("whole-even-abbr", "Rs. 45.00");
  // Snowboard precision-loss shape: whole original (0 decimals in theme
  // text) + FRACTIONAL computed result — decimals must appear and match the
  // true value, never silently rounded away because the original had none
  // (live case: ₹130 → ₹129.49 must not render as ₹129). With the suite's
  // 12.5% increase the exact analogue is ₹130 → ₹146.25.
  await expectPrice("inr-whole", "₹146.25");
  // Exact whole computed result (80 * 1.125 = 90) also gains ".00".
  await expectPrice("inr-even", "₹90.00");
  await expectPrice("wax", "₹337.50");
  await expectPrice("wax", "₹337.50");
  await expectPrice("eu", "€1.125,00");
  await expectPrice("us", "$1,125.00");
  await expectPrice("applied", "₹337.50");
  // FIX 9b: applied variant whose FIRST-SEEN rendering is already trailing-
  // zero-stripped by Shopify's own money filter (live: storedOriginal="₹214.5",
  // displayed "₹214.5"). The leave-untouched exemption protects the VALUE
  // (no markup re-application) — not the stripped FORMAT: reformat the same
  // parsed value to currency precision, no recalculation.
  await expectPrice("applied-stripped", "₹225.50");
  assert.equal(await page.locator("#applied-stripped").getAttribute("data-polish-base"), "225.5");
  // ---- FIX 11 REGRESSION: Dawn PDP price container carries "price--show-badge"
  // (gift-card / snowboard live case). The old substring regex matched the
  // token "price--show-badge" via "badge" and excluded the ENTIRE main price
  // block, leaving the first-seen stripped "₹205.6" on screen permanently with
  // no data-polished attributes. Exclusion must fire per class TOKEN and never
  // for a token beginning with "price"; the badge span itself stays untouched.
  await expectPrice("dawn-pdp", "₹231.30");
  assert.equal(await page.locator("#dawn-pdp").getAttribute("data-polish-base"), "205.6");
  // Theme re-renders it stripped again — must restore, not treat as new base.
  await page.evaluate(() => { document.querySelector("#dawn-pdp").textContent = "₹231"; });
  await expectPrice("dawn-pdp", "₹231.30");
  assert.equal(await page.locator("#dawn-pdp").getAttribute("data-polish-base"), "205.6");
  // Real badge-classed elements must STILL be excluded (no false lift).
  assert.equal(await page.locator("#badge").getAttribute("data-polished"), null);
  // A later whole-numbered re-render of the same value also gains ".00"
  // (value preserved: 225, never marked up).
  await page.evaluate(() => { document.querySelector("#applied-stripped").textContent = "₹225"; });
  await page.waitForTimeout(600);
  await expectPrice("applied-stripped", "₹225.00");
  assert.equal(await page.locator("#applied-stripped").getAttribute("data-polish-base"), "225");
  // Reuse the actual Text node, then replace it, then return to One-time.
  await page.evaluate(() => {
    document.querySelector('[name="selling_plan"]').dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#wax span").firstChild.textContent = "₹286.22";
  });
  await expectPrice("wax", "₹322.00");
  assert.equal(await page.locator("#wax").getAttribute("data-polish-base"), "286.22");
  await page.evaluate(() => { document.querySelector("#wax span").textContent = "₹290.00"; });
  await expectPrice("wax", "₹326.25");
  await page.evaluate(() => { document.querySelector("#wax span").textContent = "₹300.00"; });
  await expectPrice("wax", "₹337.50");
  await expectPrice("second", "Rs. 337.50");
  await page.evaluate(() => { document.querySelector("#second").textContent = "Rs. 286.22"; });
  await expectPrice("second", "Rs. 322.00");
  // Same-value external write is now treated as a theme re-format of our own
  // output (FOUC rule), NOT a new base — otherwise the theme re-rendering
  // "Rs. 322.00" would compound to a wrong new calculation.
  await page.evaluate(() => { document.querySelector("#second").firstChild.textContent = "Rs. 322.00"; });
  await expectPrice("second", "Rs. 322.00");
  assert.equal(await page.locator("#second").getAttribute("data-polish-base"), "286.22");
  // FOUC: theme re-formats our fractional output as a whole number
  // (amount_no_decimals). Must restore full precision from the stored
  // original text, not compound from the rounded value (23 → 25.88).
  await page.evaluate(() => { document.querySelector("#whole").textContent = "₹23"; });
  await expectPrice("whole", "₹22.50");
  assert.equal(await page.locator("#whole").getAttribute("data-polish-base"), "20");
  // A genuine new base (rounded value ≠ our output) still recalculates.
  await page.evaluate(() => { document.querySelector("#whole").textContent = "₹60"; });
  await expectPrice("whole", "₹67.50");

  // ---- REGRESSION: reported $39.50 → $39.5 after a SECOND DOM update ----
  // (a) Theme re-writes OUR output on the same node, stripping the trailing
  // zero (its own money filter uses amount_no_decimals for "compact"):
  // must restore full precision, not parse "₹337.5" as a new base.
  await page.evaluate(() => { document.querySelector("#card").textContent = "₹337.5"; });
  await expectPrice("card", "₹337.50");
  assert.equal(await page.locator("#card").getAttribute("data-polish-base"), "300");

  // (b) Theme REPLACES the whole price element (re-render) with a stripped
  // version of our polished value. A brand-new node has no state; the fix
  // must recognize it as our own recent output and restore, never double-apply.
  await page.evaluate(() => {
    const old = document.querySelector("#card");
    const next = document.createElement("span");
    next.id = "card";
    next.className = "price";
    next.textContent = "₹337.5"; // our output, decimal stripped by theme
    old.replaceWith(next);
  });
  await expectPrice("card", "₹337.50");
  assert.equal(await page.locator("#card").getAttribute("data-polish-base"), "300");

  // (c) A DIFFERENT polished value re-rendered stripped must not compound
  // either (12.5% increase: 431.20 * 1.125 = 485.10 would be the
  // double-apply). First a genuine theme-written base (383.29) polishes to
  // ₹431.20; then the theme re-renders OUR output with the trailing zero
  // stripped ("₹431.2") and it must be restored, not re-parsed as a base.
  await page.evaluate(() => { document.querySelector("#card").textContent = "₹383.29"; });
  await expectPrice("card", "₹431.20");
  assert.equal(await page.locator("#card").getAttribute("data-polish-base"), "383.29");
  await page.evaluate(() => { document.querySelector("#card").textContent = "₹431.2"; });
  await expectPrice("card", "₹431.20");
  assert.equal(await page.locator("#card").getAttribute("data-polish-base"), "383.29");

  // (d) Same-format rewrite of a whole output is a no-op (idempotent).
  await page.evaluate(() => { document.querySelector("#whole-even").textContent = "₹45.00"; });
  await page.waitForTimeout(500);
  await expectPrice("whole-even", "₹45.00");

  // (e) CENT-ROUNDING re-format of a fractional output (the reported
  // "₹205.99 → ₹206" regression): the theme rounds OUR polished value
  // (44.44 → 44, diff 0.01). The old roundedOutput comparison treated this
  // as a genuine new base and compounded; it must restore full precision.
  await page.evaluate(() => { document.querySelector("#us").textContent = "$39.50"; });
  await expectPrice("us", "$44.44");
  await page.evaluate(() => { document.querySelector("#us").textContent = "$44"; });
  await expectPrice("us", "$44.44");
  // polishBase is String(parsedPrice): 39.5, never "39.50" — only the DISPLAY
  // text carries 2 decimals.
  assert.equal(await page.locator("#us").getAttribute("data-polish-base"), "39.5");

  // (f) Same cent-rounding re-format arriving as a full ELEMENT replacement
  // (Dawn section re-render): new node, no state, rounded "₹337.5"-style
  // value — must be restored to the exact prior output, not re-parsed.
  // Re-anchor a FRESH record first: recentOutputs has a 10s TTL, and the
  // earlier (337.5/300) record can already be evicted by the time slow
  // earlier assertions finish — without this the rounded re-render is
  // misread as a genuine new base (338 × 1.125 = 380.25).
  await page.evaluate(() => { document.querySelector("#card").textContent = "₹300.00"; });
  await expectPrice("card", "₹337.50");
  assert.equal(await page.locator("#card").getAttribute("data-polish-base"), "300");
  await page.evaluate(() => {
    const old = document.querySelector("#card");
    const next = document.createElement("span");
    next.id = "card";
    next.className = "price";
    next.textContent = "₹338"; // Math.round(337.50) written by theme
    old.replaceWith(next);
  });
  await expectPrice("card", "₹337.50");

  // (h) ---- REGRESSION: live trace signature "Applied Price (Shopify-rendered,
  // left untouched)" intercepting a theme re-render ----
  // Live log: phase=mutation reason=scan, hasState=true, nodeReplaced=true,
  // storedOriginal="Rs. 285.50", current text "₹285.5", then the Applied
  // branch returned early with changed=false, leaving the stripped text
  // permanently. The theme re-rendered the TEXT NODE inside the SAME element
  // (element state survives in the WeakMap; the recorded node is dead).
  // For an applied variant this must restore the recorded full-precision
  // output WITHOUT recalculating (no double markup), and must NOT log the
  // leave-untouched message for this combination.
  await page.evaluate(() => {
    const el = document.querySelector("#applied");
    el.innerHTML = "<span>₹337.5</span>"; // theme-stripped echo of our output
  });
  await expectPrice("applied", "₹337.50");
  assert.equal(await page.locator("#applied").getAttribute("data-polish-base"), "337.5");

  // (i) Control: a GENUINELY new Shopify-rendered price for the same applied
  // variant must still be adopted fresh (never overwritten with the old
  // restored output, never marked stale).
  await page.evaluate(() => { document.querySelector("#applied").textContent = "₹400.00"; });
  await page.waitForTimeout(600);
  await expectPrice("applied", "₹400.00");
  assert.equal(await page.locator("#applied").getAttribute("data-polish-base"), "400");
  // And a stripped re-render of that new value is restored identically.
  await page.evaluate(() => { document.querySelector("#applied").textContent = "₹400"; });
  await expectPrice("applied", "₹400.00");
  assert.equal(await page.locator("#applied").getAttribute("data-polish-base"), "400");

  // (g) Genuine new base written by the theme (not our output) still
  // recalculates with the ORIGINAL decimals (39.50-style 2-dec preserved).
  await page.evaluate(() => { document.querySelector("#us").textContent = "$39.50"; });
  await expectPrice("us", "$44.44");
  const untouched = {
    badge: "Save 15%", combined: "Save 15% / Rs. 300.00", "id-only": "0.20",
    hidden: "₹0.32", discount: "15", skip: "₹0.89", compare: "₹400.00",
    payload: '{"price":32200}',
  };
  for (const [id, text] of Object.entries(untouched)) {
    if (!(await page.locator(`#${id}`).count())) continue;
    assert.equal(await page.locator(`#${id}`).textContent(), text);
    assert.equal(await page.locator(`#${id}`).getAttribute("data-polished"), null);
  }
  // Attribute-only reveal and repeated non-price mutations cannot compound.
  await page.evaluate(() => {
    document.querySelector("#hidden").textContent = "₹300.00";
    document.querySelector("#hidden").hidden = false;
  });
  await expectPrice("hidden", "₹337.50");
  await page.evaluate(() => { document.querySelector("#badge").textContent = "Save 20%"; });
  await page.waitForTimeout(600);
  await expectPrice("wax", "₹337.50");
  // Explicitly cover the old 30-second observer shutdown.
  await page.waitForTimeout(31000);
  await page.evaluate(() => { document.querySelector("#wax span").textContent = "₹286.22"; });
  await expectPrice("wax", "₹322.00");

  // ---- REGRESSION: currency-precision ".00" (live "$20.00" → "$20" bug) ----
  // Re-navigate under a +10% no-ending config (the live store's rule). The
  // theme has already rendered "$20.00" stripped as "$20" BEFORE Price
  // Polish's first pass; the whole-number result must still show 2 decimals
  // and every later theme/MutationObserver pass must keep "$22.00".
  await page.waitForTimeout(600); // let the 500ms sessionStorage config cache expire
  await page.evaluate(() => fetch("/config-ten-percent"));
  await page.goto("http://127.0.0.1:59999/products/selling-plans-ski-wax");
  // Live storefronts expose the active currency (window.Shopify.currency.active).
  // Injected in the MAIN world via addScriptTag — page.evaluate runs in an
  // isolated world whose window.Shopify is invisible to the main-world script.
  await page.addScriptTag({ content: "window.Shopify = { currency: { active: 'USD' } };" });
  await page.addScriptTag({ content: source });
  // (a) Exact live failure: first-seen text is the theme-stripped "$20";
  // base 20 must polish to "$22.00" (never "$22"), mirroring the reported DOM.
  await expectPrice("usd-live", "$22.00");
  assert.equal(await page.locator("#usd-live").getAttribute("data-polish-base"), "20");
  assert.equal(await page.locator("#usd-live").getAttribute("data-original-price-text"), "$20");
  // (b) Theme re-renders the stripped base 3×; each MutationObserver pass
  // restores "$22.00" from base 20 — never "$20"/"$22", never compounding.
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => { document.querySelector("#usd-live").textContent = "$20"; });
    await expectPrice("usd-live", "$22.00");
    assert.equal(await page.locator("#usd-live").getAttribute("data-polish-base"), "20");
  }
  // (c) A decimals-stripped re-render of OUR OWN output ("$22") must also
  // restore "$22.00" without re-anchoring the base.
  await page.evaluate(() => { document.querySelector("#usd-live").textContent = "$22"; });
  await expectPrice("usd-live", "$22.00");
  assert.equal(await page.locator("#usd-live").getAttribute("data-polish-base"), "20");
  // (d) $100 → $110.00, stable across a decimals-stripped re-render.
  await expectPrice("usd-hundred", "$110.00");
  await page.evaluate(() => { document.querySelector("#usd-hundred").textContent = "$110"; });
  await expectPrice("usd-hundred", "$110.00");
  assert.equal(await page.locator("#usd-hundred").getAttribute("data-polish-base"), "100");
  // (e) Fractional 2-decimal cases keep their existing results.
  await expectPrice("usd-frac", "$43.45");
  await expectPrice("usd-charm", "$43.99");
  // (f) European formats: comma decimals + thousands grouping preserved.
  await expectPrice("eur-comma", "€22,00");
  await expectPrice("eur-dotted", "1.320,00 €");
  await expectPrice("eur-space", "1 320,00 €");
  // Whole computed result on INR also shows full currency decimals
  // (130 * 1.1 = 143 → "₹143.00", never "₹143").
  await expectPrice("inr-whole", "₹143.00");
  // (g) Zero-decimal JPY: never gains ".00". Switch the active currency
  // (read per format call) in the MAIN world and force a recalculation.
  await page.addScriptTag({ content: "window.Shopify.currency.active = 'JPY';" });
  await page.evaluate(() => { document.querySelector("#jpy").textContent = "¥2000"; });
  await expectPrice("jpy", "¥2200");
  await page.evaluate(() => { document.querySelector("#jpy").textContent = "¥2200"; });
  await expectPrice("jpy", "¥2200");
  assert.deepEqual(errors, []);
  return { passed: true, scenarios: ["collection card", "one-time", "subscription", "prepaid", "second product one-time/preorder", "prefix currencies Fr./kr.", "multi-group thousands", "suffix €/EUR"], note: "Synthetic plan prices and config; not live admin-preview verification. Swiss apostrophe grouping (1'000.00) is out of scope." };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
