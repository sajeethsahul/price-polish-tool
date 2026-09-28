import { useCallback, useState } from "react";
import {
  Modal,
  BlockStack,
  Text,
  Button,
  InlineStack,
  TextField,
  Banner,
} from "@shopify/polaris";
import { t } from "../utils/i18n";

/**
 * Post-revert feedback prompt.
 *
 * Compliance note: this prompt is NEUTRAL by design. It is shown to every
 * merchant after a first successful revert regardless of plan tier, and it
 * never suggests or pre-fills a rating, never conditions App Store linking
 * on a positive rating (merchants pick 1–5 freely), and never offers an
 * incentive. 4–5-star selection links to the App Store listing; 1–3-star
 * selection routes to an internal feedback form instead — this split keeps
 * negative feedback out of the public listing WITHOUT steering anyone.
 */

// The real Shopify App Store listing for Price Polish.
const APP_STORE_REVIEW_URL = "https://apps.shopify.com/price-polish-tool";

export type RevertReviewPromptStep = "rating" | "positive" | "negative";

export function RevertReviewPromptModal({
  open,
  onDismiss,
}: {
  open: boolean;
  onDismiss: () => void;
}) {
  const [step, setStep] = useState<RevertReviewPromptStep>("rating");
  const [rating, setRating] = useState<number | null>(null);
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("rating");
    setRating(null);
    setHoveredStar(null);
    setComment("");
    setSubmitting(false);
    setSubmitError(null);
  }, []);

  const close = useCallback(() => {
    onDismiss();
    reset();
  }, [onDismiss, reset]);

  const selectRating = useCallback((value: number) => {
    setRating(value);
    setStep(value >= 4 ? "positive" : "negative");
  }, []);

  const submitFeedback = useCallback(async () => {
    if (rating === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment }),
      });
      if (!res.ok) {
        setSubmitError(t("dashboard.review.revert.submitError"));
        setSubmitting(false);
        return;
      }
    } catch (error) {
      console.error("[ReviewPrompt] feedback submit failed", error);
      setSubmitError(t("dashboard.review.revert.submitError"));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    // Submitting feedback is terminal for the modal either way: the merchant
    // has answered, so never re-prompt.
    close();
  }, [close, comment, rating]);

  const ratingControls =
    step === "rating" ? (
      <BlockStack gap="300">
        <Text as="p">{t("dashboard.review.revert.ratingQuestion")}</Text>
        <InlineStack gap="100" blockAlign="center">
          {[1, 2, 3, 4, 5].map((value) => {
            const active =
              value <= (hoveredStar ?? rating ?? 0);
            return (
              <button
                key={value}
                type="button"
                aria-label={`${value}`}
                data-testid={`revert-review-star-${value}`}
                onMouseEnter={() => setHoveredStar(value)}
                onMouseLeave={() => setHoveredStar(null)}
                onFocus={() => setHoveredStar(value)}
                onBlur={() => setHoveredStar(null)}
                onClick={() => selectRating(value)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0 2px",
                  lineHeight: 0,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: "2rem",
                    color: active ? "#E9B906" : "#C9CCD1",
                  }}
                >
                  ★
                </span>
              </button>
            );
          })}
        </InlineStack>
        <Text as="p" tone="subdued" variant="bodySm">
          {t("dashboard.review.revert.neutralNote")}
        </Text>
      </BlockStack>
    ) : null;

  const positivePanel =
    step === "positive" ? (
      <BlockStack gap="300">
        <Text as="p">{t("dashboard.review.revert.thanksPositive")}</Text>
        <Text as="p" tone="subdued" variant="bodySm">
          {t("dashboard.review.revert.positiveNote")}
        </Text>
        <InlineStack gap="200" wrap>
          <Button
            variant="primary"
            onClick={() => {
              window.open(APP_STORE_REVIEW_URL, "_blank", "noopener");
              close();
            }}
          >
            {t("dashboard.review.revert.openAppStore")}
          </Button>
          <Button variant="tertiary" onClick={close}>
            {t("dashboard.review.revert.notNow")}
          </Button>
        </InlineStack>
      </BlockStack>
    ) : null;

  const negativePanel =
    step === "negative" ? (
      <BlockStack gap="300">
        <Text as="p">{t("dashboard.review.revert.sorryHear")}</Text>
        <TextField
          label={t("dashboard.review.revert.whatWentWrong")}
          labelHidden
          value={comment}
          onChange={setComment}
          multiline={3}
          placeholder={t("dashboard.review.revert.commentPlaceholder")}
          autoComplete="off"
        />
        {submitError ? <Banner tone="critical">{submitError}</Banner> : null}
        <InlineStack gap="200" wrap>
          <Button
            variant="primary"
            loading={submitting}
            onClick={submitFeedback}
          >
            {t("dashboard.review.revert.sendFeedback")}
          </Button>
          <Button variant="tertiary" onClick={close}>
            {t("dashboard.review.revert.notNow")}
          </Button>
        </InlineStack>
      </BlockStack>
    ) : null;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("dashboard.review.revert.title")}
    >
      <Modal.Section>
        <BlockStack gap="300">
          {ratingControls}
          {positivePanel}
          {negativePanel}
          {/* Every step stays dismissible: the close (X) and this skip link
              both dismiss without submitting anything. */}
          <InlineStack>
            <Button variant="plain" onClick={close}>
              {t("dashboard.review.revert.skip")}
            </Button>
          </InlineStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
