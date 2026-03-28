(() => {
  console.log("Price Polish Loaded");

  let CONFIG = null;
  let debounceTimer = null;
  let lastMutationTime = Date.now();
  let observerActive = true;
  const STABILITY_THRESHOLD = 5000; // 5 seconds of no changes to stop observer

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
      // Add timestamp to bypass proxy caching issues
      const timestamp = new Date().getTime();
      const response = await fetch(`/apps/price-polish/settings?t=${timestamp}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to fetch config");
      const settings = await response.json();
      CONFIG = settings;
      console.log("Price Polish: Config loaded", CONFIG);
      return true;
    } catch (error) {
      console.error("Price Polish: Error fetching config:", error);
      CONFIG = { markup: 10, charm: true, rounding: 1, manualIds: [] };
      return false;
    }
  }

  function calculatePrice(price) {
    if (!CONFIG) return price;
    // If markup is 0 and no rounding/charm, don't change anything
    if (CONFIG.markup === 0 && CONFIG.rounding === 0 && !CONFIG.charm) return price.toFixed(2);
    
    let newPrice = price * (1 + CONFIG.markup / 100);
    
    if (CONFIG.charm) {
      newPrice = Math.floor(newPrice) + 0.99;
    } else if (CONFIG.rounding > 0) {
      newPrice = Math.floor(newPrice) + CONFIG.rounding;
    }
    return newPrice.toFixed(2);
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
