# Selling-plan price regression

## Root cause (confirmed by test run)

`parseStorefrontPrice("Rs. 300.00")` returned **0.3** — the period in the currency
abbreviation "Rs." was treated as a decimal point (cleaned text became
".300.00" → 0.3). Multiplying 0.3 by any markup produced exactly the reported
fractional values (Rs. 0.20 / 0.32 / 0.89 style). The parser now strips any
leading non-digit prefix before separator detection. "Rs. 300.00" → 300.00.

### Generalization of the prefix fix (covered by tests)

The fix is prefix-agnostic: it strips any non-digit run before the first digit,
for any currency. Covered in `price-polish.browser.mjs` (fixture + assertions,
all passing):

| Rendered text | Parsed base | Expected polished (12.5% increase) |
|---|---|---|
| `Fr. 1.000,00` | 1000.00 (not 1.000) | `Fr. 1.125,00` |
| `kr. 1.000,00` | 1000.00 (not 1.000) | `kr. 1.125,00` |
| `Fr. 1.234.567,89` | 1234567.89 | `Fr. 1.388.888,88` |
| `1.000,00 €` (suffix symbol) | 1000.00 — unaffected; bug was prefix-specific | `1.125,00 €` |
| `1.000,00 EUR` (suffix code) | 1000.00 — unaffected | `1.125,00 EUR` |

The element-level money-text matcher was also broadened to accept 1–3 letter
abbreviations with an optional period as prefix or suffix (`Fr.`, `kr.`, `Rs.`,
`EUR`), otherwise `Fr.`/`kr.` elements would have been skipped rather than
mis-parsed.

**Out of scope — Swiss apostrophe grouping (`1'000.00` / `1'000,00`):**
explicitly NOT supported. `parseStorefrontPrice` happens to parse it correctly
(the apostrophe is stripped as a non-numeric character, giving 1000.00), but
`formatPriceLikeOriginal`'s numeric-token regex stops at the apostrophe, so the
text replacement would corrupt the rendered string. Do not enable the polish on
a store whose money format uses apostrophe grouping until that is handled; the
regression suite does not cover it.

Run (CMD):

```
node C:/Users/Admin/.codegpt/skills/browser-automation/browser.mjs about:blank --script ./tests/price-polish.browser.mjs
npx eslint extensions/price-polish-extension/assets/price-polish.js tests/price-polish.browser.mjs
```

Both currently pass (all five scenarios plus stale-state/locale/opt-out checks).
`yarn` is not on PATH in this environment; eslint is run via npx. Note:
`npx tsc --noEmit` fails on pre-existing errors in `app/routes/app.preview.tsx`
(a file untouched by this change).

The test takes at least 31 seconds to cover late subscription changes. Its fixture uses a 12.5% increase, no ending, standard rounding: 300 -> 337.50, 286.22 -> 322.00, 290 -> 326.25. These are synthetic expectations, not values retrieved from the merchant's admin. The five categories are collection card, product one-time, subscription, prepaid, and a second product one-time/preorder.

## Price-format mirroring (decimal presence)

`formatPriceLikeOriginal` replaces ONLY the numeric token inside the original
text — the currency form (₹ symbol vs `Rs.` abbreviation), its position, and
spacing are inherently preserved because they are never rewritten. If a polished
price shows `Rs. 20.00` next to untouched `₹113` items, the original node
already rendered `Rs. 20.00`: the script cannot introduce an abbreviation that
was not in the node. Check the node's original text (console snippet below).

However, decimal PRESENCE follows the REVERSED rule (do NOT reintroduce the
old "mirror the original element's decimal count" behavior): the polished
output always shows the standard decimal count of the shop's ACTIVE currency
(`window.Shopify.currency.active` → zero-decimal list in
`app/utils/format.ts`), regardless of the original theme text and regardless
of whether the computed result is whole. The theme strips trailing zeros
(`₹45`, `₹130`), so mirroring the element permanently hid `.00` and real
cents. The rule in `formatPriceLikeOriginal`:

- 2-decimal currency (INR, USD, EUR, GBP, …) → always 2 decimals:
  `₹40 → ₹45.00` (not `₹45`), `₹130 → ₹129.49`.
- Zero-decimal currency (JPY, KRW, …) → never decimals: `¥2000 → ¥2200`
  (never `¥2200.00`).
