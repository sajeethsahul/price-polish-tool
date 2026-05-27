# Variant Architecture Roadmap

## Purpose

Prepare Price Polish for future variant-aware pricing operations while preserving:
- operational simplicity
- scheduling safety
- revert integrity
- storefront ownership semantics
- backward compatibility

---

# Current State (9A)

The platform is currently:
- merchant-facing product-oriented
- internally variant-aware
- snapshot-compatible
- revert-compatible
- lifecycle-safe

Variant-aware groundwork exists in:
- pricing contracts
- scheduled snapshots
- worker execution paths
- revert preview logic
- pricing engine extensibility

---

# Architectural Principles

## 1. Backward Compatibility First

Existing:
- campaigns
- snapshots
- revert flows
- schedule history

must remain functional after future variant expansion.

Avoid destructive schema migrations.

---

## 2. Merchant Simplicity

Default merchant UX should remain:
- calm
- product-oriented
- operationally readable

Avoid exposing SKU complexity unless explicitly needed.

---

## 3. Variant Awareness Internally

Internal systems should safely support:
- variantId
- variantTitle
- SKU
- compareAtPrice
- variant-specific pricing
- variant-level revert safety

without forcing immediate UI complexity.

---

## 4. Lifecycle Safety

Variant evolution must NOT break:
- Time Window lifecycle
- ownership semantics
- scheduling execution
- revert orchestration
- storefront recovery

Operational trust is higher priority than feature velocity.

---

# Current Variant-Aware Contracts

## ScheduledProductSnapshot

Supports:
- productId
- variantId
- variantTitle
- SKU
- original prices
- scheduled prices
- storefront prices

Used by:
- schedule creation
- worker execution
- revert preview
- staging flows

---

## PricingEngineInput

Future-ready pricing engine contract supporting:
- basePrice
- variant context
- compare-at context
- inventory context (future)
- margin simulation (future)

Current calculations remain unchanged.

---

# Deferred Features (Not Yet Implemented)

## 9B — Variant-Aware Preview Expansion
Potential future support:
- multiple variants per product
- SKU preview visibility
- variant image support

---

## 9C — Variant Targeting
Potential future support:
- size/color filtering
- partial variant selection
- vendor/category targeting

---

## 9D — Variant Scheduling
Potential future support:
- variant-only schedules
- mixed product/variant operations
- SKU-level campaigns

---

## 9E — Advanced Ecommerce Intelligence
Potential future support:
- inventory-aware pricing
- compare-at simulations
- margin analysis
- profitability preview
- vendor/category analytics

---

# Important Constraints

## Avoid Premature Complexity

Do NOT introduce:
- complex variant matrices
- enterprise pricing dashboards
- excessive analytics UX
- schema explosion

until operational demand exists.

---

# Operational Philosophy

Price Polish should feel:
- operationally safe
- calm
- merchant-readable
- Shopify-native

NOT:
- finance terminal
- enterprise ERP
- trading dashboard

---

# Validation Requirements For Future Variant Work

All future variant phases must preserve:
- existing campaigns
- revert accuracy
- schedule integrity
- worker stability
- storefront ownership safety
- preview performance

Backward compatibility is mandatory.