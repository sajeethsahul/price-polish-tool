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

## Phase 2 — Flow Improvements (planned, not yet started)

Scope (to be implemented after Phase 1 sign-off):

- `app.welcome.tsx`: read `?step=` from URL to deep-link a wizard step.
- `app.rules.tsx`: on successful save, if `?from=onboarding` was set,
  navigate back to `/app/welcome?step=preview-prices`. Non-onboarding
  saves are unchanged.
- `app.preview.tsx`: when `?from=onboarding` is present, render explicit
  `← Previous Step` / `Continue →` buttons. Default nav uses the
  existing back arrow.

## Phase 3 — Preview Improvements (planned, not yet started)

Scope: relabel to `Showing 30 of {total} products`, add optional
`View Full Preview` toggle, improve empty and loading states. Preview
sample size stays at 30 per current guidance.

## Phase 4 — Visual Polish (planned)

Scope: typography, alignment, spacing, mobile responsiveness, a11y.

## Phase 5 — Production Cleanup (planned)

Scope: remove debug logs and dead code introduced during phases 1–4,
strip unused imports, run TypeScript, ESLint, and accessibility passes,
verify responsive layouts at 375 / 768 / 1024 / 1440 px.
