import { Modal, BlockStack, Text, InlineStack, Box, Icon,Button } from "@shopify/polaris";

import { DiscountIcon, RefreshIcon } from "@shopify/polaris-icons";

export type BillingBlockModalCode = "BILLING_INACTIVE" | "BILLING_UNKNOWN";

export interface BillingBlockModalProps {
  open: boolean;
  code: BillingBlockModalCode | null;
  shop: string;
  host: string;
  onClose: () => void;
}

function getTitle(code: BillingBlockModalCode): string {
  if (code === "BILLING_INACTIVE") {
    return "Subscription Required";
  }
  return "Verification Required";
}

function getIcon(code: BillingBlockModalCode) {
  if (code === "BILLING_INACTIVE") {
    return DiscountIcon;
  }
  return RefreshIcon;
}

function getMessage(code: BillingBlockModalCode): string {
  if (code === "BILLING_INACTIVE") {
    return "Your subscription is inactive. Activate billing to continue using Price Polish and unlock all features.";
  }
  return "We couldn't verify your billing status. Refresh the app to try again.";
}

function getPrimaryLabel(code: BillingBlockModalCode): string {
  if (code === "BILLING_INACTIVE") {
    return "Activate Subscription";
  }
  return "Refresh App";
}

function getSecondaryLabel(code: BillingBlockModalCode): string {
  if (code === "BILLING_INACTIVE") {
    return "Continue Browsing";
  }
  return "Close";
}

function handlePrimaryAction(params: {
  code: BillingBlockModalCode;
  shop: string;
  host: string;
}): void {
  if (params.code === "BILLING_INACTIVE") {
    const targetWindow = window.top ?? window;
    targetWindow.location.href = `/api/billing?shop=${encodeURIComponent(params.shop)}&host=${encodeURIComponent(params.host)}`;
    return;
  }
  window.location.reload();
}

export function BillingBlockModal({ open, code, shop, host, onClose }: BillingBlockModalProps) {
  if (!code) return null;

  const title = getTitle(code);
  const IconComponent = getIcon(code);
  const message = getMessage(code);
  const primaryLabel = getPrimaryLabel(code);
  const secondaryLabel = getSecondaryLabel(code);

  return (
<Modal
  open={open}
  onClose={onClose}
  title=''
>
  <Modal.Section>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "24px 12px",
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: "#FFF7ED",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "40px",
          marginBottom: "20px",
        }}
      >
        {code === "BILLING_INACTIVE" ? "💳" : "🔄"}
      </div>

      <Text as="h2" variant="headingLg">
        {title}
      </Text>

      <div style={{ marginTop: 12, maxWidth: 420 }}>
        <Text as="p" tone="subdued">
          {message}
        </Text>
      </div>

      <div style={{ marginTop: 28 }}>
        <Button
          variant="primary"
          size="large"
          onClick={() => handlePrimaryAction({ code, shop, host })}
        >
          {primaryLabel}
        </Button>
      </div>

      <div style={{ marginTop: 16 }}>
        <Button variant="plain" onClick={onClose}>
          {secondaryLabel}
        </Button>
      </div>
    </div>
  </Modal.Section>
</Modal>
  );
}
