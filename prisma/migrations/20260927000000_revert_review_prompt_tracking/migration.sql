-- Add revert-success review-prompt tracking to AppState.
-- revertReviewPromptShownAt: set when the modal first displays; gates
-- "show only once ever" (re-trigger on dismissal is cooldown-gated, not
-- shownAt-gated, so a single timestamp is sufficient for both rules).
-- revertReviewPromptDismissedAt: set when the merchant dismisses or skips
-- the prompt; the 90-day cooldown is measured from this timestamp.
ALTER TABLE "AppState"
  ADD COLUMN "revertReviewPromptShownAt" TIMESTAMP(3),
  ADD COLUMN "revertReviewPromptDismissedAt" TIMESTAMP(3);
