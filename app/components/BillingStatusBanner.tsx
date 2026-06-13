import { Button, Banner } from "@shopify/polaris";

export type BillingStatusValue =
  | "active"
  | "trialing"
  | "cancelled"
  | "frozen"
  | "expired"
  | "none"
  | "unknown";

/**
 * Returns true when billing is considered active — merchants may use the app freely.
 * Returns false when billing is not active — merchants see a soft awareness banner
 * but are not blocked from any feature.
 */
export function isBillingActive(status: BillingStatusValue): boolean {
  return status === "active" || status === "trialing";
}

interface BillingStatusBannerProps {
  status: BillingStatusValue;
  /** Set to true when inside a route that is gated by billing (e.g. Dashboard). */
  showWhenInactiveOnly?: boolean;
}

export function BillingStatusBanner({
  status,
  showWhenInactiveOnly = false,
}: BillingStatusBannerProps) {
  if (showWhenInactiveOnly && isBillingActive(status)) {
    return null;
  }

  if (isBillingActive(status)) {
    return null;
  }

  const handleActivate = () => {
    const params = new URLSearchParams(window.location.search);
    const shop = params.get("shop");
    const host = params.get("host");
    if (!shop || !host) return;
    window.open(
      `/api/billing?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`,
      "_top"
    );
  };

  return (
    <Banner tone="warning" title="Your subscription is inactive.">
      <p>
        Reactivate billing to continue using Price Polish without interruption.
      </p>
      <Button variant="primary" onClick={handleActivate}>
        Activate Subscription
      </Button>
    </Banner>
  );
}
