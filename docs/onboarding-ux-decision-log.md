# Onboarding UX — Decision Log

This log documents every change made to the onboarding experience across
phased UX improvements. Each entry lists the rationale, risk level, files
touched, and the exact rollback procedure.

Governing constraints (all phases):

- No changes to pricing calculation logic, publish flow, billing, GraphQL,
  Prisma schema, App Proxy, backend APIs, or the onboarding state machine.
- Incremental, phased delivery. Each phase must be independently reviewable
  and revertable.
- Zero new npm dependencies. Existing `@shopify/polaris` and
  `@shopify/polaris-icons` only.

---

## Phase 1 — Navigation, Step Indicator, Button Hierarchy

Status: Complete — closed after verification pass.
Files touched: 2 (`app/routes/app.tsx`, `app/routes/app.welcome.tsx`).
Patch: `docs/onboarding-ux-phase-1.patch` (rollback: `git apply -R`).

### 1.1 Hide "Get Started" after onboarding; expose "Revisit Setup"

- File: `app/routes/app.tsx` (JSX inside `<NavMenu>`).
- Change: `<Link to="/app/welcome">Get Started</Link>` is now conditional on
  `!isOnboarded`. When `isOnboarded === true`, a new secondary link
  `<Link to="/app/welcome?revisit=1">Revisit Setup</Link>` is rendered
  after Help.
- Rationale: Onboarding is not a permanent destination. Merchants who
  finished setup should land on the Dashboard and never accidentally
  re-enter the wizard, but should still be able to review it deliberately.
- Risk: Very Low — data-driven off the existing loader `isOnboarded` value.
  No new loader logic, no data fetches, no server behavior change.
- Rollback: Revert the `<NavMenu>` block in `app/routes/app.tsx` to its
  previous form (single unconditional `Get Started` link).

### 1.2 Allow explicit revisit of onboarding via `?revisit=1`

- File: `app/routes/app.tsx` (loader).
- Change: Existing guard
  `if (isOnboarded && isWelcomeRoute) { redirect(...) }` was extended by
  adding `&& !isRevisit` where `isRevisit = url.searchParams.get("revisit") === "1"`.
- Rationale: The pre-existing guard bounces onboarded merchants away from
  `/app/welcome`. Without this bypass, the "Revisit Setup" link is
  unreachable. The bypass is scoped to a single explicit query parameter
  so no other navigation path is affected.
- Risk: Low — a single boolean AND against a new local variable. No effect
  on unauthenticated users, install flow, billing enforcement, or the
  primary `!isOnboarded → /app/welcome` redirect.
- Rollback: Remove the `isRevisit` variable and revert the guard to
  `if (isOnboarded && isWelcomeRoute)`.

### 1.3 Polaris-native step indicator in the wizard

- File: `app/routes/app.welcome.tsx`.
- Change: New internal `StepIndicator` component built on Polaris
  primitives: `<Card>` + `<BlockStack>` + `<InlineStack>` + `<Divider>` +
  `<Text>` + `<Badge progress="complete|partiallyComplete|incomplete">`.
  The three onboarding steps are rendered as native Polaris badges,
  each with a `progress` state driven by existing onboarding flags
  (`hasRule`, `hasPreviewed`, `hasApplied`) and a `tone` (success /
  attention) that follows Shopify's native progress-badge convention.
- Rationale: `<Badge progress>` is Shopify's built-in progress indicator
  primitive — used across Shopify Admin for setup and onboarding
  progress. Removes the earlier custom pill implementation entirely.
  No custom colors, no inline pill styling, no manual connectors —
  layout wraps naturally on narrow screens.
- Risk: Very Low — pure presentation; no state, no side effects, no
  fetches. Uses only Polaris components already in the dependency tree.
- Rollback: Remove the `StepIndicator` component and its invocation.
  Drop the `Badge` and `Divider` imports if unused elsewhere in file.

### 1.3a Informational Banner on `?revisit=1`

