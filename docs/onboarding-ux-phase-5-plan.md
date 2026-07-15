# Phase 5 — Global Design Reconciliation

Status: Planning only. No code changes until this plan is approved.

## Objective

Bring every user-facing surface into visual and interaction consistency
with Shopify Polaris. Not a redesign. Not creative direction. Not new
UX. Just remove non-Polaris styling, standardise components, and close
accessibility gaps identified in the global audit.

## Constraints

- Do not introduce gradients, glassmorphism, or a custom design system.
- Do not modify workflows, navigation, onboarding logic, pricing,
  backend APIs, GraphQL, App Proxy, or database.
- Do not restructure state management or split large files.
- Every change is presentation-only and must be reversible per patch.
- Follow Polaris v13.x already in `package.json` — no upgrade.

## Priority framework

- P0 — Ships blocker. Directly breaks the "native Shopify" perception
  or fails accessibility. Address in the first sub-phase.
- P1 — Obvious visual inconsistency; noticeable in daily merchant use.
- P2 — Subtle polish; discoverable during QA or accessibility audits.

Each finding lists: current issue, proposed improvement, files affected,
estimated effort (S/M/L), regression risk (Low/Medium/High), and merchant
benefit.

---

## P0 — Critical

### P0-1 — Dashboard injects a `<style>` block that overrides Polaris tokens

- **Current issue**: `app/routes/app._index.tsx:2361-2402` renders an
  inline `<style>` element defining 8 custom CSS variables
  (`--pp-primary: #008060`, `--pp-success: #16a34a`, `--pp-danger:
  #dc2626`, `--pp-warning: #f59e0b`, plus text / bg / card / border
  colors) and rewriting `.Polaris-Card`, `.Polaris-Text--headingLg`,
  `.Polaris-Button--variantPrimary` with `!important`. It also defines
  a `.pp-live-dot` class with a custom pulse animation using literal
  hex.
- **Proposed improvement**: Delete the entire `<style>` block. Polaris
  provides these tokens via `--p-color-*` variables that already
  respect the merchant's theme (light/dark, Shopify Admin refresh
  color). For the live indicator, replace `<span
  className="pp-live-dot pp-live-dot--active">` with Polaris
  `<Badge tone="success">Live</Badge>` (or `<Badge>Not live</Badge>`),
  which is a11y-labelled by default. Remove the custom pulse; a badge
  is sufficient and doesn't compete for attention.
- **Files affected**: `app/routes/app._index.tsx` (style block +
  one usage at line 2667). Estimated total delta: ~50 removed lines,
  ~5 added.
- **Effort**: Small.
- **Regression risk**: Low. Cards may look marginally different (no
  overridden border), but Polaris' native surface is the whole point.
  No behaviour changes.
- **Merchant benefit**: The Dashboard finally looks like Shopify
  Admin. Cards, buttons, and text inherit the merchant's admin theme
  (light or dark). Accessibility passes color-contrast because
  Polaris tokens are already WCAG AA.

### P0-2 — Dashboard wraps `<Page>` in a full-height div with `#f9fafb`

- **Current issue**: `app/routes/app._index.tsx:2360` — `<div
  style={{ backgroundColor: "#f9fafb", minHeight: "100vh" }}>` wraps
  the Polaris `<Page>`. Overrides admin frame chrome and breaks
  embedded scroll semantics on tablet viewports (the iframe already
  has its own scroll container).
- **Proposed improvement**: Delete the wrapping div and its matching
  closing tag. Render `<Page fullWidth>` at the top level.
- **Files affected**: `app/routes/app._index.tsx` (one wrapping div,
  one closing tag).
- **Effort**: Small.
- **Regression risk**: Low. The `maxWidth: 1200` inner div can stay;
  only the outer background/height wrapper is removed.
- **Merchant benefit**: Consistent scroll behaviour across embedded
  Admin. No visual "off-brand grey band" bleeding through when the
  admin theme changes.

### P0-3 — `PricePolishLoader` uses an indigo gradient bar

- **Current issue**: `app/components/PricePolishLoader.tsx:203, 250`
  renders `linear-gradient(90deg, #4f46e5, #7c3aed, #2563eb)` for the
  progress bar and a shimmering
  `linear-gradient(90deg, #e5e7eb 25%, #a5b4fc 50%, #818cf8 60%,
  #e5e7eb 80%)` overlay. Colors are Tailwind Indigo, not Polaris. The
  component is imported by Dashboard and Campaign History as the
  primary loading treatment. Every load feels off-brand.
