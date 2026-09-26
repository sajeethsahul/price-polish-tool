// Diagnose WHY isVisiblePrice drops the PDP price on the snowboard page.
// Replicates each check in order and reports the first failing check + which ancestor.
export default async function run(page, ui) {
  // Wait past the 3s fail-open reveal so late passes are included.
  await page.waitForTimeout(6000);
  const result = await page.evaluate(() => {
    const EXCLUDED_SELECTOR =
      "[data-price-polish-skip], [hidden], [aria-hidden='true'], template, script, style, noscript, input, select, textarea, s, del";
    const EXCLUDED_CLASS =
      /compare|was[-_]?price|list[-_]?price|save|badge|discount|percent|visually[-_]?hidden|sr-only/i;

    const out = {
      url: location.href,
      htmlClass: document.documentElement.className,
      elements: [],
    };
    const targets = [...document.querySelectorAll(".price, .price-item")].slice(
      0,
      30,
    );
    for (const el of targets) {
      const rec = {
        cls: (el.getAttribute("class") || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 90),
        text: (el.textContent || "").trim().slice(0, 30),
        rects: el.getClientRects().length,
        fail: null,
      };
      // Check 1: closest(EXCLUDED_SELECTOR)
      const closestHit = el.closest(EXCLUDED_SELECTOR);
      if (closestHit) {
        rec.fail =
          "closest-match:" +
          (closestHit === el
            ? "self"
            : closestHit.tagName +
              "." +
              (closestHit.getAttribute("class") || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 60));
        out.elements.push(rec);
        continue;
      }
      // Check 2: per-ancestor class-token + computed style
      for (let parent = el; parent; parent = parent.parentElement) {
        const tokens = (parent.getAttribute("class") || "")
          .split(/\s+/)
          .filter(Boolean);
        const badToken = tokens.find(
          (t) => t && !t.startsWith("price") && EXCLUDED_CLASS.test(t),
        );
        if (badToken) {
          rec.fail =
            "class-token:" +
            badToken +
            " on " +
            parent.tagName +
            "." +
            tokens.join(" ").slice(0, 60);
          break;
        }
        const cs = getComputedStyle(parent);
        if (
          cs.display === "none" ||
          cs.visibility === "hidden" ||
          cs.visibility === "collapse" ||
          cs.opacity === "0"
        ) {
          rec.fail =
            "style:" +
            (cs.display === "none"
              ? "display=none"
              : cs.visibility !== "visible"
                ? "visibility=" + cs.visibility
                : "opacity=" + cs.opacity) +
            " on " +
            parent.tagName +
            "." +
            tokens.join(" ").slice(0, 60);
          break;
        }
      }
      if (!rec.fail && el.getClientRects().length === 0) rec.fail = "no-rects";
      out.elements.push(rec);
    }
    return out;
  });
  return result;
}