- No currency info available → fallback to standard 2 decimals.
- The original token still decides the SEPARATOR style (`,` vs `.`,
  grouping separators, prefix/suffix) — only the decimal COUNT changed.

Regression cases (passing):

| Original | Calculated (12.5%) | Polished | Why |
| --- | --- | --- | --- |
| `₹20` | 22.50 (fractional) | `₹22.50` | cents kept, NOT rounded away to `₹23` |
| `Rs. 20` | 22.50 (fractional) | `Rs. 22.50` | same, abbreviation form |
| `₹40` | 45.00 (whole) | `₹45.00` | whole result still shows currency decimals (reversed rule) |
| `₹80` | 90.00 (whole) | `₹90.00` | exact whole result gains `.00` |
| `₹130` | 146.25 (fractional) | `₹146.25` | whole original + fractional result keeps cents (Snowboard shape) |
| `Rs. 40.00` | 45.00 (whole) | `Rs. 45.00` | decimal original → 2 decimals |
| `₹300.00` | 337.50 (fractional) | `₹337.50` | fractional → 2 decimals |
| `¥2000` (JPY active) | 2200 (whole) | `¥2200` | zero-decimal currency: never `.00` |

## Integration

The runtime only reads visible standalone money text in `.price-item`, `.price`, `.money`, `[itemprop="price"]`, `[data-price]`, `[data-product-price]`, or `[data-price-polish-price]`. Variant/product identifiers identify the source; they are not price selectors. No data attribute or JSON numeric payload is parsed as money.

For a custom widget, put `data-price-polish-price` on the element containing only the rendered amount. Put `data-price-polish-skip` on an element or ancestor to exclude its subtree. Hidden/template, compare-at, savings, badge, discount, and percentage markup is excluded. Mixed text such as `Save 15% / Rs. 300.00` is left untouched; wrap the actual amount separately to opt it in. Ambiguous/split numeric markup is deliberately not guessed.

`appliedPrices` is not a plausibility range: it is an unlabelled list of applied prices in the shop's base currency, not a selected-plan localized price map.

## FOUC guard (theme re-formats our output)

Secondary theme scripts (Dawn's facet/variant/section re-renderers, selling-plan
widgets) can rewrite a polished node after our first pass, re-formatting it
through the theme's money filter — e.g. our `₹22.50` becomes `₹23` via
`amount_no_decimals`. Previously that rounded text was parsed as a FRESH base
and compounded (20 → 22.50 → 23 → 25.88), which also showed as a flash of the
correct decimals disappearing.

Now, on first polish the node's unpolished text is stored in
`data-original-price-text`, and the internal state records the last written
value. When an external write is detected:

- If the new text parses to our own last output rounded to the original's
  decimal style (e.g. 23 ≈ round(22.50) for a whole-number original), it is
  treated as a theme re-format of OUR output: the base is unchanged and full
  precision is restored from `data-original-price-text` (₹23 → ₹22.50 again).
- Otherwise it is a genuine new base (variant/plan change) and recalculation
  starts from the new Shopify-rendered value.

Consequence: a same-value external write (e.g. theme re-writes our exact output
"Rs. 322.00") is also treated as a re-format, not a new base — the base stays
anchored and no compounding occurs. Genuine plan/variant switches produce
different values and still re-anchor correctly.

Regression cases (passing):

| Scenario | Expected |
| --- | --- |
| Our `₹22.50` overwritten by theme as `₹23` | Restored to `₹22.50`; base stays 20 (no compounding) |
| Same-value rewrite of our `Rs. 322.00` | Stays `Rs. 322.00`; base stays 286.22 |
| Genuine new base `₹60` on a whole-number node | Recalculates to `₹67.50` |

`data-original-price-text` is set once (first polish) and never overwritten,
so it always holds the node's pre-polish Shopify-rendered text.

## FIX 9 — "Applied Price (Shopify-rendered, left untouched)" intercepting theme re-renders

Live-trace confirmed bug: an **Applied** variant (variant ID in `CONFIG.manualIds`)
whose price element was re-rendered by the theme — the TEXT NODE swapped inside
the SAME element (`hasState=true`, `nodeReplaced=true`, `storedOriginal="Rs. 285.50"`,
current text `₹285.5`) — was intercepted by the Applied branch and returned early
with `changed=false`. The branch's only guard was the variant-ID match; it never
checked polish state. The stripped text stayed on screen permanently.

