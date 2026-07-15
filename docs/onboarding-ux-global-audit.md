# Price Polish — Global Visual Consistency Audit

Audit scope: entire embedded Shopify Admin experience (all routes and
shared components), performed at the close of Phase 4 as a companion to
the onboarding UX pass.

Nothing in this document changes code. It is a prioritised, actionable
list of findings that can be scoped into follow-up phases (Phase 5
"Production Cleanup" onward). Each finding lists file:line evidence and
a recommended fix.

Severity legend

- P0 — breaks the "native Shopify" perception. Address before wider release.
- P1 — obvious inconsistency; noticeable to a design-literate reviewer.
- P2 — subtle inconsistency; discoverable during accessibility or QA.

---

## 1. Page titles and subtitles

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Only 3 of 10+ pages use `subtitle`.                      | P1       | `subtitle=` grep hits `_index.tsx`, `campaign-history.tsx`, `preview.tsx` only.
Dashboard title is "Price Polish Dashboard" — repeats app name that already appears in the NavMenu / top bar. | P1 | `app/routes/app._index.tsx:2404`
Preview subtitle is "Currency: USD" — treats the store's currency as a page-level identifier rather than an in-body detail. | P2 | `app/routes/app.preview.tsx:105`

Recommendation
- Adopt one convention: `<Page title="<Human noun>" subtitle="<Merchant task>">` for pages that benefit from context, and no subtitle otherwise. Never restate the app name in the title.
- Move "Currency: USD" from the Preview subtitle into the count row (e.g. `Showing 30 of 2,437 products · USD`).

## 2. Card spacing & hierarchy

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Multiple `<Card>` blocks are wrapped in raw `<div>`s with hardcoded borders and gradients, which breaks Polaris' native surface treatment. | P0 | `app/routes/app.rules.tsx:357` (`border: "1px solid #e5e7eb", borderRadius: "12px"`), line 503 (`background: "linear-gradient(135deg, #f9fafb, #f1f5f9)"`)
Dashboard uses a full-page hex background `#f9fafb` and `100vh` height, overriding the Polaris Page/Frame surface. | P0 | `app/routes/app._index.tsx:2360`
`BlockStack gap` values inside cards are inconsistent — mix of `150`, `200`, `300` across sibling cards for identical roles. | P2 | Multiple; Phase 4A already normalised the wizard.

Recommendation
- Remove the outer wrapper `<div>` treatments in `rules.tsx`; let Polaris `<Card>` handle the surface, border-radius, and border via design tokens.
- Remove the `#f9fafb` full-page background in Dashboard. Polaris already sets `--p-color-bg` correctly for embedded admin.
- Standardise `gap` inside Cards to `gap="200"` for content and `gap="300"` for card-in-card composites. Reserve `gap="150"` for tight metadata rows.

## 3. Colors & tokens

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Custom color palette defined via CSS variables that shadow Polaris tokens (`--pp-primary`, `--pp-success`, `--pp-danger`, `--pp-warning`) with hex values that do not match Polaris (`#008060`, `#16a34a`, `#dc2626`, `#f59e0b`). | P0 | `app/routes/app._index.tsx:2364-2371`
Hardcoded status colors on inline elements (`background-color: #16a34a`, `#dc2626`) instead of Polaris `<Badge tone>` / `<Text tone>`. | P0 | `app/routes/app._index.tsx:2395-2400`
`PricePolishLoader` uses a purple / indigo gradient `linear-gradient(90deg, #4f46e5, #7c3aed, #2563eb)` — off-brand for embedded Shopify Admin. | P1 | `app/components/PricePolishLoader.tsx:203, 250`

Recommendation
- Delete the `--pp-*` variables and their usages. Replace with Polaris CSS variables (`--p-color-bg-fill-success`, `--p-color-text-critical`, etc.) or, better, native `<Badge tone>` and `<Text tone>` components.
- Rebuild `PricePolishLoader` with Polaris `<Spinner>` + optional `<ProgressBar>`. Remove custom gradients.

## 4. Buttons — sizing, ordering, hierarchy

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Only `variant="tertiary"` buttons remained in the wizard (all removed in Phase 1) — but tertiary buttons still exist across the app, giving inconsistent hierarchy. | P1 | `grep 'variant="tertiary"' app/routes` returns hits on Dashboard, Rules right sidebar (recent changes chip), and other places.
Some CTAs specify `variant="primary"`; others (form submits, disabled advance buttons) rely on the default variant. This is fine for Polaris, but the row ordering (primary-left vs primary-right) is not consistent across wizard, forms, and modals. | P2 | Wizard uses primary-left + skip-right; Rules form uses solo primary; Modals vary.
Button `size` is left unspecified everywhere except a handful of hero CTAs. | P2 | grep `size="large"` shows sporadic usage.