- **Proposed improvement**: Rewrite the component body while preserving
  its exported props (`title`, `subtitle`). Internals become:
  - `<SkeletonPage title={title}>` for full-page loaders.
  - `<ProgressBar tone="primary" progress={progress}>` from Polaris,
    if a progress value is available.
  - `<Spinner size="large" accessibilityLabel={title}>` if progress is
    indeterminate.
  Delete every hex color and every gradient. `PRICE_POLISH_LOADER_COPY`
  is unchanged.
- **Files affected**: `app/components/PricePolishLoader.tsx`.
  Consumers (`app._index.tsx`, `app.campaign-history.tsx`) require no
  changes if we keep the props API stable.
- **Effort**: Medium. Roughly a full rewrite of the component (~250
  lines → ~80 lines).
- **Regression risk**: Low. Contract is preserved. Any consumer that
  depended on internal styling doesn't exist — the component is a
  black box.
- **Merchant benefit**: Loading states feel native to Shopify. The
  three-color indigo animation was the single most jarring visual
  moment in the app for merchants coming from other Shopify apps.

### P0-4 — Rules page double-wraps `<Card>` in `<div>` with border + gradient

- **Current issue**: `app/routes/app.rules.tsx:357` wraps the form
  Card in `<div style={{ border: "1px solid #e5e7eb", borderRadius:
  "12px", marginTop: "16px" }}>`, and `app/routes/app.rules.tsx:503`
  wraps the preview sidebar Card in `<div style={{ background:
  "linear-gradient(135deg, #f9fafb, #f1f5f9)", border: "1px solid
  #e5e7eb", borderRadius: "12px" }}>`. Polaris Card already renders
  its own surface, border, and radius via tokens — this creates a
  double-border effect on light themes and a broken surface on dark
  theme.
- **Proposed improvement**: Delete both wrapping `<div>`s and their
  closing tags. Card content, form action, and preview logic remain
  identical.
- **Files affected**: `app/routes/app.rules.tsx` (two removals).
- **Effort**: Small.
- **Regression risk**: Very Low. Presentation only; the entire form
  submission path is untouched.
- **Merchant benefit**: Rules page reads as one native Polaris card
  stack, not two custom-styled panels. Adapts correctly to admin
  dark theme.

### P0-5 — Dashboard "Live" status conveys meaning by color alone

- **Current issue**: `app/routes/app._index.tsx:2667` renders a small
  `<span className="pp-live-dot pp-live-dot--active">` (green pulse)
  or `--inactive` (red static). No visible text, no `aria-label`, no
  `role`. A merchant with red-green color blindness or a screen
  reader user cannot tell whether their storefront is live.
- **Proposed improvement**: Convert to `<Badge tone="success">Live</Badge>`
  when `metrics.isLive === true`, and `<Badge>Not live</Badge>` when
  false. Badges include native accessible labels. This also resolves
  P0-1's need to keep `.pp-live-dot` CSS.
- **Files affected**: `app/routes/app._index.tsx`.
- **Effort**: Small.
- **Regression risk**: Very Low.
- **Merchant benefit**: WCAG 1.4.1 compliance. Screen readers announce
  status. Color-blind merchants see the label.

---

## P1 — High

### P1-1 — Loading states are inconsistent within the same page

- **Current issue**: `app/routes/app.campaign-history.tsx` uses
  `<Spinner size="large">` at line 1253 for the initial load, then
  `<Spinner size="small">` at multiple sub-panel locations
  (1422, 1439, 1657, 2036). Elsewhere the same file could be using
  `PricePolishLoader`. `app._index.tsx` uses `PricePolishLoader` at
  the top level and `<Spinner>` for sub-fetches. Result: merchants see
  three different loading treatments during a single navigation.
- **Proposed improvement**: Establish a "loading playbook" and apply
  it consistently:
  - Full-page initial load → `<SkeletonPage>` + `<SkeletonBodyText>`.
  - In-card / in-panel data refresh → skeleton lines matching the
    final layout (as Preview page shows post-Phase 3).
  - In-button loading state → `loading` prop on Polaris `<Button>`.
  - Small in-line indicators (row-level updates) → `<Spinner
    size="small">` inline.
  Delete or repurpose `PricePolishLoader` per P0-3.
