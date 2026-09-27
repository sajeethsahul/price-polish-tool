# Billing Enforcement — Beta Decision Record

**Date:** 2026-09-26
**Status:** DECIDED — enforcement NOT required before public launch; accepted beta-period gap with a hard close-out date.

## Decision

Free-tier limits (`campaignsPerMonth: 2`, `productsPerCampaign: 50` in
`app/config/billing.ts`) are **unenforced during the beta window**. This is an
accepted, time-boxed gap — not an indefinite soft limit.

- **Target date to close the gap: 2026-11-01.** Enforcement must ship in all
  four routes listed below before this date, or the plans must be changed
  (e.g., temporarily ship Free as unlimited) so that marketing copy never
  advertises a limit that is not enforced.
- During beta, exceeding-limit usage is logged (`console.log("[BILLING] ...")`
  in each route) so real-world usage data informs the enforcement thresholds.

## Routes with deferred enforcement

| Route                                        | Limit                     | Line |
| -------------------------------------------- | ------------------------- | ---- |
| `app/routes/api.push-storefront.ts`          | `campaignsPerMonth: 2`    | 61   |
| `app/routes/api.schedule-pricing.ts`         | `campaignsPerMonth: 2`    | 68   |
| `app/routes/api.publish-lifecycle-action.ts` | `campaignsPerMonth: 2`    | 52   |
| `app/routes/api.bulk-price.ts`               | `productsPerCampaign: 50` | 65   |

All four carry a `TODO: enforce ... (target: 2026-11-01)` comment pointing here.

## Plan model (source of truth: `app/config/billing.ts`)

- **Free** — $0: 2 campaigns/month, 50 products/campaign, full feature set.
- **Basic** — $9.99/month, 14-day trial: unlimited campaigns,
  1,000 products/campaign, same full feature set.
- Basic is a **capacity upgrade only**. Scheduling, revert, campaign history,
  impact report export, rules, preview, apply are available on both tiers.
  No feature is tier-exclusive today.
- "Growth" tier: deferred until Basic conversion/retention data justifies it.
