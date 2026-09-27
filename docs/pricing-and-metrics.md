# Launch Copy & Metrics — 2026-09-26

Aligned with `app/config/billing.ts` (source of truth) and the enforcement
decision in `docs/billing-enforcement-plan.md`.

## Model (capacity-only gating)

Basic is a **capacity upgrade**, not a feature unlock. Every core feature —
pricing rules, preview, apply, scheduling, revert, campaign history, impact
report — is available on both tiers. Only limits differ. Nothing is advertised
as tier-exclusive.

## Pricing page copy (launch-ready)

### Free — $0

- Up to 50 products per campaign
- 2 campaigns per month
- Full feature set: rules, preview, apply, scheduling, revert, campaign history
- 14-day price history
- Email support

### Basic — $9.99/month

- Up to 1,000 products per campaign
- Unlimited campaigns
- Same full feature set as Free, at higher capacity
- Full campaign history
- Excel/CSV export
- 14-day free trial

**Removed from external copy (do not re-add until built):**

- ~~Drift detection~~ — no merchant-facing feature exists. Internal price-drift
  safety checks exist only in the revert path (`app/utils/revert.server.ts`) and
  are not a marketable feature.
- ~~"Variant changes per month" limit~~ — no such limit exists in
  `app/config/billing.ts` or anywhere in enforcement code.
- ~~"Full campaign history" / "Excel/CSV export" as Basic-exclusive~~ — both are
  ungated today (`app/routes/api.campaign-history.ts`,
  `app/routes/api.export-impact.ts` have no plan check). They may stay on the
  Basic card only as a restatement, never as a differentiator.

**Confirmed copy corrections shipped:**

- Free campaign count: Billing UI said "1 campaign per month"
  (`app.billing.tsx:380`); config says 2 (`app/config/billing.ts:9`).
  Config is correct — UI updated to **2**.
- Trial length: two surfaces said "7-day trial"; config and Shopify billing
  define **14 days** (`app/shopify.server.ts:60`). Updated
  `app/routes/app.tsx` and the `billingUpsell.title` locale string.
- Tier name: **Basic** everywhere (code, UI, copy). No "Growth", "Starter",
  or "Pro" naming exists or is introduced.

**Deferred:** "Growth" tier — postponed until Basic conversion/retention data
justifies it (unchanged from prior recommendation).

## Launch metrics

### Activation & retention

1. **First-campaign activation** — % of installs completing one campaign within 7 days.
2. **Retention — campaigns per active merchant per month** (rolling median); flag a declining trend even if activation rises.
3. **Week-4 return rate** — % of activated merchants with ≥1 campaign in week 4 after first campaign.

### Conversion & billing

4. Free → Basic conversion rate (installs → paid, 30-day window).
5. Trial → paid conversion on the 14-day Basic trial.
6. Basic churn rate (monthly).

### Product health

7. Publish success rate (staged → live, per operation).
8. **Storefront price-drift detection** — count/rate of auto-flagged mismatches
   between admin-intended price and actual rendered storefront price. Directly
   tied to the rendering-bug class investigated in
   `tests/price-polish.md`; target ≈ 0 unexpected drifts.
9. **Rollback usage** — reverts initiated deliberately by merchants. Healthy
   and expected; NOT a target-zero metric.
10. **Defect-caused rollbacks** — reverts forced by an app failure (partial
    publish, wrong price, drift). **This is the target-zero metric.**
    (Replaces the old single "rollback incidents" number.)
11. Scheduled-campaign execution accuracy (ran within tolerance of `runAt`).
12. Support ticket rate per active merchant, by category.

### Instrumentation note

Metrics 1–3, 8–10 need event instrumentation before launch: campaign-created,
campaign-published (with per-variant drift flags), revert-initiated (with
cause: `merchant` vs `defect`), and merchant-active-ping.
