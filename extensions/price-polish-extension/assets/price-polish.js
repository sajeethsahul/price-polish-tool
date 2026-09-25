(() => {
  const DEBUG = true;

  function log(...args) {
    if (!DEBUG) return;
    console.log(
      `[PricePolish ${performance.now().toFixed(0)}ms]`,
      ...args
    );
  }

  // Which entry point triggered the current pass: init | cache | mutation |
  // final-load | selling-plan-change. Set right before updatePrices runs.
  let passPhase = "init";

  log("Extension Loaded");

  let CONFIG = null;
  let debounceTimer = null;
  let initPromise = null;
  let didRunFinalLoadPass = false;
  let didReveal = false;
  // Private state cannot be inherited by cloned widget/template markup.
  const priceStates = new WeakMap();

  // Reconciliation registry for theme element REPLACEMENTS: Dawn's section
  // re-renderers can swap a polished price element for a fresh node carrying
  // our recently written output re-formatted through the theme's money
  // filter (trailing zeros stripped / cent-rounded). A WeakMap cannot help
  // there — the state dies with the old element — so successful writes are
  // recorded here and consulted ONLY for a fresh element whose matching
  // record's element is no longer connected (the replacement signature).
  const recentOutputs = [];
  const RECENT_OUTPUT_TTL_MS = 10000;
  const RECENT_OUTPUT_LIMIT = 50;

  function recordRecentOutput(el, outputValue, base, originalText) {
    const now = Date.now();
    recentOutputs.push({ el, outputValue, base, originalText, at: now });
    while (recentOutputs.length > RECENT_OUTPUT_LIMIT ||
           (recentOutputs.length && now - recentOutputs[0].at > RECENT_OUTPUT_TTL_MS)) {
      recentOutputs.shift();
    }
  }

  function findReplacementRecord(priceValue) {
    const now = Date.now();
    while (recentOutputs.length && now - recentOutputs[0].at > RECENT_OUTPUT_TTL_MS) {
      recentOutputs.shift();
    }
    for (let i = recentOutputs.length - 1; i >= 0; i--) {
      const rec = recentOutputs[i];
      if (rec.el.isConnected) continue; // still rendered: not a replacement
      if (Math.abs(rec.outputValue - priceValue) < 0.005 ||
          Math.abs(Math.round(rec.outputValue) - priceValue) < 0.005) {
        return rec;
      }
    }
    return null;
  }

  // FOUC reveal: remove the pp-wait gate set by the inline block script so
  // processed prices become visible. Idempotent and fail-open.
  function revealPrices(reason) {
    if (didReveal) return;
    didReveal = true;
    log("Revealing prices:", reason);
    try {
      document.documentElement.classList.remove("pp-wait");
    } catch (error) {
      console.error("Price Polish: reveal failed:", error);
    }
  }
  // Absolute fail-open cap: if anything above goes wrong, Shopify's original
  // prices become visible after this window instead of staying blank.
  setTimeout(() => revealPrices("fail-open deadline"), 3000);
  const CONFIG_CACHE_KEY = "price-polish-runtime-config";
  const CONFIG_CACHE_TTL_MS = 500;

  const SELECTORS = [
    ".price-item",
    ".price",
    ".money",
    "[itemprop='price']",
    "[data-price]",
    "[data-product-price]",
    "[data-price-polish-price]", // Explicit integration hook for custom widgets.
  ];
  const PRICE_SELECTOR = SELECTORS.join(", ");
  const EXCLUDED_SELECTOR = "[data-price-polish-skip], [hidden], [aria-hidden='true'], template, script, style, noscript, input, select, textarea, s, del";
  const EXCLUDED_CLASS = /compare|was[-_]?price|list[-_]?price|save|badge|discount|percent|visually[-_]?hidden|sr-only/i;
  const OBSERVER_OPTIONS = {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden", "data-price-polish-skip"],
    characterDataOldValue: true,
  };

  function isVisiblePrice(el) {
    if (el.closest(EXCLUDED_SELECTOR)) return false;
    for (let parent = el; parent; parent = parent.parentElement) {
      if (EXCLUDED_CLASS.test(parent.getAttribute("class") || "")) return false;
      const style = getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
    }
    return el.getClientRects().length > 0;
  }

  function getPriceTextNode(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const numericNodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (/\d/.test(node.textContent) && isVisiblePrice(node.parentElement)) numericNodes.push(node);
    }
    if (numericNodes.length !== 1) return null;
    // Only a standalone amount, optionally with currency. Do not flatten
    // "Save 15% / Rs. 300.00", plan counts, ranges, or JSON into one number.
    // Currency prefix may be a 1-3 letter abbreviation with optional period
    // ("Fr.", "kr.", "Rs.", "EUR") or a symbol; suffix forms likewise.
    const moneyText =
      /^(?:(?:[A-Za-z]{1,3}\.?|\p{Sc})\s*)?\d(?:[\d.,\s]*\d)?(?:\s*(?:[A-Za-z]{1,3}\.?|\p{Sc}))?$/u;
    return moneyText.test(numericNodes[0].textContent.trim()) ? numericNodes[0] : null;
  }

  function invalidatePrice(el) {
    priceStates.delete(el);
    delete el.dataset.polished;
    delete el.dataset.polishBase;
  }

  // Locale-safe price parsing (mirror of server-side parseShopifyPrice).
  // Storefronts render prices in the market's locale ("€1.000,00",
  // "₹1,000.00"), so raw parseFloat() would truncate European formats.
  // Values are MAJOR units (2.00, not 200) — Shopify renders formatted
  // money strings; no /100 or *100 is needed or performed.
  function parseStorefrontPrice(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;

    const str = String(value).trim();
    if (!str) return 0;

    const cleaned = str.replace(/[^0-9.,\-\s]/g, "").trim();
    if (!cleaned) return 0;

    // Strip any leading non-digit prefix (e.g. "Rs." / "Rs . " abbreviation
    // periods, stray currency fragments) BEFORE separator detection, or
    // "Rs. 300.00" parses as 0.3 — the exact cause of fractional prices.
    const compact = cleaned.replace(/\s/g, "").replace(/^[^\d-]+/, "");
    if (!compact) return 0;
    const lastComma = compact.lastIndexOf(",");
    const lastPeriod = compact.lastIndexOf(".");

    if (lastComma > lastPeriod) {
      // European style: 1.000,00 (or 1 000,00) → 1000.00
      return parseFloat(compact.replace(/\./g, "").replace(",", ".")) || 0;
    }

    // Standard style: 1,000.00 → 1000.00
    return parseFloat(compact.replace(/,/g, "")) || 0;
  }

  // Zero-decimal ISO 4217 currencies — mirrors the server-side list in
  // app/utils/format.ts (ZERO_DECIMAL_CURRENCIES). Currency identity comes
  // from Shopify's storefront global only; it decides HOW MANY DECIMALS the
  // output shows, never the separator style (that stays with the format
  // source text). When the global is unavailable (non-Shopify context /
  // regression harness), storeCurrencyPrecision() returns null and
  // formatPriceLikeOriginal keeps its legacy DOM-mirrored decimal rule.
  const ZERO_DECIMAL_CURRENCIES = [
    "JPY", "KRW", "CLP", "UGX", "VND", "BIF", "DJF",
    "GNF", "ISK", "KMF", "PYG", "RWF", "VUV", "XAF", "XOF", "XPF",
  ];

  function storeCurrencyPrecision() {
    try {
      const code = window.Shopify?.currency?.active;
      if (!code) return null;
      const upper = String(code).toUpperCase();
      return ZERO_DECIMAL_CURRENCIES.includes(upper) ? 0 : 2;
    } catch {
      return null;
    }
  }

  // Replace only the numeric token inside an already-rendered price string,
  // preserving the currency symbol/code, its position, and the locale's
  // decimal/grouping separator style (e.g. "€1.000,00" → "€900,00").
  // No currency conversion is performed — Shopify controls the currency.
  function formatPriceLikeOriginal(originalText, value) {
    const tokenMatch = originalText.match(/\d[\d.,\s]*\d|\d/);
    if (!tokenMatch) return originalText;

    const token = tokenMatch[0];
    const compactToken = token.replace(/\s/g, "");
    const lastComma = compactToken.lastIndexOf(",");
    const lastPeriod = compactToken.lastIndexOf(".");

    // Decimal separator used by the storefront
    const decSep = lastComma > lastPeriod ? "," : ".";
    // Grouping separator: if the original token used spaces (e.g. "1 000,00"),
    // keep spaces; otherwise use the "other" separator, only if the original
    // integer part actually contained it
    const groupSep = token.indexOf(" ") !== -1
      ? " "
      : decSep === "," ? "." : ",";
    const intPart = compactToken.split(decSep)[0];
    const usesGrouping =
      token.indexOf(" ") !== -1 || intPart.indexOf(groupSep) !== -1;

    // DISPLAY PRECISION is the standard decimal count of the shop's ACTIVE
    // CURRENCY — the original element's decimal style no longer decides it
    // (rule REVERSED: the theme strips trailing zeros, e.g. "₹45"/"₹130",
    // so mirroring the token permanently hid ".00" on whole results and
    // cents on fractional ones). 2-decimal currencies ALWAYS show 2
    // ("₹45" → "₹45.00", "₹130" → "₹129.49"); zero-decimal currencies
    // NEVER show any ("¥2000" → "¥2200"). Separator/grouping style still
    // comes from the original token below. When currency info is
    // unavailable, standard 2 decimals is the safe fallback.
    const currencyPrecision = storeCurrencyPrecision();
    const decimals = currencyPrecision !== null ? currencyPrecision : 2;

    const formatted = value.toFixed(Math.min(decimals, 2));
    const [fmtInt, fmtDec = ""] = formatted.split(".");

    let intOut = fmtInt;
    if (usesGrouping) {
      intOut = fmtInt.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);
    }
    const outDec = decimals > 0 ? decSep + fmtDec : "";

    return originalText.replace(token, intOut + outDec);
  }

  async function fetchConfig() {
    try {
      try {
        const cached = sessionStorage.getItem(CONFIG_CACHE_KEY);
        if (cached && !CONFIG) {
          const parsed = JSON.parse(cached);
          if (parsed.expiresAt > Date.now() && parsed.settings) {
            CONFIG = parsed.settings;
            updatePrices("cache");
          }
        }
      } catch {
        sessionStorage.removeItem(CONFIG_CACHE_KEY);
      }

      // Add timestamp to bypass proxy caching issues
      const timestamp = new Date().getTime();
      const response = await fetch(`/apps/price-polish?t=${timestamp}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to fetch config");
      const settings = await response.json();
      CONFIG = settings;
      document.querySelectorAll("[data-polished='true']").forEach(el => {
        delete el.dataset.polished;
      });
      sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({
        settings,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
      }));
      log("Config Loaded", CONFIG);
      return true;
    } catch (error) {
      console.error("Price Polish: Error fetching config:", error);
      CONFIG = {
        markup: 10,
        charm: true,
        rounding: 1,
        adjustmentType: "percentage",
        adjustmentDirection: "increase",
        adjustmentValue: 10,
        endingOption: "0.99",
        roundingPrecision: "standard",
        minPrice: null,
        maxPrice: null,
        manualIds: [],
        appliedPrices: [],
      };
      return false;
    }
  }

  function calculatePrice(price) {
    if (!CONFIG) return price;

    const adjustmentType = (CONFIG.adjustmentType || "percentage").toLowerCase();
    const adjustmentDirection = (CONFIG.adjustmentDirection || (Number(CONFIG.markup) < 0 ? "decrease" : "increase")).toLowerCase();
    const adjustmentValue = Number(
      CONFIG.adjustmentValue !== undefined
        ? CONFIG.adjustmentValue
        : Math.abs(Number(CONFIG.markup) || 0)
    );

    const signed = adjustmentDirection === "decrease" ? -1 : 1;

    let adjusted = price;
    if (adjustmentType === "fixed") {
      adjusted = price + signed * adjustmentValue;
    } else {
      adjusted = price * (1 + signed * (adjustmentValue / 100));
    }

    const roundingPrecision = (CONFIG.roundingPrecision || "standard").toLowerCase();
    if (roundingPrecision === "whole") {
      adjusted = Math.round(adjusted);
    } else if (roundingPrecision === "nearest-0.05") {
      adjusted = Math.round(adjusted / 0.05) * 0.05;
    } else {
      adjusted = Number(adjusted.toFixed(2));
    }

    const endingOption = String(
      CONFIG.endingOption !== undefined
        ? CONFIG.endingOption
        : (CONFIG.charm ? "0.99" : (Number(CONFIG.rounding) > 0 ? Number(CONFIG.rounding).toFixed(2) : "none"))
    ).toLowerCase();

    if (endingOption !== "none") {
      const endingNumber = Number(endingOption);
      if (!isNaN(endingNumber) && endingNumber >= 0 && endingNumber < 1) {
        let candidate = Math.floor(adjusted) + endingNumber;
        if (adjustmentDirection === "decrease") {
          if (candidate > adjusted) candidate -= 1;
        } else {
          if (candidate < adjusted) candidate += 1;
        }
        adjusted = Number(candidate.toFixed(2));
      }
    } else {
      adjusted = Number(adjusted.toFixed(2));
    }

    const minPrice = CONFIG.minPrice === null || CONFIG.minPrice === undefined ? null : Number(CONFIG.minPrice);
    const maxPrice = CONFIG.maxPrice === null || CONFIG.maxPrice === undefined ? null : Number(CONFIG.maxPrice);

    if (minPrice !== null && !isNaN(minPrice)) {
      adjusted = Math.max(adjusted, minPrice);
    }
    if (maxPrice !== null && !isNaN(maxPrice)) {
      adjusted = Math.min(adjusted, maxPrice);
    }

    if (!isFinite(adjusted)) return price.toFixed(2);
    return Number(adjusted).toFixed(2);
  }

  function updatePrices(phaseOverride) {
    const phase = phaseOverride || passPhase;
    passPhase = phase;
    log(
        "updatePrices() phase=" + phase,
        "readyState =", document.readyState
    );

    // ---- TEMP DIAGNOSTIC (double-pass investigation; REMOVE when done) ----
    // Labels every invocation with its trigger phase (cache | init |
    // final-load | mutation), a performance.now() timestamp, and the
    // before/after state of the Snowboard test element.
    const PP_DIAG = true;
    const diagFind = () => {
      for (const el of document.querySelectorAll(".price-item--regular")) {
        const vid = el.dataset.variantId ||
          el.closest("[data-variant-id]")?.dataset.variantId;
        if (vid === "48511021973727") return el;
      }
      return null;
    };
    const diagSnap = (el) => el ? {
      text: el.textContent, polished: el.dataset.polished || null,
      base: el.dataset.polishBase || null,
      orig: el.dataset.originalPriceText || null,
    } : null;
    const diagEl = PP_DIAG ? diagFind() : null;
    const diagBefore = PP_DIAG ? diagSnap(diagEl) : null;
    if (PP_DIAG) {
      log(`[DIAG] pass=${phase} t=${performance.now().toFixed(1)}ms BEFORE=${JSON.stringify(diagBefore)}`);
    }
    // ---- END TEMP DIAGNOSTIC ----

    if (!CONFIG) {
        log("No CONFIG");
        return false;
    }

    const elements = document.querySelectorAll(PRICE_SELECTOR);

    log("Price elements found:", elements.length);


    log("Disconnecting observer before DOM updates");
    observer.disconnect();

    // FIX 5: skip wrapper elements that contain another matched price
    // element, so only the actual price leaf is processed. Prevents
    // wrapper + nested price double-processing (and compare-at prices
    // being treated as sale prices).
    const priceElements = [];
    const dropped = [];
    for (const el of elements) {
      if (!isVisiblePrice(el)) {
        dropped.push({ el, reason: "not-visible" });
        continue;
      }
      const nested = Array.from(el.querySelectorAll(PRICE_SELECTOR)).find(isVisiblePrice);
      if (nested) {
        dropped.push({ el, reason: "contains-nested-price", nested });
        continue;
      }
      priceElements.push(el);
    }
    // A dropped element is invisible to every later pass too (the same filter
    // runs each time), so if a price the shopper CAN see is being dropped here
    // it would stay wrong forever with zero trace output. Log the reason and
    // enough of the ancestor chain to identify the visibility culprit.
    if (dropped.length) {
      log(`Filter dropped ${dropped.length} matched price element(s):`);
      for (const d of dropped) {
        const chain = [];
        for (let p = d.el; p && chain.length < 6; p = p.parentElement) {
          chain.push(`${p.tagName.toLowerCase()}.${p.className || ""}`.slice(0, 80));
        }
        log("  dropped", d.reason, `el=<${d.el.tagName.toLowerCase()} class=${d.el.className}>`,
          d.nested ? `nested=<${d.nested.className}>` : "",
          `ancestors=[${chain.join(" | ")}]`,
          `rects=${d.el.getClientRects().length}`);
      }
    }

    let updatedCount = 0;
    priceElements.forEach(el => {
      const trace = (reason, extra) => log(
        "[Price Polish TRACE]",
        `phase=${phase}`, `reason=${reason}`,
        `el=<${el.tagName.toLowerCase()} id=${el.id || "-"} class=${el.className || "-"}>`,
        extra || ""
      );
      const textNode = getPriceTextNode(el);
      if (!textNode) {
        trace("skip:no-single-numeric-text-node", `before=${JSON.stringify(el.textContent)}`);
        return;
      }

      const originalText = textNode.textContent.trim();
      let state = priceStates.get(el);
      // FIX 1: locale-safe parsing (handles "1.000,00", "1 000,00", "1,000.00").
      // Values are major units as rendered by Shopify — no minor-unit math.
      const priceValue = parseStorefrontPrice(originalText);
      if (!Number.isFinite(priceValue) || priceValue <= 0) {
        trace("skip:unparseable", `before=${JSON.stringify(originalText)} parsed=${priceValue}`);
        return;
      }

      const wasPolished = !!(state && state.node === textNode && state.output === textNode.textContent);
      trace("scan", `before=${JSON.stringify(originalText)} parsed=${priceValue} ` +
        `alreadyProcessed=${wasPolished} hasState=${!!state} nodeReplaced=${!!(state && state.node !== textNode)} ` +
        `storedOriginal=${JSON.stringify(el.dataset.originalPriceText || null)}`);

      // FOUC guard: remember the node's UNPOLISHED text so later passes can
      // detect a theme script re-formatting OUR output (e.g. Dawn re-rendering
      // "₹22.50" as whole-number "₹23" via amount_no_decimals) instead of
      // treating that rounded value as a fresh Shopify base (which would
      // compound: 20 → 22.50 → 23 → 25.88).
      if (!el.dataset.originalPriceText) {
        el.dataset.originalPriceText = originalText;
      }

      // A widget may replace either the text or the entire child node.
      // Never trust a polished flag (including one copied from a template).
      if (state && (state.node !== textNode || state.output !== textNode.textContent)) {
        const reParsed = parseStorefrontPrice(originalText);
        // Theme re-formats of OUR output come in exactly two shapes:
        //  - trailing-zero strip: "₹39.50" → "₹39.5" (parses identical)
        //  - cent-rounding:       "₹205.99" → "₹206" (= Math.round(output))
        // A parsed value matching either is NOT a new base — treating
        // "₹206" as a fresh Shopify price here compounded the markup
        // (206 → 226.99) and is the direct cause of the decimal-loss
        // regression. Genuinely new variant/plan prices differ from the
        // output by more than the rounding granularity and still take the
        // invalidate path below.
        const isThemeReformat =
          Number.isFinite(reParsed) &&
          (Math.abs(reParsed - state.outputValue) < 0.005 ||
           Math.abs(reParsed - Math.round(state.outputValue)) < 0.005);
        if (!Number.isFinite(reParsed) || !isThemeReformat) {
          // Genuinely new base (variant/plan change) — start over.
          invalidatePrice(el);
          state = null;
        }
        // else: theme re-format of our own output — keep state.base and
        // restore full precision below instead of compounding.
        // FIX 8: a theme re-render may normalize our "$39.50" to "$39.5"
        // (fewer decimals). Never adopt that reduced-precision text as the
        // formatting source — keep the ORIGINAL Shopify-rendered text.
      }
      // Element replacement: a brand-new node has no state. If a recently
      // written output with the same value (possibly trailing-zero stripped
      // or cent-rounded) was produced by an element that is no longer
      // connected, this node IS that element's replacement — adopt the
      // recorded base and original text instead of re-anchoring, which
      // would compound (337.5 treated as a fresh base → 379.69). Genuine
      // new bases match no disconnected record and fall through unchanged.
      let basePrice = priceValue;
      if (state) {
        basePrice = state.base;
      } else {
        const replaced = findReplacementRecord(priceValue);
        if (replaced) {
          // Carry the recorded unpolished text onto the replacement node so
          // formatting keeps the original's separator/precision style.
          el.dataset.originalPriceText = replaced.originalText;
          trace("replacement-restore",
            `matched=${replaced.outputValue} base=${replaced.base} ` +
            `original=${JSON.stringify(replaced.originalText)}`);
          basePrice = replaced.base;
        }
      }
      el.dataset.polishBase = String(basePrice);

      // --- IDENTIFY THE SOURCE ---
      let priceSource = 'Default';

      // Search for variant ID in multiple locations (Product Pages, Collection Pages, etc.)
      // FIX 4: removed window.meta?.product?.variants?.[0]?.id — a multi-variant
      // product (e.g. Gift Cards) must never map every displayed price to
      // variant #1. Each variant resolves its own ID from its own element.
      let rawId = el.dataset.variantId ||
                  el.closest("[data-variant-id]")?.dataset.variantId ||
                  document.getElementById("price-polish-root")?.dataset.variantId ||
                  window.ShopifyAnalytics?.meta?.selectedVariantId;

      // Fallback for Collection Pages / Forms
      if (!rawId) {
        const form = el.closest('form[action*="/cart/add"]');
        if (form) {
          const input = form.querySelector('input[name="id"]');
          if (input) rawId = input.value;
        }
      }

      // Fallback for URLs
      if (!rawId && window.location.pathname.includes('/products/')) {
        const urlParams = new URLSearchParams(window.location.search);
        rawId = urlParams.get('variant');
      }

      // Check if this variant was explicitly Applied/Manual by ID
      if (rawId) {
        const normalizeId = (id) => String(id).split('/').pop();

        const isApplied = CONFIG.manualIds && CONFIG.manualIds.some(appliedId => {
           return normalizeId(appliedId) === normalizeId(rawId);
        });

        if (isApplied) {
          priceSource = 'Applied';
        }
      }

      // FIX 3: removed the value-based fallback
      // (CONFIG.appliedPrices.includes(priceValue)) — appliedPrices contains
      // the base-currency price of EVERY polished variant, so any unrelated
      // variant that happened to share a numeric price was misidentified as
      // Applied. Variant identity comes from the variant ID, not the value.

      // FIX 9: the "leave Shopify's rendering alone" exemption must apply ONLY
      // to elements with NO prior polish state — a genuinely fresh, first-seen
      // price for an applied variant. When prior state exists (hasState), the
      // node was swapped under us (nodeReplaced), and the pre-polish text is
      // still recorded (storedOriginal), this is our own previously-polished
      // output re-rendered by the theme with its money filter (trailing-zero
      // strip / cent-round) — exactly the case findReplacementRecord and the
      // isThemeReformat check exist to correct. Intercepting it here left the
      // stripped text (e.g. "₹285.5" for "Rs. 285.50") permanently on screen
      // with changed=false. That combination must always route through the
      // reconciliation/reformat path below instead.
      const hasPriorPolishState = !!(
        state &&
        el.dataset.originalPriceText &&
        (state.node !== textNode ||
         // FIX 10: compare TRIMMED text — the theme re-renders the same value
         // wrapped in its original whitespace ("\n      Rs. 307.00\n    "); an
         // exact compare treated that as a mismatch and rewrote the node on
         // every pass (changed=true churn), racing the theme's re-renders.
         state.output.trim() !== textNode.textContent.trim())
      );
      if (priceSource === "Applied") {
        if (hasPriorPolishState) {
          // FIX 9 (continued): the theme re-rendered our own polished output
          // for an applied variant. Never recalculate here — calculatePrice
          // would re-apply markup on top of an already-final Shopify price
          // (the double-application FIX 3 guards against). Restore the
          // recorded full-precision output onto the new node ONLY when the
          // current text parses to that same output (stripped/rounded
          // re-render); a genuinely new Shopify-rendered price falls through
          // to the re-snapshot below.
          const reParsed = parseStorefrontPrice(originalText);
          const isStaleReformat = Number.isFinite(reParsed) &&
            (Math.abs(reParsed - state.outputValue) < 0.005 ||
             Math.abs(reParsed - Math.round(state.outputValue)) < 0.005);
          if (isStaleReformat && textNode.textContent.trim() !== state.output.trim()) {
            trace("applied-restore",
              `stored=${JSON.stringify(state.output)} current=${JSON.stringify(textNode.textContent)}`);
            textNode.textContent = state.output;
            updatedCount++;
          }
          // Re-anchor state to the (possibly new) node. A stale re-render
          // keeps the restored output as the steady-state snapshot so the
          // unchanged-text pass below behaves idempotently; a genuinely new
          // Shopify-rendered price for the applied variant is adopted fresh
          // (current text becomes the output), otherwise the stale snapshot
          // would never update and this path would re-run every pass.
          // FIX 10 (continued): a genuinely new Shopify-rendered price for the
          // applied variant is adopted fresh AND reformatted to currency
          // precision — Shopify itself may render it stripped ("₹137" for
          // ₹137.00); leaving textNode.textContent as the output preserved the
          // stripped form permanently (the gift-card page bug).
          const adoptedFormatted = formatPriceLikeOriginal(originalText, priceValue);
          if (adoptedFormatted !== originalText) {
            trace("applied-refmt",
              `adopted before=${JSON.stringify(originalText)} after=${JSON.stringify(adoptedFormatted)} value-unchanged`);
            textNode.textContent = adoptedFormatted;
            updatedCount++;
          }
          priceStates.set(el, {
            node: textNode,
            base: isStaleReformat ? state.base : priceValue,
            output: isStaleReformat ? state.output : adoptedFormatted,
            outputValue: isStaleReformat ? state.outputValue : reParsed,
            originalText: isStaleReformat ? state.originalText : originalText,
            originalHasDecimals: isStaleReformat ? state.originalHasDecimals : true,
          });
          if (!isStaleReformat) {
            el.dataset.originalPriceText = originalText;
          }
          el.dataset.polished = "true";
          return;
        }
        // FIX 3: the base variant price has already been changed by Price
        // Polish server-side, and Shopify renders it already localized.
        // Do NOT rewrite the visible text with a base-currency number —
        // just mark as processed so the default markup is not applied twice.
        // FIX 9b: Shopify's own money filter can render the applied price with
        // trailing zeros ALREADY stripped ("₹214.5" for ₹214.50, "₹142" for
        // ₹142.00) — the first scan then stores the stripped text as the
        // original, and leaving the node untouched preserves the stripped
        // rendering permanently. "Left untouched" protects the VALUE (never
        // re-apply markup), not the theme's zero-stripped FORMAT: reformat
        // the same parsed value to the active currency's decimal precision
        // (the REVERSED rule used everywhere else) with NO recalculation.
        const appliedFormatted = formatPriceLikeOriginal(originalText, basePrice);
        if (appliedFormatted !== originalText) {
          trace("applied-refmt",
            `before=${JSON.stringify(originalText)} after=${JSON.stringify(appliedFormatted)} value-unchanged`);
          textNode.textContent = appliedFormatted;
          updatedCount++;
        }
        log("Applied Price (Shopify-rendered, left untouched)", {
          text: originalText,
          variant: rawId,
        });
        priceStates.set(el, {
          node: textNode,
          base: basePrice,
          output: appliedFormatted,
          outputValue: basePrice,
          originalText: el.dataset.originalPriceText || originalText,
          originalHasDecimals: true,
        });
        el.dataset.polished = "true";
        return;
      }

      // --- APPLY LOGIC FOR "DEFAULT" SOURCE ---

      // FIX 6: always calculate from the stored Shopify-rendered base price,
      // never from previously-polished text (idempotent across re-runs).
      const newPrice = parseFloat(calculatePrice(basePrice));
      // Format from the stored UNPOLISHED text, not the current node text:
      // the current text may be a theme-rounded version of our own output.
      const formatSourceText = el.dataset.originalPriceText || originalText;
      const newText = formatPriceLikeOriginal(formatSourceText, newPrice);

      trace("apply", `base=${basePrice} calculated=${newPrice} ` +
        `formatSource=${JSON.stringify(formatSourceText)} formatted=${JSON.stringify(newText)} ` +
        `changed=${originalText !== newText}`);

      if (originalText !== newText) {
        textNode.textContent = newText;
        // FIX 7: removed the per-element MutationObserver that was created
        // inside this loop — the single global debounced observer below
        // already handles AJAX/theme updates with one coherent lifecycle.
        el.dataset.polished = "true";
        updatedCount++;
      } else {
        el.dataset.polished = "true";
      }
      const originalHasDecimals = formatSourceText.includes(".") || formatSourceText.includes(",");
      priceStates.set(el, {
        node: textNode,
        base: basePrice,
        output: textNode.textContent,
        outputValue: newPrice,
        originalText: formatSourceText,
        originalHasDecimals,
      });
      // Record the write so a later whole-element replacement of this node
      // can be reconciled (findReplacementRecord) instead of re-anchoring.
      recordRecentOutput(el, newPrice, basePrice, formatSourceText);
    });

    if (PP_DIAG) {
      const diagAfter = diagSnap(diagEl);
      log(`[DIAG] pass=${phase} t=${performance.now().toFixed(1)}ms AFTER=${JSON.stringify(diagAfter)} ` +
        `changed=${JSON.stringify(diagBefore) !== JSON.stringify(diagAfter)}`);
    }
    // ---- END TEMP DIAGNOSTIC ----
    observer.observe(document.body, OBSERVER_OPTIONS);
    return updatedCount > 0;
  }

  function scheduleUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => updatePrices("mutation"), 300);
  }

  // Keep observing for the page lifetime: shoppers can select a plan long
  // after initial load. Our own writes happen while disconnected.
  const observer = new MutationObserver((mutations) => {
    if (!CONFIG) return;
    if (DEBUG) {
      for (const m of mutations.slice(0, 5)) {
        const t = m.target;
        const cls = t instanceof Element ? t.className || t.id || t.tagName.toLowerCase() : "#text";
        const before = m.type === "characterData" && m.oldValue != null
          ? JSON.stringify(m.oldValue.trim())
          : m.type === "attributes" ? m.attributeName
          : `added=${m.addedNodes.length} removed=${m.removedNodes.length}`;
        log("[Price Polish TRACE]", `phase=observer raw-mutation type=${m.type} target=${cls} ${before}`);
      }
      if (mutations.length > 5) log(`...and ${mutations.length - 5} more mutations this batch`);
    }
    // Invalidation decisions (theme FOUC re-format vs genuine new base) are
    // made inside updatePrices, which can compare parsed values; only
    // schedule here.
    scheduleUpdate();
  });

  const sellingPlanListener = (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.matches("input, select") && /selling[-_]?plan/i.test(
      `${event.target.getAttribute("name") || ""} ${event.target.id} ${event.target.getAttribute("class") || ""}`
    )) {
      // Don't erase unchanged output here: async widgets may not have
      // rendered yet. The observer invalidates only the text they replace.
      scheduleUpdate();
    }
  };
  document.addEventListener("change", sellingPlanListener);

async function init() {
    log("INIT START");

    // A fresh sessionStorage cache (500ms TTL) already populated CONFIG —
    // don't hold the pp-wait gate on a redundant network round-trip.
    if (!CONFIG)
        await fetchConfig();

    // Reveal BEFORE updatePrices, within the same synchronous task: the gate
    // lifts and the polished text is written before the browser can paint,
    // so the customer never sees the original Shopify price.
    revealPrices("config ready");

    log("Calling updatePrices() from init");

    updatePrices("init");

    log("INIT END");
}

function runInit() {
    if (!initPromise) {
        initPromise = init();
    }

    return initPromise;
}

window.addEventListener("load", () => {
    log("WINDOW LOAD");

    const pendingInit = initPromise || Promise.resolve();
    pendingInit.finally(() => {
        if (didRunFinalLoadPass) return;

        didRunFinalLoadPass = true;
        log("Calling updatePrices() from final load pass");
        updatePrices("final-load");
    });
});

document.addEventListener("readystatechange", () => {
    log("READY STATE =", document.readyState);
});

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runInit, { once: true });
    // NOTE: do NOT reveal on DOMContentLoaded. The pp-wait gate must stay up
    // until the config-driven updatePrices() pass has rewritten the prices —
    // revealing here (before the async config fetch resolves) is exactly what
    // caused the original-price flash. The 3s fail-open deadline above covers
    // the case where config never arrives; the CSS gate only hides price
    // elements, so pages without prices are unaffected either way.
  } else {
    runInit();
    revealPrices("script late");
  }
})();
