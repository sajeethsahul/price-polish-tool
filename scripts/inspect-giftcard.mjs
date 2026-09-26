// Inspect the live gift-card product page: what did Price Polish see and write?
export default async function run(page, ui) {
  // Wait for the script's late passes to settle.
  await page.waitForTimeout(6000);
  const result = await page.evaluate(() => {
    const priceEls = [...document.querySelectorAll('.price, .price-item, .money, [itemprop="price"], [data-price], [data-price-polish-price]')]
      .filter(el => !el.closest('template, script, style'));
    return {
      url: location.href,
      currencyGlobal: (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || null,
      elements: priceEls.slice(0, 20).map(el => ({
        cls: el.className,
        text: el.textContent.trim(),
        polished: el.dataset.polished || null,
        base: el.dataset.polishBase || null,
        orig: el.dataset.originalPriceText || null,
        variantId: el.dataset.variantId || null,
      })),
      giftCardForm: !!document.querySelector('form[action*="/cart/add"] input[name="id"]'),
      scripts: [...document.scripts].map(s => s.src).filter(s => s.includes('price-polish')),
    };
  });
  return result;
}