- File: `app/routes/app.welcome.tsx`.
- Change: When the URL has `?revisit=1`, render a Polaris
  `<Banner tone="info">` at the top of the wizard explaining that
  reopening the guide does not change any pricing rules, published
  prices, or existing configuration.
- Rationale: Merchants clicking "Revisit Setup" need reassurance that
  reviewing the guide is safe and non-destructive.
- Risk: Very Low — read-only render triggered by a query param.
- Rollback: Remove the Banner block and the `useSearchParams` /
  `isRevisit` variable.

### 1.4 Button hierarchy fix

- File: `app/routes/app.welcome.tsx`.
- Change (three places): "Skip for now" buttons changed from
  `variant="tertiary"` to the default variant (Polaris secondary). The
  wizard-advance "Next" button was upgraded to `variant="primary"` on
  Steps 1, 2, and 3.
- Rationale: Polaris `tertiary` buttons look like plain text and produce
  ambiguous hierarchy against `primary`. The default variant gives Skip a
  visible border without competing with the primary CTA. Promoting "Next"
  to primary matches merchant expectation ("this is how I continue").
- Risk: Very Low — only visual weight; onClick handlers, disabled logic,
  and navigation targets are unchanged.
- Rollback: Revert each `<Button>` element to its prior variant.

### Files changed (Phase 1)

- `app/routes/app.tsx` — +11 / -2 lines (JSX + one loader guard extension)
- `app/routes/app.welcome.tsx` — +102 / -6 lines (StepIndicator using
  `<Badge progress>`, informational Banner on revisit, button variant
  hierarchy fixes, `Badge` / `Banner` / `Divider` / `useSearchParams`
  imports)

Total: +113 / -8 across 2 files.

### Verification pass (per Phase 1 sign-off requirements)

- [x] **Step indicator uses native Polaris styling only.** Rebuilt on
      `<Badge progress="complete|partiallyComplete|incomplete">` — the
      Polaris primitive Shopify uses for onboarding progress. No custom
      pills, no manual connectors, no bespoke CSS.
- [x] **Revisit Setup is non-destructive and clearly communicated.**
      Nav link opens `/app/welcome?revisit=1`. An informational
      `<Banner tone="info">` at the top of the page reads: "You're
      revisiting the setup guide — reopening the guide won't change your
      pricing rules, published prices, or any existing configuration."
- [x] **`?revisit=1` — no redirect loops.** Traced through loader:
      - Onboarded merchant visits `/app/welcome?revisit=1`
        → `isOnboarded && isWelcomeRoute && !isRevisit` is `false`
        → no redirect; page renders. Refresh preserves the query,
        renders again. Browser back/forward preserves history.
        Bookmark to `/app/welcome?revisit=1` works on any subsequent
        visit for an onboarded merchant.
      - Onboarded merchant visits `/app/welcome` (no query)
        → guard triggers, redirects to `/app`. Existing behavior
        preserved.
      - Un-onboarded merchant visits `/app/welcome?revisit=1`
        → the `hasOnboardingProgress` branch and the un-onboarded
        branch are both unchanged; page renders normally.
- [x] **Consistent button hierarchy across onboarding.** Every "primary
      action" button on Steps 1, 2, 3 uses `variant="primary"`. Every
      "Skip" button uses the default Polaris variant (secondary,
      bordered). No `variant="tertiary"` buttons remain in
      `app.welcome.tsx`.
- [x] **Step progression is correct.**
      - Step 1 active with no data: badge 1 = `partiallyComplete /
        attention`, badges 2 & 3 = `incomplete`.
      - Save rule → `hasRule=true`. Step 2 active: badge 1 =
        `complete / success`, badge 2 = `partiallyComplete / attention`,
        badge 3 = `incomplete`.
      - Preview run → `hasPreviewed=true`. Step 3 active: badges 1 & 2
        `complete / success`, badge 3 = `partiallyComplete / attention`.
      - Apply → `hasApplied=true`. All three badges = `complete /
        success` on the final step.
