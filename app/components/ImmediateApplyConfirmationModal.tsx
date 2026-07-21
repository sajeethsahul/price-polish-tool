import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, BlockStack, Text, TextField, Badge, InlineStack, Box } from "@shopify/polaris";
import { DiscardChangesModal } from "./DiscardChangesModal";
import type { OperationalSafeguardNotice } from "../types/pricing";

export interface ImmediateApplyImpactSummary {
  increaseCount: number;
  decreaseCount: number;
  averageChangePercent: number;
  largestMovementPercent: number | null;
  largestMovementDirection: "increase" | "decrease" | null;
  singleItemDirection: "increase" | "decrease" | "no_change" | null;
}

export interface ImmediateApplyConfirmationModalProps {
  open: boolean;
  scopeLabel: string;
  itemCount: number;
  isProcessing: boolean;
  initialCampaignTitle: string;
  impactSummary: ImmediateApplyImpactSummary;
  safeguardNotices?: OperationalSafeguardNotice[];
  validateCampaignTitle?: (campaignTitle: string) => string | undefined;
  onClose: () => void;
  onConfirm: (campaignTitle: string) => Promise<boolean>;
  /** Notified whenever the unsaved-edit state of the campaign-title field changes. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function ImmediateApplyConfirmationModal({
  open,
  scopeLabel,
  itemCount,
  isProcessing,
  initialCampaignTitle,
  impactSummary,
  safeguardNotices = [],
  validateCampaignTitle,
  onClose,
  onConfirm,
  onDirtyChange,
}: ImmediateApplyConfirmationModalProps) {
  const [campaignTitle, setCampaignTitle] = useState(initialCampaignTitle);
  const [titleError, setTitleError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      setCampaignTitle(initialCampaignTitle);
      setTitleError(undefined);
    }
  }, [open, initialCampaignTitle]);

  // Unsaved-change protection for the Campaign Title field. Dirty is derived ONLY from
  // the user-entered title vs. its empty baseline (initialCampaignTitle) — never from
  // loading, processing, or validation state. Guards modal close; the parent can also
  // subscribe via onDirtyChange to block page navigation.
  const isTitleDirty = useMemo(
    () => campaignTitle.trim() !== "" && campaignTitle.trim() !== initialCampaignTitle.trim(),
    [campaignTitle, initialCampaignTitle],
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onDirtyChange?.(open ? isTitleDirty : false);
  }, [open, isTitleDirty, onDirtyChange]);

  const runOrConfirm = useCallback(
    (action: () => void) => {
      if (open && isTitleDirty && !isProcessing) {
        pendingActionRef.current = action;
        setDiscardOpen(true);
      } else {
        action();
      }
    },
    [open, isTitleDirty, isProcessing],
  );

  const handleSubmit = async () => {
    const normalizedTitle = campaignTitle.trim();
    if (!normalizedTitle) {
      setTitleError("Campaign title is required before applying pricing.");
      return;
    }

    if (validateCampaignTitle) {
      const validationError = validateCampaignTitle(normalizedTitle);
      if (validationError) {
        setTitleError(validationError);
        return;
      }
    }

    setTitleError(undefined);
    const ok = await onConfirm(normalizedTitle);
    if (ok) {
      onClose();
    }
  };

  const formatPercent = (value: number) => {
    const rounded = Math.round(value * 10) / 10;
    const sign = rounded >= 0 ? "+" : "";
    return `${sign}${rounded}%`;
  };

  const movementLabel =
    impactSummary.largestMovementDirection === "increase"
      ? "Largest increase"
      : impactSummary.largestMovementDirection === "decrease"
        ? "Largest decrease"
        : "Largest movement";
  const safeguardWarningCount = safeguardNotices.filter(
    (notice) => notice.severity === "warning"
  ).length;
  const safeguardInfoCount = safeguardNotices.length - safeguardWarningCount;

  return (
    <>
    <Modal
      open={open}
      onClose={() => {
        if (!isProcessing) runOrConfirm(onClose);
      }}
      title="Confirm Immediate Apply"
      primaryAction={{
        content: "Apply",
        loading: isProcessing,
        disabled: isProcessing || itemCount === 0,
        onAction: () => {
          void handleSubmit();
        },
      }}
      secondaryActions={[
        {
          content: "Cancel",
          disabled: isProcessing,
          onAction: () => runOrConfirm(onClose),
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p" tone="subdued" variant="bodySm">
            {`Applying pricing to: ${itemCount} ${scopeLabel}.`}
          </Text>
          <BlockStack gap="100">
            <Text as="p" variant="bodySm">
              {`${itemCount} ${itemCount === 1 ? "product" : "products"} will update immediately.`}
            </Text>
            {itemCount > 1 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {`${impactSummary.increaseCount} price increases • ${impactSummary.decreaseCount} price decreases`}
              </Text>
            ) : impactSummary.singleItemDirection ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {impactSummary.singleItemDirection === "increase"
                  ? "This update is a price increase."
                  : impactSummary.singleItemDirection === "decrease"
                    ? "This update is a price decrease."
                    : "This update keeps the same price."}
              </Text>
            ) : null}
            <Text as="p" variant="bodySm" tone="subdued">
              {`Average change: ${formatPercent(impactSummary.averageChangePercent)}`}
            </Text>
            {impactSummary.largestMovementPercent !== null ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {`${movementLabel}: ${formatPercent(impactSummary.largestMovementPercent)}`}
              </Text>
            ) : null}
          </BlockStack>
          {safeguardNotices.length > 0 && (
            <Box
              padding="200"
              background="bg-surface"
              borderRadius="200"
              borderColor="border-secondary"
              borderWidth="025"
            >
              <BlockStack gap="150">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <Text as="p" variant="bodySm" fontWeight="medium">
                    Before applying
                  </Text>
                  <InlineStack gap="100" wrap={false}>
                    <Badge tone="warning">
                      {`${safeguardWarningCount} Warning${safeguardWarningCount === 1 ? "" : "s"}`}
                    </Badge>
                    <Badge tone="info">
                      {`${safeguardInfoCount} Info`}
                    </Badge>
                  </InlineStack>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Review before applying.
                </Text>
                <BlockStack gap="150">
                  {safeguardNotices.map((notice) => (
                    <Text key={notice.id} as="p" variant="bodySm" tone="subdued">
                      {`\u2022 ${notice.message}`}
                    </Text>
                  ))}
                </BlockStack>
              </BlockStack>
            </Box>
          )}
          <Box paddingBlockStart={safeguardNotices.length > 0 ? "300" : "0"}>
            <TextField
              label="Campaign Title"
              value={campaignTitle}
              onChange={(value) => {
                setCampaignTitle(value);
                const normalized = value.trim();
                if (!normalized) {
                  setTitleError(undefined);
                  return;
                }
                if (!validateCampaignTitle) {
                  if (titleError) setTitleError(undefined);
                  return;
                }
                const validationError = validateCampaignTitle(normalized);
                setTitleError(validationError);
              }}
              placeholder="e.g., Weekend Price Refresh"
              autoComplete="off"
              error={titleError}
              disabled={isProcessing}
            />
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>

    <DiscardChangesModal
      open={discardOpen}
      onDiscard={() => {
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        setDiscardOpen(false);
        if (typeof action === "function") action();
      }}
      onKeepEditing={() => {
        pendingActionRef.current = null;
        setDiscardOpen(false);
      }}
    />
    </>
  );
}
