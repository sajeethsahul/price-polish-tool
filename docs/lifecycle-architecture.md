# Pricing Engine Lifecycle Architecture

## Core Principle

The pricing engine uses isolated lifecycle systems for:

1. Immediate Apply
2. One-time Publish
3. Time Window Scheduling
4. Revert / Restore Operations

These systems must NOT share runtime ownership semantics unless explicitly designed.

---

# 1. Immediate Apply Lifecycle

## Purpose

Applies pricing immediately from dashboard actions.

## Canonical States

draft
active
reverted
failed
unrecoverable

## Behavior

- Pricing applies immediately.
- Storefront pricing changes instantly.
- Campaign becomes revertable.
- No scheduling ownership exists.
- No auto restore exists.

## Revert Semantics

Manual revert restores original storefront pricing using tracked history rows.

---

# 2. One-time Publish Lifecycle

## Purpose

Schedules a future one-time pricing publish.

## Canonical States

scheduled-publish
publishing
published
cancelled-publish
failed
reverted

## Runtime Behavior

Before publish:
- countdown visible
- Cancel Publish available
- storefront unchanged

At publish:
scheduled-publish
→ publishing
→ published

## Important Rules

- One-time Publish does NOT own storefront pricing runtime.
- No active-window semantics.
- No auto restore.
- No restore ownership evaluation.
- No Time Window behavior reuse.

## Cancellation

Before execution:
- Cancel Publish allowed
- storefront remains unchanged
- campaign becomes cancelled-publish

---

# 3. Time Window Lifecycle

## Purpose

Temporarily apply storefront pricing for a controlled time range.

## Canonical States

scheduled-window
active-window
expired-window
window-stopped
auto-restored
cancelled-window
failed
unrecoverable

## Runtime Ownership

Time Window IS the only lifecycle that owns temporary storefront pricing runtime.

During active-window:
- storefront reflects temporary pricing
- countdown visible
- Stop Window available

## Lifecycle Flow

Before start:
scheduled-window

During active period:
active-window

After natural expiry:
expired-window
→ auto-restored

Manual stop:
active-window
→ window-stopped

Cancelled before start:
cancelled-window

## Important Rules

- Only active-window campaigns influence storefront runtime pricing.
- Expired/restored/cancelled windows must NEVER reapply pricing.
- Storefront ownership must be removed immediately after restore/stop/cancel.

---

# 4. Revert / Restore Lifecycle

## Purpose

Restore original storefront pricing.

## Restore Sources

- Manual revert
- Window stop
- Auto restore
- Undo operations

## Important Rules

- Revert pipeline must remain centralized.
- Original storefront prices come from tracked history.
- Restore must clear staged ownership rows.
- Restore must finalize lifecycle state correctly.

---

# 5. Storefront Ownership Rules

## Ownership Allowed ONLY For

active-window

## Ownership NEVER Allowed For

published
reverted
auto-restored
window-stopped
cancelled-window
expired-window
failed
unrecoverable

## Critical Rule

Temporary pricing must NEVER reappear after:
- restore
- stop
- cancellation
- expiry completion

---

# 6. Campaign History Runtime Rules

## Runtime Status Overrides Persisted Status

Campaign History may derive runtime state from:
- current UTC time
- runAt
- windowEndAt
- restore state
- lifecycle evaluation

## Runtime Examples

Before start:
Scheduled Window

During active period:
Active Window

After restore:
Auto Restored

---

# 7. Operational UX Principles

## Goals

- merchant-readable wording
- calm operational messaging
- lifecycle transparency
- reversible actions
- minimal confusion

## Avoid

- technical wording
- ambiguous lifecycle states
- duplicate actions
- stale runtime buttons
- aggressive warnings

---

# 8. Engineering Rules

## Preserve

- lifecycle isolation
- worker polling stability
- revert pipeline consistency
- storefront ownership correctness
- Polaris modal/layout consistency
- operational readability

## Prefer

- targeted fixes
- helper predicates
- explicit lifecycle transitions
- centralized lifecycle evaluation

## Avoid

- broad refactors
- duplicated status logic
- mixing Time Window and Publish semantics
- unnecessary schema changes