Fix (`price-polish.js`, FIX 9):

- The leave-untouched exemption now applies ONLY to elements with **no prior
  polish state** (`hasPriorPolishState` = `state` present AND
  `data-original-price-text` recorded AND node/output mismatch).
- With prior state, the branch restores the recorded full-precision output
  **without recalculating** (calculatePrice would double-apply the markup on the
  already-final Shopify-rendered price), and only when the current text parses
  to that same output within rounding tolerance (`isStaleReformat` — mirrors the
  `isThemeReformat` comparison in the DEFAULT path).
- A genuinely NEW Shopify-rendered price for the applied variant is adopted
  fresh (current text becomes the new output/base, `data-original-price-text`
  is updated), so merchant re-applies in the admin still show through.

Regression cases (passing): applied variant, same-element text-node swap with a
trailing-zero-stripped echo of our output → restored to full precision, base
unchanged, no double markup; genuinely new applied price `₹400.00` → adopted
fresh (base 400), never clobbered by the restored output; stripped re-render of
that new value → restored identically.

## Test-harness world isolation (critical for currency tests)

In the browser-automation harness, `page.evaluate` runs in an **isolated world**:
globals set there (`window.Shopify = …`) are INVISIBLE to the main-world
extension script, and vice versa. The main suite's JPY zero-decimal case failed
for exactly this reason — the script saw no `window.Shopify` at all,
`storeCurrencyPrecision()` returned null, and the fallback 2 decimals produced
`¥2200.00`. Proof (mini repro): main-world `addScriptTag` injection makes the
pass read `JPY` and format `¥2200` correctly.

Rules for this suite: inject `window.Shopify` / switch
`window.Shopify.currency.active` ONLY via `page.addScriptTag({ content: … })`,
never via `page.evaluate`. To observe main-world values from the test, marshal
them through the DOM (e.g. `document.title`).

Also fixed while running: (e)'s `data-polish-base` assertion expected
`"39.50"`, but `polishBase` is `String(parseStorefrontPrice(…))` — always
`"39.5"`; only the DISPLAY text carries 2 decimals.

## FIX 9b — Applied variants rendered ALREADY-stripped by Shopify

Live trace follow-up: on the affected storefront the applied variants' first-ever
rendering was already trailing-zero-stripped by Shopify's own money filter
(`storedOriginal="₹412.5"`, displayed `₹214.5`, base 214.5). FIX 9's
leave-untouched exemption then preserved that stripped rendering permanently —
the exemption correctly protected the VALUE (no markup re-application) but also
preserved the theme's zero-stripped FORMAT, violating the reversed rule that a
2-decimal currency always shows 2 decimals.

Fix: in the leave-untouched branch, the SAME parsed value is reformatted via
`formatPriceLikeOriginal(originalText, basePrice)` — currency-precision display
with NO recalculation (`applied-refmt` trace, `value-unchanged`). Steady state
stays idempotent (formatted output === snapshot output on later passes).

Regression cases (passing): first-seen stripped applied price `₹225.5` →
`₹225.50` (value unchanged, base 225.5, no markup); later whole-numbered
re-render `₹225` → `₹225.00` (base 225, still value-unchanged).

## Live confirmation still required

On the affected storefront, before deploying, capture the old selector matches with this console snippet. It reproduces the old extraction without changing any DOM:

```javascript
const oldSelectors =
  '.price-item, .price__regular .price-item, .price, [class*="price"], [data-product-price], [data-variant-id], [data-product-id]';
console.table(
  [...document.querySelectorAll(oldSelectors)].map((el) => ({
    outerHTML: el.outerHTML,
    processedLeaf: !el.querySelector(oldSelectors),
    originalText: [...el.childNodes].find(
      (n) => n.nodeType === Node.TEXT_NODE && /\d/.test(n.textContent),
    )?.textContent,
    polished: el.dataset.polished,
    base: el.dataset.polishBase,
    visible: el.getClientRects().length > 0,
  })),
);
```

Repeat after One-time -> Subscription -> Prepaid -> One-time, and after One-time -> Preorder on the second product. Check whether the same element/text node is reused and compare captured base/output against the selected plan's rendered amount. After deploying, compare the collection and each selected-plan price with the actual admin preview (or plan-adjusted equivalent), including after 30 seconds idle. Do not infer a scaling bug or a particular badge as the source without this evidence.