- **Files affected**: `app/routes/app.campaign-history.tsx`,
  `app/routes/app._index.tsx`.
- **Effort**: Medium. Roughly 8 replacements in campaign-history and
  4 in dashboard. No logic change.
- **Regression risk**: Low. Visual only.
- **Merchant benefit**: Loading is predictable. Merchants stop
  wondering "is it broken or loading in a new way?".

### P1-2 — Empty states use ad-hoc `<Text>` blocks instead of `<EmptyState>`

- **Current issue**: `app/routes/app.campaign-history.tsx:1349`
  shows `{campaignHistoryEmptyStateMessage}` as inline text with no
  recovery action. Dashboard has similar inline-text empty branches.
  Preview (Phase 3) is the only surface using Polaris `<EmptyState>`.
- **Proposed improvement**: Every empty branch renders `<EmptyState
  heading="..." image="" action={{content: "...", onAction: ...}}>
  <p>Description.</p></EmptyState>`. Copy stays merchant-friendly and
  every empty state gives a way forward.
- **Files affected**: `app/routes/app.campaign-history.tsx` (1 empty
  state), `app/routes/app._index.tsx` (approximately 2–3 branches in
  the campaign timeline and preview sections), `app/routes/app.bulk.tsx`
  (if applicable).
- **Effort**: Medium. ~5 empty states to convert.
- **Regression risk**: Very Low. Presentation only.
- **Merchant benefit**: Empty screens don't feel broken. Every empty
  state suggests the next action.

### P1-3 — Rules page has 8 duplicated `<div style={{ flex: ... }}>` wrappers

- **Current issue**: `app/routes/app.rules.tsx:363, 377, 391, 414, 434,
  456, 472` wraps each form field in `<div style={{ flex: "1 1 180px",
  minWidth: 160 }}>` (widths vary). This is CSS flex hand-tuned instead
  of Polaris `<Grid>` or the wrapping behavior of `<InlineStack wrap>`.
- **Proposed improvement**: Replace the block with a Polaris `<Grid
  columns={{ xs: 1, sm: 2, lg: 3 }} gap="200">` around the field group,
  or extract a small local component `<FieldColumn minWidth={number}>`
  to remove the duplication.
- **Files affected**: `app/routes/app.rules.tsx`.
- **Effort**: Small–Medium.
- **Regression risk**: Low. Layout only; TextField / Select behaviour
  unchanged.
- **Merchant benefit**: Rules form breathes at tablet widths;
  currently the hand-tuned min-width values can force horizontal
  overflow.

### P1-4 — Toast usage skews heavily to error messages

- **Current issue**: 34 `shopify.toast.show(...)` calls; 30 of them
  use `{ isError: true }`. Only 4 positive toasts across the app.
  Merchants only hear from the app when something goes wrong.
- **Proposed improvement**: Add success toasts (`toast.show(t("..."))`)
  on positive terminal actions where they are missing: pricing
  applied, campaign reverted, publish scheduled, settings saved, etc.
  Copy already exists in `utils/i18n.ts` in several places.
- **Files affected**: `app/routes/app._index.tsx`,
  `app/routes/app.campaign-history.tsx`, `app/routes/app.settings.tsx`.
- **Effort**: Small. About 6 add-toast sites.
- **Regression risk**: Very Low.
- **Merchant benefit**: Positive confirmation on success builds
  confidence. Merchants stop wondering "did it work?".

### P1-5 — Trial fallback page is bare