Recommendation
- Adopt Polaris convention: primary button appears on the right for footers, form save rows, and modals; on the left for hero / CTA sections. Document this convention in a small `docs/ui-conventions.md`.
- Do not use `size="large"` — Shopify Admin renders it disproportionately in the embedded frame.
- Reserve `variant="tertiary"` for icon-only buttons or highly de-emphasised inline actions (deleting a row from a list). Never for wizard-step "Skip" — the default variant is correct there.

## 5. Badges — colors and usage

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Manual color-swatched badges in Dashboard status row (background-color hex, non-Polaris). | P0 | `app/routes/app._index.tsx:2395-2400`
`<Badge tone="attention">` and `<Badge tone="warning">` are used interchangeably. Polaris distinguishes them: `attention` is neutral emphasis; `warning` is elevated caution. | P1 | Dashboard "Attention Required" (`tone="critical"`) vs "Changes Ready" (`tone="attention"`) is correct; but `<Badge tone="warning">` shows up sporadically for similar semantics elsewhere.
`<Badge progress>` (used in Phase 1 StepIndicator) is otherwise absent — inconsistent with rest of Shopify Admin where progress badges are standard for status timelines. | P2 | Only `app/routes/app.welcome.tsx`.

Recommendation
- Replace hex-swatched badges in Dashboard with Polaris `<Badge>` tones.
- Audit each `<Badge>` for tone semantics: `success` (positive terminal), `attention` (needs merchant attention, non-critical), `warning` (potentially destructive on next action), `critical` (already failed / already destructive), `info` (informational only).
- Adopt `<Badge progress>` in Campaign History timelines and any other multi-step progress views.

## 6. Empty states

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Preview page has a Polaris `<EmptyState>` (added in Phase 3). Other pages that can be empty use bespoke `<BlockStack><Text>` blocks. | P1 | `app/routes/app.campaign-history.tsx` — empty campaign list is a plain `<Text>` block, not `<EmptyState>`. Same on Bulk Editor.
No page uses an illustration for empty state (all `image=""`). | P2 | Consistent absence; not wrong, but Shopify's own admin apps typically ship a small SVG.

Recommendation
- Convert every empty scenario to `<EmptyState>` with `heading`, one-sentence description, and a recovery `action`. Consistency matters more than the illustration.
- If you decide to add illustrations later, source them from a single asset directory (`/app/public/empty-states/*.svg`) so styles remain aligned.

## 7. Loading states

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Preview uses Polaris skeleton (added Phase 3). Dashboard uses `PricePolishLoader` (custom brand loader). Rules page uses `<Button loading>` on submit. Campaign History uses inline `<Spinner>`. | P1 | Grep for `SkeletonBodyText`, `Spinner`, `PricePolishLoader`.
Same page may show a skeleton, a spinner, and a brand loader depending on which sub-panel is loading. This creates a jarring "flicker of loading style" during navigation. | P1 | Observed on Dashboard `handlePreview` fetch.

