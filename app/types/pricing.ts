export type PricingPreviewItem = {
  productId: string;
  title: string;
  image: string;
  variantId: string;
  oldPrice: string;
  newPrice: string;
  originalBasePrice: string;
  overriddenPrice?: string;
  variantTitle?: string;
};

export type OperationalSafeguardSeverity = "informational" | "warning";

export interface OperationalSafeguardNotice {
  id: string;
  severity: OperationalSafeguardSeverity;
  message: string;
}