- **Current issue**: `app/routes/app.tsx:328-339` — when
  `!hasActivePlan`, the fallback UI is a single Card with heading
  "Unlock Price Polish", one line of copy ("Start your 7-day free
  trial."), and a primary button. Contrast with the polished wizard
  the merchant might have just come from is stark.
- **Proposed improvement**: Replace the Card with a Polaris
  `<CalloutCard illustration="" title="Unlock Price Polish"
  primaryAction={{ content: "Start Free Trial", onAction: ... }}>`
  wrapping a 3-item bullet `<List>` of benefits. No logic change to
  the redirect target.
- **Files affected**: `app/routes/app.tsx`.
- **Effort**: Small.
- **Regression risk**: Very Low.
- **Merchant benefit**: The plan-required screen feels like a value
  proposition, not a paywall.

### P1-6 — `variant="tertiary"` used inconsistently across the app

- **Current issue**: Removed from onboarding wizard in Phase 1, but
  still appears in Dashboard buttons and some Campaign History
  actions. Polaris `tertiary` renders as flat text — appropriate
  only for de-emphasised inline actions, not for skip / secondary
  CTAs.
- **Proposed improvement**: Grep the codebase for `variant="tertiary"`.
  Each hit gets one of three treatments:
  - Genuinely de-emphasised inline action → keep.
  - Secondary form or wizard action → change to default variant.
  - Should never have been a button (icon-only decorative) → change
    to `<Button icon={} accessibilityLabel="">`.
- **Files affected**: `app/routes/app._index.tsx`, `app/routes/
  app.campaign-history.tsx`, potentially others.
- **Effort**: Small.
- **Regression risk**: Very Low.
- **Merchant benefit**: Consistent button hierarchy across the app;
  merchants develop reliable expectation of "what looks primary".

---

## P2 — Nice-to-have

### P2-1 — Page titles / subtitles convention

- **Current issue**: Dashboard title is "Price Polish Dashboard"
  (redundant app name). Only 3 of 10+ pages set a subtitle. Preview
  subtitle is "Currency: USD" (data, not context).
- **Proposed improvement**: Adopt house convention:
  - `title`: human noun (Dashboard, Pricing Rules, Preview, Billing).
  - `subtitle`: 1-line merchant-focused context, only where useful.
  Move Preview's currency string into the count row.
- **Files affected**: `app/routes/app._index.tsx`,
  `app/routes/app.preview.tsx`, `app/routes/app.billing.tsx`, etc.
- **Effort**: Small (~6 one-liners).
- **Regression risk**: Very Low.
- **Merchant benefit**: Page headers become predictable and less
  chatty.

### P2-2 — `<BlockStack gap>` and card composition tokens

- **Current issue**: Gap values are inconsistent across pages —
  wizard was normalised in Phase 4, but Dashboard, Campaign History,
  Rules, Billing mix `150 / 200 / 300 / 400` without a rule.
- **Proposed improvement**: Adopt: `gap="200"` inside cards for
  content, `gap="300"` for card-in-card composites, `gap="400"` for
  top-level page sections. Reserve `gap="150"` for tight metadata
  rows. Apply mechanically per file.
- **Files affected**: All page routes.
- **Effort**: Small–Medium.
- **Regression risk**: Very Low.

### P2-3 — Icon + heading alignment helper

- **Current issue**: `<InlineStack blockAlign="center">` with Icon
  (20 px) + `Text variant="headingMd"` (~18 px) is slightly off. Same
  motif appears across at least 8 places.
- **Proposed improvement**: Extract `<SectionHeader icon title
  tone />` helper into `app/components/SectionHeader.tsx`. Use in
  wizard, rules preview, campaign detail, billing.
- **Effort**: Small.
- **Regression risk**: Very Low.

### P2-4 — Table column-width constants

- **Current issue**: `app._index.tsx:56-57` defines
  `CAMPAIGN_DETAIL_COMPARISON_GRID` and `REVERT_PREVIEW_COMPARISON_GRID`
  as inline string literals. Same values likely appear elsewhere.
- **Proposed improvement**: Extract to `app/constants/tables.ts`.
- **Effort**: Very Small.
- **Regression risk**: Zero.

### P2-5 — `BillingBlockModal` is a custom modal

- **Current issue**: `app/components/BillingBlockModal.tsx` renders a
  bespoke modal shell instead of Polaris `<Modal>`.
- **Proposed improvement**: Convert to `<Modal open title primaryAction
  secondaryActions><Modal.Section><Banner tone="warning">...</Banner>
  </Modal.Section></Modal>`. Preserve messaging and props.
- **Effort**: Small.
- **Regression risk**: Low.

### P2-6 — Heavy card-based lists should virtualise

- **Current issue**: Preview (Phase 3 opt-in "View Full") and Campaign
  History render each row as a nested `<Card>`. Fine for 30 items;
  costly for 2,000. Not P0/P1 because opt-in scope is small, but
  documented for future work.
- **Proposed improvement**: Migrate to Polaris `<IndexTable>` for
  virtualisation and native table density.
- **Effort**: Medium–Large per surface. **Deferred** — not in Phase 5
  scope. Recommended as a separate Phase 7 or 8.
- **Regression risk**: Medium.

---

## Recommended sequencing

Break Phase 5 into three sub-phases so each is independently
reviewable and revertable.

**Sub-phase 5A — Dashboard reconciliation (P0 items on Dashboard)**
- P0-1 (delete `<style>` block)
- P0-2 (delete full-page wrapper div)
- P0-5 (live-dot → Badge)

Single file (`app._index.tsx`). Highest visual impact per line
changed.

**Sub-phase 5B — Component & page-level reconciliation (remaining P0 + high-impact P1)**
- P0-3 (`PricePolishLoader` rewrite)
- P0-4 (Rules page div wrappers)
- P1-1 (loading playbook applied)
- P1-2 (EmptyState conversion)
- P1-3 (Rules field grid)
- P1-5 (Trial fallback CalloutCard)

Multiple files. Larger delta, still presentation-only.

**Sub-phase 5C — Global consistency sweep (P1 tail + P2)**
- P1-4 (success toasts)
- P1-6 (`variant="tertiary"` audit)
- P2-1 (title / subtitle convention)
- P2-2 (`gap` tokens)
- P2-3 (`SectionHeader` helper)
- P2-4 (table constants)
- P2-5 (BillingBlockModal → Polaris Modal)

Broad but tiny per-site changes.

**Deferred (not Phase 5):**
- P2-6 (IndexTable migration) — becomes Phase 7.

## Regression testing strategy

For each sub-phase:
1. `npx tsc --noEmit` on modified files — zero new errors.
2. `npx eslint` on modified files — zero new warnings on files we
   touch (pre-existing warnings in unrelated files remain).
3. Manual QA checklist per sub-phase:
   - Dashboard: load, click retry, open campaign detail, revert,
     schedule, verify live indicator reflects backend state.
   - Rules: load with existing rule, save, verify preview panel
     updates, verify safeguards.
   - Campaign History: load with 0 / 1 / 20 campaigns, expand a
     campaign, revert.
   - Billing: reach the plan-required page, click Start Trial.
   - Onboarding (regression from Phases 1–4): fresh install, revisit,
     step deep-links.
4. Screenshot diff: for each sub-phase, capture Dashboard, Rules,
   Campaign History, Preview at 375 / 768 / 1440 px viewport, both
   light and dark admin theme, before and after.

## Files that will be modified (total)

- `app/routes/app._index.tsx` — Dashboard.
- `app/routes/app.rules.tsx` — Rules form and preview.
- `app/routes/app.campaign-history.tsx` — Loading / empty / lists.
- `app/routes/app.tsx` — Trial fallback.
- `app/routes/app.billing.tsx` — Title/subtitle only.
- `app/routes/app.preview.tsx` — Subtitle relocation (P2-1).
- `app/routes/app.bulk.tsx`, `app.settings.tsx`, `app.help.tsx` —
  Title convention only.
- `app/components/PricePolishLoader.tsx` — Rewrite.
- `app/components/BillingBlockModal.tsx` — Convert to Polaris Modal.
- `app/components/SectionHeader.tsx` — New helper (P2-3).
- `app/constants/tables.ts` — New constants file (P2-4).

Estimated total: ~9 existing files modified, 2 new files added.

## Files that will NOT be modified

- Any backend / API / server file.
- `app/utils/pricing.ts`, `app/utils/window-lifecycle.ts`, all
  `.server.ts` files.
- `prisma/schema.prisma`.
- `app/shopify.server.ts`.
- Extensions folder.
- Any onboarding logic (Phases 1–4 are frozen).

## Deliverables per sub-phase

Each sub-phase, on completion:
- Files changed (with line counts).
- Full patch under `docs/onboarding-ux-phase-5{A|B|C}.patch`.
- Updated Decision Log entry.
- Risk assessment.
- Manual QA checklist tailored to the sub-phase.
- Rollback instructions (single-command `git apply -R`).

## What Phase 5 is NOT

- Not a redesign.
- Not new interactions.
- Not new components except the two small helpers (`SectionHeader`,
  `constants/tables.ts`) that reduce duplication.
- Not a refactor of large monoliths (Dashboard file splitting is
  a future consideration, not scoped here).

---

## Awaiting approval

Please review this plan and reply with one of:

- **"Approve Phase 5 as planned. Start with sub-phase 5A."**
- **"Approve with adjustments: [specific items]"** — for example,
  swap or defer specific findings.
- **"Reject / rework the plan"** — with feedback on what to change.

No code will be modified until the plan is approved.
