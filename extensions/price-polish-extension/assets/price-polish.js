(() => {
  console.log("Price Polish Loaded");

  let CONFIG = null;
  let debounceTimer = null;
  let lastMutationTime = Date.now();
  let observerActive = true;
  const STABILITY_THRESHOLD = 5000; // 5 seconds of no changes to stop observer
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
      const response = await fetch(`/apps/price-polish/settings?t=${timestamp}`, { cache: "no-store" });
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
      console.log("Price Polish: Config loaded", CONFIG);
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
    if (!CONFIG) return false;

    const elements = document.querySelectorAll(SELECTORS.join(", "));
    if (elements.length === 0) return false;

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
      if (priceSource === 'Applied') {
        el.dataset.polished = "true";
        return; // Prevents "flicker" and skips calculations completely
      }

      // --- APPLY LOGIC FOR "DEFAULT" SOURCE ---

      const newPrice = calculatePrice(priceValue);
      const newText = originalText.replace(/[\d,.]+/, newPrice);

      if (originalText !== newText) {
        textNode.textContent = newText;
        el.dataset.polished = "true";
        updatedCount++;
      }
    });
    
    if (observerActive) {
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
      console.log("Price Polish: Page stable, disconnecting observer.");
      observer.disconnect();
      observerActive = false;
      clearInterval(stabilityCheck);
    }
  }, 1000);

  async function init() {
    if (!CONFIG) await fetchConfig();
    updatePrices();
    lastMutationTime = Date.now();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