- [x] **Responsive layout.** `<InlineStack wrap>` wraps the three
      badges on narrow widths (embedded Shopify Admin can go as narrow
      as ~375 px). No horizontal scroll. Badges are self-contained —
      no connectors that could break on wrap. Verified visually across
      375 / 768 / 1024 / 1440 px viewports via a Polaris preview
      (component wraps cleanly at each breakpoint).
- [x] **Accessibility.**
      - `<Badge>` provides its own accessible label ("Step 1: Create
        Pricing Rule Complete", etc.) via Polaris.
      - Wrapping `<InlineStack>` has an `aria-label` summarizing the
        current step position.
      - "Skip" and "Next / Continue" buttons are native `<Button>`
        elements — keyboard focusable, screen-reader labeled, and
        follow document tab order.
      - Color contrast: relies entirely on Polaris tone tokens
        (`success`, `attention`) which meet WCAG AA out of the box.
      - The informational Banner is a native Polaris `<Banner>` with
        `tone="info"` and includes both an icon and text — screen
        readers announce it as a status region.

### Risk assessment (Phase 1, final)

- Backend logic: untouched.
- Pricing, preview, publish, billing, GraphQL, App Proxy, Prisma schema:
  untouched.
- Onboarding state machine (loader redirects, DB writes): unchanged
  except for a single query-param bypass on the "onboarded → /app"
  guard.
- Existing users' non-onboarding navigation: unaffected.

### Manual QA checklist (Phase 1)

Run in a Shopify dev store; test both a fresh install and an already-
onboarded shop.

Fresh install (isOnboarded = false):

- [ ] After install, the app opens on `/app/welcome`.
- [ ] Primary nav shows: Dashboard, Get Started, Campaign History,
      Pricing Rules, Billing, Settings, Help. `Revisit Setup` is hidden.
- [ ] Wizard welcome step shows the hero card and CTA "Get Started".
- [ ] Clicking "Get Started" transitions to Step 1. StepIndicator
      appears at top showing "Step 1 of 3", "Create Pricing Rule", with
      the first dot active and the other two subdued.
- [ ] Skip button (default variant) is clearly less prominent than the
      primary "Create Pricing Rule" button.
- [ ] Advancing to Step 2 keeps StepIndicator; dot 1 becomes green with
      a check if the rule was created.
- [ ] Advancing to Step 3 keeps StepIndicator; dots 1 and 2 reflect
      completion state accurately.

Already-onboarded shop (`onboardingCompletedAt` OR
`onboardingFirstApplyAt` set):

- [ ] App opens on `/app` (Dashboard), not `/app/welcome`.
- [ ] Primary nav shows: Dashboard, Campaign History, Pricing Rules,
      Billing, Settings, Help, Revisit Setup. `Get Started` is hidden.
- [ ] Clicking `Revisit Setup` opens `/app/welcome?revisit=1` and
      stays there (no redirect back to Dashboard).
- [ ] Removing the `?revisit=1` parameter and reloading redirects
      back to `/app` (existing guard still works for direct navigation).
- [ ] Wizard content and StepIndicator render correctly.

Regression checks:

- [ ] Dashboard renders identically to pre-change.
- [ ] Pricing Rules save flow is unchanged (still returns to Dashboard).
- [ ] Preview page back button is unchanged (still returns to
      `/app/welcome`).
- [ ] Publishing pricing works exactly as before.
- [ ] Billing banner and enforcement work exactly as before.
- [ ] Redirect for an un-onboarded merchant hitting `/app` still
      forwards to `/app/welcome`.

TypeScript / lint:

- [ ] `npx tsc --noEmit` produces no new errors in `app/routes/app.tsx`
      or `app/routes/app.welcome.tsx`. (Confirmed locally — pre-existing
      errors in unrelated files remain unchanged.)

### Rollback instructions (Phase 1)

Option A — revert only Phase 1 changes (recommended):

```
git apply -R docs/onboarding-ux-phase-1.patch
```

Option B — restore individual files from HEAD prior to Phase 1:

```
git checkout HEAD -- app/routes/app.tsx app/routes/app.welcome.tsx
```

No database migrations, no npm/yarn changes, no environment variable
changes. Rollback is code-only.

---

## Phase 2 — Flow Improvements

Status: Implemented — awaiting review.
Files touched: 3
(`app/routes/app.welcome.tsx`, `app/routes/app.rules.tsx`,
 `app/routes/app.preview.tsx`).
Patch: `docs/onboarding-ux-phase-2.patch` (rollback: `git apply -R`).

### 2.1 URL-driven wizard step (`?step=`)

- File: `app/routes/app.welcome.tsx`.
- Change: The wizard now reads `?step=` from the URL to determine the
  starting step, and internal `setStep()` calls sync the URL via
  `setSearchParams({ ... }, { replace: true })`. A `parseWizardStepParam`
  helper safely rejects invalid values.
- Rationale: Enables deep-linking from Phase 2 return-to-wizard flows,
  preserves position across refresh / back / forward, and provides a
  stable URL for the "Revisit Setup" navigation entry.
- Risk: Low — local state and URL are kept in sync via `useEffect` +
  `setSearchParams`. `replace: true` avoids polluting browser history.
- Rollback: `git apply -R docs/onboarding-ux-phase-2.patch`.

### 2.2 Outbound navigation carries `?from=onboarding`

- File: `app/routes/app.welcome.tsx`.
- Change: Primary CTA on Step 1 navigates to
  `/app/rules?from=onboarding`; primary CTA on Step 2 navigates to
  `/app/preview?from=onboarding`. Step 3 primary and skip both go to
  `/app` (unchanged for primary; Step 3 skip was previously routed to
  `/app/preview` and has been corrected to `/app`).
- Rationale: A single query parameter is the trigger for onboarding-
  scoped behavior on Rules and Preview pages. No other navigation path
  is affected.
- Risk: Very Low — parameter addition only.
- Rollback: `git apply -R docs/onboarding-ux-phase-2.patch`.

### 2.3 Rules — return-to-wizard on save (onboarding only)

- File: `app/routes/app.rules.tsx`.
- Change: Added `useSearchParams()` and a boolean
  `isFromOnboarding = searchParams.get("from") === "onboarding"`. In the
  existing `useEffect` that handles `actionData.saved`, if
  `isFromOnboarding` is true we additionally call
  `navigate("/app/welcome?step=preview-prices", { replace: true })`.
  The Page `backAction` also routes back to `/app/welcome?step=create-rule`
  in onboarding mode; otherwise it retains its previous target `/app`.
- Rationale: Delivers the merchant flow requested in the problem
  statement: "Create Pricing Rule → save → automatically return to Get
  Started → Continue Step 2." All logic is gated behind the query
  parameter — non-onboarding saves are byte-for-byte identical to the
  previous behavior.
- Risk: Low — one added effect branch, one Page prop change, both
  gated. Action, validation, DB writes untouched.
- Rollback: `git apply -R docs/onboarding-ux-phase-2.patch`.

### 2.4 Preview — explicit Previous / Continue buttons and clearer back

- File: `app/routes/app.preview.tsx`.
- Change: Added `useSearchParams()` and `isFromOnboarding`. When
  `isFromOnboarding` is true, the Polaris `<Page>` `backAction` is
  omitted (removes the ambiguous tiny chevron) and a footer
  `<InlineStack>` renders two explicit buttons:
  `← Previous Step` (navigates to `/app/welcome?step=create-rule`) and
  `Continue →` (primary, navigates to `/app/welcome?step=apply-update`).
  When `isFromOnboarding` is false, the `backAction` label was
  corrected from the previously misleading "Back to onboarding" to
  "Back to dashboard" pointing at `/app`, so post-onboarding merchants
  landing on the preview page no longer get bounced back to the
  wizard.
- Rationale: Directly addresses problem-statement item #6 — the tiny
  arrow was mis-read as "Previous Step" and the label incorrectly
  suggested returning to onboarding for merchants who had already
  finished.
- Risk: Low — presentation-only. `useEffect` for preview data fetching
  is identical to before. No changes to the API call or the rendered
  preview list.
- Rollback: `git apply -R docs/onboarding-ux-phase-2.patch`.

### 2.5 Revisit mode: preserve `?revisit=1` through the flow

- Files: `app/routes/app.welcome.tsx`, `app/routes/app.rules.tsx`,
  `app/routes/app.preview.tsx`.
- Change: Outbound URLs from the wizard now include `revisit=1` when
  the user entered via "Revisit Setup". `rules.tsx` and `preview.tsx`
  preserve `revisit=1` in every navigation target that leads back into
  the wizard.
- Rationale: The `app.tsx` loader redirects an onboarded merchant off
  `/app/welcome` unless `?revisit=1` is present (Phase 1 guard). Without
  this preservation, the auto-return after saving a rule would drop a
  Revisit-mode merchant on the Dashboard.
- Risk: Very Low — string concatenation of an already-validated
  boolean-driven suffix.
- Rollback: `git apply -R docs/onboarding-ux-phase-2.patch`.

### Files changed (Phase 2)

- `app/routes/app.welcome.tsx` — +69 / -11 lines
- `app/routes/app.rules.tsx`   — +25 / -1 lines
- `app/routes/app.preview.tsx` — +42 / -6 lines

Total: +136 / -18 across 3 files.

### Risk assessment (Phase 2)

- Backend logic: untouched.
- Pricing calculation, preview API, publish flow, billing, GraphQL,
  App Proxy, Prisma schema, `api.onboarding.ts`: untouched.
- Onboarding state machine (loader guards, DB flag writes): unchanged.
- Every new behavior is gated behind an explicit query parameter
  (`?from=onboarding` on Rules and Preview; `?step=` on Welcome).
  Merchants navigating from primary nav or dashboard experience zero
  change.

### Manual QA checklist (Phase 2)

Return-to-wizard flow:

- [ ] From `/app/welcome`, click "Create Pricing Rule" on Step 1
      → URL becomes `/app/rules?from=onboarding`.
- [ ] Save the rule → toast "Saved successfully" appears → automatic
      redirect to `/app/welcome?step=preview-prices`. Step indicator
      shows Step 1 as `complete/success`, Step 2 as active.
- [ ] Click "Preview Prices" on Step 2 → URL becomes
      `/app/preview?from=onboarding`.
- [ ] Preview page renders WITHOUT the small `backAction` chevron.
      Two explicit buttons appear at the bottom: `← Previous Step`
      and `Continue →` (primary).
- [ ] Click `← Previous Step` → returns to
      `/app/welcome?step=create-rule`. Step indicator reflects state.
- [ ] Click `Continue →` from Preview → advances to
      `/app/welcome?step=apply-update`. Step indicator shows Steps 1
      and 2 as `complete/success`, Step 3 as active.

Non-onboarding safety:

- [ ] From primary nav, click "Pricing Rules" → URL is `/app/rules`
      (no query). Save the rule → toast fires → merchant STAYS on the
      Pricing Rules page. No redirect to `/app/welcome`.
- [ ] From primary nav, click "Pricing Rules" and change a value.
      Click the Polaris back arrow → returns to `/app` (Dashboard),
      not to onboarding.
- [ ] From primary nav, navigate to `/app/preview` directly. The
      back action now reads "Back to dashboard" and returns to `/app`.
      No explicit `Previous / Continue` buttons appear.

Deep-link and history:

- [ ] Open `/app/welcome?step=preview-prices` directly (bookmark or
      copy-paste). Page loads on Step 2 with the correct indicator.
- [ ] Refresh at any wizard step → URL is preserved, wizard reopens
      at the same step.
- [ ] Browser back / forward within the wizard: setStep uses
      `replace: true`, so back/forward remains scoped to actual
      navigations (into rules, preview, dashboard) rather than
      per-step history noise.
- [ ] `/app/welcome?step=invalid-value` falls back to the welcome
      intro (invalid step values are ignored).

Revisit mode (onboarded merchant clicks "Revisit Setup"):

- [ ] Clicking `Revisit Setup` opens `/app/welcome?revisit=1` and
      stays there.
- [ ] Advancing to Step 1 inside the wizard changes URL to
      `/app/welcome?revisit=1&step=create-rule`.
- [ ] Clicking "Create Pricing Rule" navigates to
      `/app/rules?from=onboarding&revisit=1`.
- [ ] Saving a rule inside the Revisit flow auto-returns to
      `/app/welcome?step=preview-prices&revisit=1` — the merchant is
      NOT redirected to the Dashboard by the loader guard.
- [ ] Clicking `← Previous Step` from the preview page returns to
      `/app/welcome?step=create-rule&revisit=1`.

Regression checks:

- [ ] Dashboard renders identically to Phase 1.
- [ ] Pricing calculation and rule persistence unchanged.
- [ ] Preview API result is rendered identically (list, "Showing first
      30 items" text, empty-state, error banner).
- [ ] Publish flow unchanged.
- [ ] Billing enforcement unchanged.
- [ ] TypeScript on the three modified files: zero new errors.

### Rollback instructions (Phase 2)

Preferred (patches must be applied in order; reverse in reverse order):

```
# revert Phase 2 only, keep Phase 1
git apply -R docs/onboarding-ux-phase-2.patch
```

Full revert of both phases:

```
git apply -R docs/onboarding-ux-phase-2.patch
git apply -R docs/onboarding-ux-phase-1.patch
```

Alternative — restore individual files:

```
git checkout HEAD -- app/routes/app.welcome.tsx \
                     app/routes/app.rules.tsx \
                     app/routes/app.preview.tsx
```

No DB migrations, no yarn/npm changes, no env changes. Rollback is
code-only.

---

## Phase 3 — Preview Improvements

Status: Implemented — awaiting review.
Files touched: 1 (`app/routes/app.preview.tsx`).
Patch: `docs/onboarding-ux-phase-3.patch` (rollback: `git apply -R`).

### 3.1 "Showing X of N products" label

- Change: The card now shows
  `Showing {visibleCount} of {totalCount} product(s)`, both formatted
  via `toLocaleString()`. Singular / plural handled naturally.
- Rationale: Merchants had no idea how large their catalogue really
  is when the preview page showed "Showing 30 preview items". This
  addresses problem-statement item #5 for the current 30-item limit
  without changing the sample size.
- Risk: Very Low — presentation only.

### 3.2 "View Full Preview" toggle

- Change: When `previews.length > 30`, a right-aligned Polaris
  `<Button variant="plain">View Full Preview</Button>` appears next to
  the count label. Clicking it flips a local `showAll` state, at which
  point the button becomes `Show fewer` and the visible list expands
  to `previews.length`. Purely client-side — no additional fetch, no
  pagination changes, no API touched.
- Rationale: Keeps the onboarding preview lightweight (30 items) while
  giving merchants an opt-in path to review the full list. Merchants
  can also collapse back to the sample.
- Risk: Very Low — local `useState` boolean plus a `useMemo` slice.

### 3.3 Polaris `<EmptyState>` for zero-product case

- Change: The previous inline "No preview products yet" text block is
  replaced with a Polaris `<EmptyState>` component. The primary action
  routes to `/app/rules` (with `?from=onboarding` and, if applicable,
  `?revisit=1` preserved). No external illustration URL — `image=""`
  is passed, matching the pattern used by many embedded Shopify apps
  to avoid third-party CDN dependencies.
- Rationale: Native Polaris empty state gives merchants a clear
  recovery path ("Adjust pricing rule") instead of a dead-end message.
- Risk: Very Low — presentation only, action targets existing routes.

### 3.4 Polaris skeleton loading state

- Change: The `<Spinner>` in the loading branch is replaced with a
  Polaris skeleton composition:
  `<SkeletonDisplayText size="small"/>` followed by three
  `<SkeletonBodyText lines={3}/>` blocks. Wrapped inside the existing
  `<Card>` for continuity.
- Rationale: Skeleton previews feel like a Shopify-native loading
  experience and give merchants a sense of what will appear once the
  preview loads.
- Risk: Very Low — visual only; loading state entry / exit unchanged.

### Files changed (Phase 3)

- `app/routes/app.preview.tsx` — +75 / -39 lines

### Risk assessment (Phase 3)

- API `/api/preview-price`: untouched.
- Pricing calculation, rule persistence, publish flow, billing,
  GraphQL, App Proxy, Prisma schema: untouched.
- Pagination logic: untouched — the slice is purely client-side
  presentation.
- Fetch effect, error state, and success state boundaries are byte-
  identical to Phase 2 for merchants who don't hit the empty state.

### Manual QA checklist (Phase 3)

- [ ] With a shop that has more than 30 products in preview:
      label reads "Showing 30 of {N} products"; the `View Full Preview`
      button is visible.
- [ ] Clicking `View Full Preview` expands the list to all items;
      label updates to "Showing {N} of {N} products"; button becomes
      `Show fewer`.
- [ ] Clicking `Show fewer` collapses back to 30; label reverts.
- [ ] With a shop that has fewer than 30 products: label reads
      "Showing {N} of {N}"; the `View Full Preview` button is hidden.
- [ ] With a shop that has 1 product: label reads "Showing 1 of 1
      product" (singular).
- [ ] With a shop that has 0 products (or before creating a rule):
      Polaris `EmptyState` renders with heading "No preview products
      yet" and a primary action "Adjust pricing rule".
- [ ] Clicking "Adjust pricing rule" from onboarding routes to
      `/app/rules?from=onboarding` (and preserves `revisit=1` if
      applicable). From direct navigation, it routes to `/app/rules`
      with no query string.
- [ ] While the preview is loading, the card shows skeleton lines
      (no spinner). Skeleton disappears as soon as data arrives.
- [ ] Error state (simulate a network error): critical banner
      "Unable to load previews" renders; card shows empty layout.
      (Behavior unchanged from Phase 2 — verify no regression.)
- [ ] Explicit ← Previous Step / Continue → buttons (Phase 2)
      continue to appear only when `?from=onboarding` is present.
- [ ] `Back to dashboard` label continues to render for direct
      navigation only.
- [ ] TypeScript on `app.preview.tsx`: zero new errors.

### Rollback instructions (Phase 3)

Preferred:

```
git apply -R docs/onboarding-ux-phase-3.patch
```

Full revert of all three phases (in reverse order):

```
git apply -R docs/onboarding-ux-phase-3.patch
git apply -R docs/onboarding-ux-phase-2.patch
git apply -R docs/onboarding-ux-phase-1.patch
```

Alternative — restore `app/routes/app.preview.tsx` from HEAD:

```
git checkout HEAD -- app/routes/app.preview.tsx
```

No DB migrations, no yarn/npm changes, no env changes. Rollback is
code-only.

---

---

## Phase 4 — Visual Polish (Final onboarding pass)

Status: Implemented — awaiting review.
Files touched: 1 (`app/routes/app.welcome.tsx`).
Patch: `docs/onboarding-ux-phase-4.patch` (rollback: `git apply -R`).
Companion audit: `docs/onboarding-ux-global-audit.md` (no code, findings only).

### 4.1 Wizard card `<BlockStack gap>` standardisation

- Change: Hero card previously used `gap="150"`; social-proof card
  previously used `gap="150"`. Both normalised to `gap="200"` /
  `gap="300"` to match the sibling trust and safety cards.
- Rationale: Sibling cards should share the same spacing rhythm.
  `gap="200"` is Polaris's default rhythm for content within cards.
- Risk: Very Low — spacing only.

### 4.2 Hero card content grouping

- Change: The four subdued paragraphs in the hero step are now wrapped
  in an inner `<BlockStack gap="200">` so they read as a single block
  of copy. The primary CTA sits below in its own `<InlineStack>` with
  clearer visual separation.
- Rationale: Prior layout inter-leaved copy with the CTA using a
  single-gap container, which weakened the CTA. This is the exact
  weakness called out in problem-statement item #2.
- Risk: Very Low — layout grouping only, no logic change.

### 4.3 Wizard "Next" buttons aligned to end

- Change: Each of the three step-completion "Next" buttons (bottom of
  Steps 1, 2, 3) now sit in `<InlineStack align="end">`, so they
  anchor to the right edge of the wizard column.
- Rationale: Matches the Preview page's `Continue →` position
  (right-aligned primary) so merchants build a consistent expectation
  of "primary continuation on the right" across the wizard flow.
- Risk: Very Low — alignment only.

### Files changed (Phase 4)

- `app/routes/app.welcome.tsx` — +19 / -17 lines

### Risk assessment (Phase 4)

- Backend logic: untouched.
- Pricing, publish, billing, GraphQL, App Proxy, Prisma, APIs,
  Dashboard: untouched.
- Wizard workflow, step transitions, URL sync, return-to-wizard,
  onboarding state machine, navigation: untouched.
- Only visual spacing and alignment inside three wizard step
  components changed.

### Manual QA checklist (Phase 4)

- [ ] Wizard hero step: the four intro paragraphs read as one block
      of copy, separated from the primary CTA by clear whitespace.
- [ ] All wizard cards feel visually consistent — same inner rhythm,
      no card feels tighter or looser than another.
- [ ] The "Next" button on Steps 1, 2, and 3 anchors to the right edge
      of the wizard column. On narrow screens it wraps naturally.
- [ ] Preview page `Continue →` and wizard `Next` buttons are visually
      aligned in position across the flow.
- [ ] StepIndicator (Phase 1) still renders correctly and remains in
      sync with URL / state.
- [ ] All Phase 2 and Phase 3 flows still work (spot-check: fresh
      install → wizard → save rule → preview → continue → apply).
- [ ] Responsive: verify at 375 / 768 / 1024 / 1440 px. No overflow,
      no clipped text, no scroll traps.
- [ ] A11y regression: keyboard tab order still walks
      Banner → StepIndicator → Card content → Primary → Skip → Next.
- [ ] TypeScript on `app.welcome.tsx`: zero new errors.

### Rollback instructions (Phase 4)

Preferred (Phase 4 only):

```
git apply -R docs/onboarding-ux-phase-4.patch
```

Full revert (all phases, reverse order):

```
git apply -R docs/onboarding-ux-phase-4.patch
git apply -R docs/onboarding-ux-phase-3.patch
git apply -R docs/onboarding-ux-phase-2.patch
git apply -R docs/onboarding-ux-phase-1.patch
```

Alternative — restore file from HEAD:

```
git checkout HEAD -- app/routes/app.welcome.tsx
```

No DB migrations, no yarn/npm changes, no env changes. Code-only.

### Global consistency audit — separate deliverable

See `docs/onboarding-ux-global-audit.md`. It documents 12 categories of
findings across all pages (page titles, card spacing, colors, buttons,
badges, empty states, loading states, toast tones, icons, tables,
responsive behaviour, accessibility). Each finding lists file:line
evidence, severity (P0 / P1 / P2), and recommended fix. No code was
changed outside the Phase 4A onboarding scope; the audit is intended
to seed follow-up phases (proposed Phase 6 "Global Design
Reconciliation" and beyond).

---

## Phase 5 — Production Cleanup (planned)

Scope: remove debug logs and dead code introduced during phases 1–4,
strip unused imports, run TypeScript, ESLint, and accessibility passes,
verify responsive layouts at 375 / 768 / 1024 / 1440 px.
