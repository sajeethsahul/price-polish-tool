import { Modal, BlockStack, Text, Button, InlineStack, Box } from "@shopify/polaris";
import { t } from "../utils/i18n";

export type BillingBlockModalCode = "BILLING_INACTIVE" | "BILLING_UNKNOWN";

export interface BillingBlockModalProps {
  open: boolean;
  code: BillingBlockModalCode | null;
  shop: string;
  host: string;
  onClose: () => void;
}

const BILLING_RESTORE_FLAG = "pp.billing.restore_initiated";

function getTitle(code: BillingBlockModalCode): string {
  if (code === "BILLING_INACTIVE") {
    return t("billing.subscriptionAccessRequired");
  }
  return t("billing.subscriptionVerificationRequired");
}

function getMessage(code: BillingBlockModalCode): string {
  if (code === "BILLING_INACTIVE") {
    return t("billing.inactiveMessage");
  }
  return t("billing.verificationMessage");
}

function getPrimaryLabel(code: BillingBlockModalCode): string {
  if (code === "BILLING_INACTIVE") {
    return t("billing.restoreAccess");
  }
  return t("billing.refreshApp");
}

function getSecondaryLabel(_code: BillingBlockModalCode): string {
  return t("billing.continueBrowsing");
}

function handlePrimaryAction(params: {
  code: BillingBlockModalCode;
  shop: string;
  host: string;
}): void {
  if (params.code === "BILLING_INACTIVE") {
    sessionStorage.setItem(BILLING_RESTORE_FLAG, "1");
    const targetWindow = window.top ?? window;
    targetWindow.location.href = `/api/billing?shop=${encodeURIComponent(params.shop)}&host=${encodeURIComponent(params.host)}`;
    return;
  }
  window.location.reload();
}

export function BillingBlockModal({ open, code, shop, host, onClose }: BillingBlockModalProps) {
  if (!code) return null;

  const title = getTitle(code);
  const message = getMessage(code);
  const primaryLabel = getPrimaryLabel(code);
  const secondaryLabel = getSecondaryLabel(code);
  const messageParagraphs = message.split("\n\n");
  const visual = code === "BILLING_INACTIVE" ? "🔒" : "🔄";

  return (
    <Modal open={open} onClose={onClose} title="">
      <Modal.Section>
        <BlockStack gap="500" align="center">
          <InlineStack align="center">
            <Box background="bg-surface-secondary" borderRadius="full" padding="500">
              <Text as="span" variant="heading2xl">
                {visual}
              </Text>
            </Box>
          </InlineStack>

          <Text as="h2" variant="headingLg" alignment="center">
            {title}
          </Text>

          <BlockStack gap="200">
            {messageParagraphs.map((paragraph, index) => (
              <Text key={index} as="p" tone="subdued" alignment="center">
                {paragraph}
              </Text>
            ))}
          </BlockStack>

          <BlockStack gap="200" align="center">
            <Button
              variant="primary"
              size="large"
              onClick={() => handlePrimaryAction({ code, shop, host })}
            >
              {primaryLabel}
            </Button>
            <Button variant="plain" onClick={onClose}>
              {secondaryLabel}
            </Button>
          </BlockStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
