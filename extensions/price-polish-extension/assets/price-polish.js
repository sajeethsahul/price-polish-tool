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
  ];

  async function fetchConfig() {
    try {
      const response = await fetch("/apps/price-polish/settings");
      if (!response.ok) throw new Error("Failed to fetch config");
      const settings = await response.json();
      CONFIG = settings;
      console.log("Price Polish: Config loaded", CONFIG);
      return true;
    } catch (error) {
      console.error("Price Polish: Error fetching config:", error);
      CONFIG = { markup: 10, charm: true, rounding: 1 };
      return false;
    }
  }

  function calculatePrice(price) {
    if (!CONFIG) return price;
    let newPrice = price * (1 + CONFIG.markup / 100);
    if (CONFIG.rounding > 0) {
      newPrice = Math.round(newPrice / CONFIG.rounding) * CONFIG.rounding;
    }
    if (CONFIG.charm) {
      newPrice = Math.floor(newPrice) + 0.99;
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

      const textNode = Array.from(el.childNodes).find(node => 
        node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent)
      );
      if (!textNode) return;

      const originalText = textNode.textContent.trim();
      const priceValue = parseFloat(originalText.replace(/[^\d.]/g, ""));
      if (isNaN(priceValue)) return;

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
