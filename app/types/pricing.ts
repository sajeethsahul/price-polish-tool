export type VariantPricingIdentity = {
  productId: string;
  variantId: string;
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
};

export type PricingOperationSnapshot = VariantPricingIdentity & {
  image?: string | null;
  oldPrice: string | number;
  newPrice: string | number;
  originalBasePrice?: string | number | null;
  overriddenPrice?: string | number;
  compareAtPrice?: string | number | null;
  storefrontVariantPrice?: string | number | null;
  originalVariantPrice?: string | number | null;
  scheduledPrice?: string | number | null;
  isManual?: boolean;
};

export type ScheduledProductSnapshot = PricingOperationSnapshot;

export type PricingPreviewItem = PricingOperationSnapshot & {
  image: string;
  oldPrice: string;
  newPrice: string;
  originalBasePrice: string;
};

export type PricingEngineInput = {
  basePrice: number;
  productId?: string | null;
  variantId?: string | null;
  sku?: string | null;
  compareAtPrice?: number | null;
  inventoryContext?: Record<string, unknown> | null;
};

export type OperationalSafeguardSeverity = "informational" | "warning";

export interface OperationalSafeguardNotice {
  id: string;
  severity: OperationalSafeguardSeverity;
  message: string;
}
