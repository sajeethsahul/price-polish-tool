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

export type CampaignConflictSeverity = "info" | "warning" | "critical";

export type CampaignConflictType =
  | "window-overlap"
  | "scope-overlap"
  | "exact-time-overlap"
  | "nearby-time-overlap"
  | "active-window-overlap"
  | "restore-window-overlap";

export type CampaignConflictCampaign = {
  campaignId?: string | null;
  scheduledJobId?: string | null;
  title: string;
  status: string;
  scheduleType: "one-time" | "time-window" | "unknown";
  startAt: string | null;
  endAt: string | null;
};

export type CampaignConflict = {
  id: string;
  severity: CampaignConflictSeverity;
  conflictType: CampaignConflictType;
  primary: CampaignConflictCampaign;
  conflicting: CampaignConflictCampaign;
  affectedProductIds: string[];
  affectedVariantIds: string[];
  affectedProductCount: number;
  affectedVariantCount: number;
};
