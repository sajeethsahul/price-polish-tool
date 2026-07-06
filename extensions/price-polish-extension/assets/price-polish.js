(() => {
  const DEBUG = true;

  function log(...args) {
    if (!DEBUG) return;
    console.log(
      `[PricePolish ${performance.now().toFixed(0)}ms]`,
      ...args
    );
  }

  log("Extension Loaded");

  let CONFIG = null;
  let debounceTimer = null;
  let lastMutationTime = Date.now();
  let observerActive = true;
  let initPromise = null;
  let didRunFinalLoadPass = false;
  const STABILITY_THRESHOLD = 30000; // 5 seconds of no changes to stop observer
  const CONFIG_CACHE_KEY = "price-polish-runtime-config";
  const CONFIG_CACHE_TTL_MS = 500;

  const SELECTORS = [
    ".price-item",
    ".price__regular .price-item",
    ".price",
    "[class*='price']",
    "[data-product-price]",
    "[data-variant-id]", // NEW
    "[data-product-id]", // NEW
  ];

  async function fetchConfig() {
    try {
      try {
        const cached = sessionStorage.getItem(CONFIG_CACHE_KEY);
        if (cached && !CONFIG) {
          const parsed = JSON.parse(cached);
          if (parsed.expiresAt > Date.now() && parsed.settings) {
            CONFIG = parsed.settings;
            updatePrices();
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

  function updatePrices() {
    log(
        "updatePrices()",
        "observerActive =", observerActive,
        "readyState =", document.readyState
    );

    if (!CONFIG) {
        log("No CONFIG");
        return false;
    }

    const elements = document.querySelectorAll(SELECTORS.join(", "));

    log("Price elements found:", elements.length);

    if (elements.length === 0)
        return false;


    if (elements.length === 0) return false;
log("Disconnecting observer before DOM updates");
    observer.disconnect();

    let updatedCount = 0;
    elements.forEach(el => {
      if (el.dataset.polished === "true") return;
      // Extract the price early to use as a fallback identifier
      const textNode = Array.from(el.childNodes).find(node => 
        node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent)
      );
      if (!textNode) return;

      const originalText = textNode.textContent.trim();
      const priceValue = parseFloat(originalText.replace(/[^\d.]/g, ""));
      if (isNaN(priceValue)) return;

      // --- IDENTIFY THE SOURCE ---
      let priceSource = 'Default';
      
      // Search for variant ID in multiple locations (Product Pages, Collection Pages, etc.)
      let rawId = el.dataset.variantId || 
                  el.closest("[data-variant-id]")?.dataset.variantId ||
                  document.getElementById("price-polish-root")?.dataset.variantId ||
                  window.ShopifyAnalytics?.meta?.selectedVariantId ||
                  window.meta?.product?.variants?.[0]?.id;

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
        const numericRawId = normalizeId(rawId);
        
        const isApplied = CONFIG.manualIds && CONFIG.manualIds.some(appliedId => {
           return normalizeId(appliedId) === numericRawId;
        });

        if (isApplied) {
          priceSource = 'Applied';
        }
      }

      // Check if this variant was explicitly Applied/Manual by Value (Foolproof Fallback)
      if (priceSource !== 'Applied' && CONFIG.appliedPrices && CONFIG.appliedPrices.includes(priceValue)) {
         priceSource = 'Applied';
      }

      // --- THE BYPASS ---
      // If a price is explicitly set/applied, ABORT all further calculations 
      // if (priceSource === 'Applied') {
      //   el.dataset.polished = "true";
      //   return; // Prevents "flicker" and skips calculations completely
      // }


// if (priceSource === "Applied") {
//   const formattedPrice = Number(priceValue).toFixed(2);

//   console.log("=== BEFORE UPDATE ===");
//   console.log({
//     originalText,
//     formattedPrice,
//     outerHTML: el.outerHTML,
//   });

//   textNode.textContent = originalText.replace(
//     /[\d,.]+/,
//     formattedPrice
//   );

//   console.log("=== IMMEDIATELY AFTER UPDATE ===");
//   console.log({
//     text: textNode.textContent,
//     outerHTML: el.outerHTML,
//   });

//   setTimeout(() => {
//     console.log("=== 1 SECOND LATER ===");
//     console.log({
//       text: textNode.textContent,
//       outerHTML: el.outerHTML,
//     });
//   }, 1000);

//   el.dataset.polished = "true";
//   return;
// }
if (priceSource === "Applied") {
  const formattedPrice = Number(priceValue).toFixed(2);

  

  textNode.textContent = originalText.replace(
    /[\d,.]+/,
    formattedPrice
  );

log("Applied Price", {
    old: originalText,
    new: formattedPrice,
    variant: rawId,
});



  el.dataset.polished = "true";
  return;
}
      // --- APPLY LOGIC FOR "DEFAULT" SOURCE ---

      const newPrice = calculatePrice(priceValue);
      const newText = originalText.replace(/[\d,.]+/, newPrice);

      if (originalText !== newText) {
        textNode.textContent = newText;
        const observer = new MutationObserver((mutations) => {

    log("Mutation observed:", mutations.length);

    if (!CONFIG || !observerActive)
        return;

    lastMutationTime = Date.now();

    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {

        log("Mutation debounce expired → updatePrices()");

        updatePrices();

    },300);
});
        el.dataset.polished = "true";
        updatedCount++;
      }
    });
    
    if (observerActive) {
      log("Observer CONNECTED");
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    return updatedCount > 0;
  }

  const observer = new MutationObserver((mutations) => {
    if (!CONFIG || !observerActive) return;
    
    lastMutationTime = Date.now();
    
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updatePrices();
    }, 300);
  });

  // Performance Guard: Stop observer after page is stable
  const stabilityCheck = setInterval(() => {
    if (Date.now() - lastMutationTime > STABILITY_THRESHOLD) {
      log("Observer DISCONNECTED after page stable");
      observer.disconnect();
      observerActive = false;
      clearInterval(stabilityCheck);
    }
  }, 1000);

async function init() {
    log("INIT START");

    if (!CONFIG)
        await fetchConfig();

    log("Calling updatePrices() from init");

    updatePrices();

    lastMutationTime = Date.now();

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
        updatePrices();
    });
});

document.addEventListener("readystatechange", () => {
    log("READY STATE =", document.readyState);
});

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runInit, { once: true });
  } else {
    runInit();
  }
})();