Recommendation
- Adopt Polaris `<SkeletonPage>` / `<SkeletonBodyText>` for full-page loads and initial-render placeholders.
- Adopt Polaris `<Spinner>` (small) only for local, in-place actions (button loading state, modal action).
- Retire `PricePolishLoader` from user-facing surfaces (keep only if it's used for splash / lifecycle).

## 8. Toast / Banner tones

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Success toasts use `shopify.toast.show(text)` (no tone). Error toasts use `{ isError: true }`. Consistent — good. | ✓ | No action.
Banners use `tone="critical"` for errors, `tone="info"` for guidance, `tone="warning"` for billing block, `tone="success"` for confirmations. Consistent across app. | ✓ | No action.
Billing-block modal is a full custom modal instead of a Polaris `<Modal>` with a Banner inside. | P2 | `app/components/BillingBlockModal.tsx`.

Recommendation
- No changes to toast usage.
- Consider migrating `BillingBlockModal` to a Polaris `<Modal>` shell with an inner `<Banner tone="warning">` for the message. Preserves messaging but aligns visually.

## 9. Icons — alignment and sizing

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Icon sizing inside `<InlineStack blockAlign="center">` next to `<Text variant="headingMd">` is visually off because Polaris `<Icon>` renders at a fixed 20px while the heading is ~16-18px depending on breakpoint. | P2 | `app/routes/app.welcome.tsx` and other places using icon+headingMd.
Icons in Dashboard StoreHealthCard sometimes miss `tone`, defaulting to `subdued` on light backgrounds — hard to see. | P2 | `app/routes/app._index.tsx:432+`

Recommendation
- Use `<Icon tone="base">` explicitly to lift the color when placing icons next to headings.
- Consider wrapping icon + heading in a small helper component (`<SectionHeader icon={} title={} tone={} />`) to enforce alignment centrally.

## 10. Tables & data-density surfaces

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Campaign History and Preview lists render each row as a nested `<Card>`. Fine for a small sample; costly for a full expanded 2,000-item preview (Phase 3 opt-in). | P1 | `app/routes/app.preview.tsx`, `app/routes/app.campaign-history.tsx`.
Table headers in Campaign History (grid-based) use custom string widths (`minmax(0, 1fr) 132px 132px minmax(96px, auto)`) that do not align across sub-tables. | P2 | `app/routes/app._index.tsx:56-57`

Recommendation
- Switch heavy lists to `<IndexTable>` or Polaris `<ResourceList>` for virtualisation and consistent header rhythm.
- Define a shared grid-template constants file (`app/constants/tables.ts`) so column widths align across the app.

## 11. Responsive behaviour

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Dashboard uses `minHeight: "100vh"` — breaks the Shopify embedded admin scroll container on tablets. | P1 | `app/routes/app._index.tsx:2360`
Rules page renders side-by-side layout via `Layout.Section variant="oneThird"` — good; verify the right-sidebar collapses gracefully below 768 px (Polaris usually handles this, but the custom wrapper `<div style={{ background: "linear-gradient(...)" }}>` may cut off content on narrow widths). | P1 | `app/routes/app.rules.tsx:503`
Wizard uses `maxWidth: 760, margin: "0 auto"` (Phase 1-3) — reads well from 375 px through 1440 px. | ✓ | `app/routes/app.welcome.tsx:151`
Preview uses `<InlineStack wrap>` and Polaris Card lists — wraps cleanly across breakpoints. | ✓ | `app/routes/app.preview.tsx`

Recommendation
- Remove `minHeight: "100vh"` from Dashboard.
- Remove or Polaris-ify the gradient / border wrappers in Rules; they interfere with narrow-width layout.

## 12. Accessibility

Finding                                                 | Severity | Evidence
--------------------------------------------------------|----------|--------
Onboarding wizard, Rules save button, Preview list, and Previous/Continue buttons are all native Polaris `<Button>` — keyboard/focus/screen-reader compliant. | ✓ | Phases 1-4.
`app.tsx` NavMenu links are native anchors (via `<Link>`); focus order is browser default. | ✓ | `app/routes/app.tsx`.
Some Dashboard cards use `<div>` with `onClick` handlers instead of buttons or links — not keyboard-focusable, not screen-reader announced. | P0 | Grep for `onClick` on non-button elements in `app/routes/app._index.tsx`.
Custom color badges in Dashboard fail WCAG AA contrast against light backgrounds (mixed shades of green/red hex). | P0 | `app/routes/app._index.tsx:2395-2400`
Long tables lack `<caption>` / `aria-label` on the grid regions. | P1 | Grep for `role="grid"` shows none.

Recommendation (before shipping)
- Convert clickable `<div>`s to `<Button variant="plain">` or `<Link>`.
- Replace hex-color badges with Polaris `<Badge tone>` (WCAG-compliant by default).
- Add `aria-label` on custom grids or migrate them to Polaris `<IndexTable>`.

---

## Recommended follow-up phases

**Phase 5 — Production Cleanup (currently planned)**
- Remove `console.log` debug statements introduced during Phases 1-4 (there are none from Phases 1-4; pre-existing logs in loaders remain).
- Remove any dead imports (`Icon`, `CheckIcon`, `CalendarTimeIcon`, `ShieldCheckMarkIcon` — verify all still used after Phase 4 polish).
- Run `tsc --noEmit`, `eslint`, and manual a11y walkthrough on onboarding surfaces.

**Phase 6 — Global Design Reconciliation (recommended new phase)**
- Address P0 findings from this audit: Dashboard hex colors and `100vh`, Rules gradient/border wrappers, clickable `<div>`s, contrast failures.
- Explicitly out of scope: Dashboard functionality, pricing calculation, publish flow. This is purely visual cleanup on already-shipped surfaces.

**Phase 7 — Component Consolidation (optional)**
- Extract shared patterns into small components: `SectionHeader`, `EmptyStateCard`, `LoadingCard`, `MetricRow`.
- Removes duplication and enforces consistency without another audit.

**Phase 8 — Tables & Density (optional)**
- Migrate heavy lists to `<IndexTable>` for virtualisation.
- Consolidate grid-template constants.

---

## What Phase 4A shipped

Two files touched: `app/routes/app.welcome.tsx`, `app/routes/app.preview.tsx`
(preview polish was already delivered as part of Phase 3 verification —
Phase 4A only touched welcome.tsx). See `docs/onboarding-ux-phase-4.patch`.

- Standardised `<BlockStack gap>` inside wizard cards (`150` → `200/300`).
- Grouped hero paragraphs into a nested `<BlockStack gap="200">` so
  the primary CTA has clear visual separation from the copy above.
- Aligned each wizard step's standalone "Next" button to the right
  edge via `<InlineStack align="end">`, matching the Preview page's
  "Continue →" button position.

No other files touched. No workflows, no navigation, no onboarding
logic, no pricing, no APIs, no Dashboard, no GraphQL, no database.
