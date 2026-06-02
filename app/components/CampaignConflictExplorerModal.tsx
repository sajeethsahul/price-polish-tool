import { Badge, BlockStack, Box, InlineStack, Modal, Text } from "@shopify/polaris";
import type { CampaignConflict, CampaignConflictCampaign, CampaignConflictSeverity, CampaignConflictType } from "../types/pricing";
import { ExpandableList } from "./ExpandableList";
import { ModalScrollableSection } from "./ModalScrollableSection";

function severityTone(severity: CampaignConflictSeverity) {
  if (severity === "critical") return "critical" as const;
  if (severity === "warning") return "warning" as const;
  return "info" as const;
}

function formatScheduleType(value: CampaignConflictCampaign["scheduleType"]) {
  if (value === "time-window") return "Time Window";
  if (value === "one-time") return "One-time";
  return "Unknown";
}

function formatConflictType(value: CampaignConflictType) {
  if (value === "window-overlap") return "Overlapping window";
  if (value === "scope-overlap") return "Overlapping scope";
  if (value === "exact-time-overlap") return "Exact publish time";
  if (value === "nearby-time-overlap") return "Nearby publish time";
  if (value === "active-window-overlap") return "Active window";
  if (value === "restore-window-overlap") return "Restore timing inside window";
  return value;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "active-window" || normalized === "active" || normalized === "published") return "success" as const;
  if (normalized === "partial") return "warning" as const;
  if (normalized === "failed") return "critical" as const;
  if (normalized.includes("scheduled") || normalized === "pending") return "attention" as const;
  return "info" as const;
}

function maxSeverity(conflicts: CampaignConflict[]) {
  if (conflicts.some((c) => c.severity === "critical")) return "critical" as const;
  if (conflicts.some((c) => c.severity === "warning")) return "warning" as const;
  return "info" as const;
}

function groupConflicts(conflicts: CampaignConflict[]) {
  const byCampaign = new Map<string, CampaignConflict[]>();

  for (const conflict of conflicts) {
    const key = conflict.conflicting.campaignId ?? conflict.conflicting.scheduledJobId ?? conflict.conflicting.title;
    const existing = byCampaign.get(key);
    if (existing) existing.push(conflict);
    else byCampaign.set(key, [conflict]);
  }

  const groups = [...byCampaign.entries()].map(([key, items]) => {
    const first = items[0];
    const reasons = [...new Set(items.map((c) => c.conflictType))];
    const productIds = new Set<string>();
    const variantIds = new Set<string>();
    for (const item of items) {
      for (const productId of item.affectedProductIds) productIds.add(productId);
      for (const variantId of item.affectedVariantIds) variantIds.add(variantId);
    }

    return {
      key,
      conflicting: first.conflicting,
      severity: maxSeverity(items),
      reasons,
      productIds: [...productIds],
      variantIds: [...variantIds],
    };
  });

  const rank = (value: CampaignConflictSeverity) => (value === "critical" ? 3 : value === "warning" ? 2 : 1);
  groups.sort((a, b) => rank(b.severity) - rank(a.severity));

  return groups;
}

export function CampaignConflictExplorerModal({
  open,
  onClose,
  primaryTitle,
  conflicts,
  productLabelById,
  variantLabelById,
}: {
  open: boolean;
  onClose: () => void;
  primaryTitle: string;
  conflicts: CampaignConflict[];
  productLabelById?: Map<string, string>;
  variantLabelById?: Map<string, string>;
}) {
  const groups = groupConflicts(conflicts);
  const resolvedProductLabels = productLabelById ?? new Map<string, string>();
  const resolvedVariantLabels = variantLabelById ?? new Map<string, string>();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Conflict Explorer"
      secondaryActions={[
        {
          content: "Close",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <ModalScrollableSection>
          <BlockStack gap="300">
            <Box padding="300" background="bg-surface-secondary" borderRadius="200">
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">
                  Primary campaign
                </Text>
                <Text as="p" variant="bodyMd" fontWeight="medium">
                  {primaryTitle}
                </Text>
              </BlockStack>
            </Box>

            {groups.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                No conflicts detected.
              </Text>
            ) : (
              <BlockStack gap="300">
                {groups.map((group) => {
                  const end = group.conflicting.scheduleType === "time-window" ? formatDateTime(group.conflicting.endAt) : "—";
                  const productLabels = group.productIds
                    .map((id) => resolvedProductLabels.get(id) ?? "")
                    .filter((label) => label.length > 0)
                    .sort((a, b) => a.localeCompare(b));
                  const variantLabels = group.variantIds
                    .map((id) => resolvedVariantLabels.get(id) ?? "")
                    .filter((label) => label.length > 0)
                    .sort((a, b) => a.localeCompare(b));

                  return (
                    <Box key={group.key} padding="300" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="start" wrap>
                          <BlockStack gap="050">
                            <Text as="p" variant="bodyMd" fontWeight="medium">
                              {group.conflicting.title || "Scheduled Campaign"}
                            </Text>
                            <InlineStack gap="150" wrap>
                              <Badge tone={statusTone(group.conflicting.status)}>{group.conflicting.status}</Badge>
                              <Badge tone={severityTone(group.severity)}>{group.severity}</Badge>
                            </InlineStack>
                          </BlockStack>

                          <BlockStack gap="050">
                            <Text as="p" variant="bodySm" tone="subdued">
                              {formatScheduleType(group.conflicting.scheduleType)}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {formatDateTime(group.conflicting.startAt)}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {end}
                            </Text>
                          </BlockStack>
                        </InlineStack>

                        <InlineStack gap="150" wrap>
                          {group.reasons.map((reason) => (
                            <Badge key={reason} tone="info">
                              {formatConflictType(reason)}
                            </Badge>
                          ))}
                        </InlineStack>

                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
                          <ExpandableList title="Affected Products" items={productLabels} collapsedVisibleCount={5} />
                          <ExpandableList title="Affected Variants" items={variantLabels} collapsedVisibleCount={5} />
                        </div>
                      </BlockStack>
                    </Box>
                  );
                })}
              </BlockStack>
            )}
          </BlockStack>
        </ModalScrollableSection>
      </Modal.Section>
    </Modal>
  );
}
