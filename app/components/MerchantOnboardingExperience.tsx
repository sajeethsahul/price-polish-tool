import { Badge, BlockStack, Button, CalloutCard, Card, Icon, InlineStack, List, Modal, Text } from "@shopify/polaris";
import { CalendarTimeIcon, ShieldCheckMarkIcon } from "@shopify/polaris-icons";
import { t } from "../utils/i18n";

export type OnboardingProgress = {
  hasRule: boolean;
  hasPreviewed: boolean;
  hasApplied: boolean;
  hasScheduled: boolean;
  hasCompletedFirstUpdate: boolean;
};

function ProgressRow({
  label,
  completed,
}: {
  label: string;
  completed: boolean;
}) {
  return (
    <InlineStack align="space-between" blockAlign="center" wrap={false}>
      <Text as="span" variant="bodyMd">
        {label}
      </Text>
      <Badge tone={completed ? "success" : "attention"}>
        {completed ? t("common.done") : t("common.pending")}
      </Badge>
    </InlineStack>
  );
}

function TrustRow({
  icon,
  label,
}: {
  icon: any;
  label: string;
}) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <Icon source={icon} tone="success" />
      <Text as="span" variant="bodyMd">
        {label}
      </Text>
    </InlineStack>
  );
}

function ProgressMetricRow({
  label,
  completed,
}: {
  label: string;
  completed: boolean;
}) {
  return (
    <InlineStack align="space-between" blockAlign="center" wrap={false}>
      <Text as="span" variant="bodyMd">
        {label}
      </Text>
      <Badge tone={completed ? "success" : "attention"}>
        {completed ? t("common.done") : t("common.pending")}
      </Badge>
    </InlineStack>
  );
}

export function MerchantOnboardingCard({
  progress,
  onCreateFirstRule,
  onWatchSetupGuide,
}: {
  progress: OnboardingProgress;
  onCreateFirstRule: () => void;
  onWatchSetupGuide: () => void;
}) {
  return (
    <BlockStack gap="400">
      <CalloutCard  
       illustration="https://cdn.shopify.com/s/files/1/0000/0000/0000/0price-polish-tool/price-polish-tool.png"
        title={t("dashboard.onboarding.heroTitle")}
        primaryAction={{
          content: t("dashboard.onboarding.createFirstRule"),
          onAction: onCreateFirstRule,
        }}
        secondaryAction={{
          content: t("dashboard.onboarding.watchSetupGuide"),
          onAction: onWatchSetupGuide,
        }}
      >
        <BlockStack gap="150">
          <Text as="p" tone="subdued">
            {t("dashboard.onboarding.heroLine1")}
          </Text>
          <Text as="p" tone="subdued">
            {t("dashboard.onboarding.heroLine2")}
          </Text>
          <Text as="p" tone="subdued">
            {t("dashboard.onboarding.heroLine3")}
          </Text>
          <Text as="p" tone="subdued">
            {t("dashboard.onboarding.heroWhyThisMatters")}
          </Text>
        </BlockStack>
      </CalloutCard>

      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd">
            {t("dashboard.onboarding.progressMetricsTitle")}
          </Text>
          <BlockStack gap="200">
            <ProgressMetricRow
              label={t("dashboard.onboarding.progressMetricsRule")}
              completed={progress.hasRule}
            />
            <ProgressMetricRow
              label={t("dashboard.onboarding.progressMetricsPreview")}
              completed={progress.hasPreviewed}
            />
            <ProgressMetricRow
              label={t("dashboard.onboarding.progressMetricsApplied")}
              completed={progress.hasApplied}
            />
            <ProgressMetricRow
              label={t("dashboard.onboarding.progressMetricsScheduled")}
              completed={progress.hasScheduled}
            />
          </BlockStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={ShieldCheckMarkIcon} tone="success" />
            <Text as="h3" variant="headingMd">
              {t("dashboard.onboarding.trustListTitle")}
            </Text>
          </InlineStack>

          <BlockStack gap="200">
            <TrustRow icon={ShieldCheckMarkIcon} label={t("dashboard.onboarding.trustListItem1")} />
            <TrustRow icon={CalendarTimeIcon} label={t("dashboard.onboarding.trustListItem2")} />
            <TrustRow icon={ShieldCheckMarkIcon} label={t("dashboard.onboarding.trustListItem3")} />
            <TrustRow icon={ShieldCheckMarkIcon} label={t("dashboard.onboarding.trustListItem4")} />
            <TrustRow icon={ShieldCheckMarkIcon} label={t("dashboard.onboarding.trustListItem5")} />
            <TrustRow icon={ShieldCheckMarkIcon} label={t("dashboard.onboarding.trustListItem6")} />
          </BlockStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={ShieldCheckMarkIcon} tone="success" />
            <Text as="h3" variant="headingMd">
              {t("dashboard.onboarding.safetyTitle")}
            </Text>
          </InlineStack>
          <Text as="p" tone="subdued">
            {t("dashboard.onboarding.safetySubtitle")}
          </Text>
          <List type="bullet">
            <List.Item>{t("dashboard.onboarding.safetyItem1")}</List.Item>
            <List.Item>{t("dashboard.onboarding.safetyItem2")}</List.Item>
            <List.Item>{t("dashboard.onboarding.safetyItem3")}</List.Item>
            <List.Item>{t("dashboard.onboarding.safetyItem4")}</List.Item>
            <List.Item>{t("dashboard.onboarding.safetyItem5")}</List.Item>
          </List>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd">
            {t("dashboard.onboarding.progressTitle")}
          </Text>
          <Text as="p" tone="subdued">
            {t("dashboard.onboarding.progressSubtitle")}
          </Text>
          <BlockStack gap="200">
            <ProgressRow label={t("dashboard.onboarding.stepCreateRule")} completed={progress.hasRule} />
            <ProgressRow label={t("dashboard.onboarding.stepPreview")} completed={progress.hasPreviewed} />
            <ProgressRow label={t("dashboard.onboarding.stepApplyStart")} completed={progress.hasApplied} />
            <ProgressRow label={t("dashboard.onboarding.stepSchedule")} completed={progress.hasScheduled} />
            <ProgressRow label={t("dashboard.onboarding.stepComplete")} completed={progress.hasCompletedFirstUpdate} />
          </BlockStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="150">
          <Text as="h3" variant="headingMd">
            {t("dashboard.onboarding.socialProofTitle")}
          </Text>
          <Text as="p" tone="subdued">
            {t("dashboard.onboarding.socialProofSubtitle")}
          </Text>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

export function FirstPricingUpdateCelebrationModal({
  open,
  onExploreScheduling,
  onClose,
}: {
  open: boolean;
  onExploreScheduling: () => void;
  onClose: () => void;
}) {
  const paragraphs = t("dashboard.celebration.body").split("\n\n");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("dashboard.celebration.title")}
      primaryAction={{
        content: t("dashboard.celebration.primary"),
        onAction: onExploreScheduling,
      }}
      secondaryActions={[
        {
          content: t("common.close"),
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="200">
          {paragraphs.map((paragraph, index) => (
            <Text key={index} as="p">
              {paragraph}
            </Text>
          ))}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

export function NextStepsCalloutCard({
  onExploreScheduling,
  onReviewCampaignHistory,
  onReviewPricingRules,
}: {
  onExploreScheduling: () => void;
  onReviewCampaignHistory: () => void;
  onReviewPricingRules: () => void;
}) {
  return (
    <CalloutCard
      title={t("dashboard.nextSteps.title")}
      primaryAction={{
        content: t("dashboard.nextSteps.primary"),
        onAction: onExploreScheduling,
      }}
      secondaryAction={{
        content: t("dashboard.nextSteps.secondary"),
        onAction: onReviewCampaignHistory,
      }}
    >
      <BlockStack gap="200">
        <Text as="p" tone="subdued">
          {t("dashboard.nextSteps.subtitle")}
        </Text>
        <List type="number">
          <List.Item>{t("dashboard.nextSteps.item1")}</List.Item>
          <List.Item>{t("dashboard.nextSteps.item2")}</List.Item>
          <List.Item>{t("dashboard.nextSteps.item3")}</List.Item>
          <List.Item>{t("dashboard.nextSteps.item4")}</List.Item>
        </List>
        <InlineStack gap="200" wrap>
          <Button variant="tertiary" onClick={onReviewPricingRules}>
            {t("dashboard.nextSteps.rules")}
          </Button>
        </InlineStack>
      </BlockStack>
    </CalloutCard>
  );
}

export function ReviewRequestCard({
  onDismiss,
  onPrimary,
}: {
  onDismiss: () => void;
  onPrimary: () => void;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h3" variant="headingMd">
          {t("dashboard.review.title")}
        </Text>
        <Text as="p" tone="subdued">
          {t("dashboard.review.body")}
        </Text>
        <InlineStack gap="200" wrap>
          <Button variant="primary" onClick={onPrimary}>
            {t("dashboard.review.primary")}
          </Button>
          <Button variant="tertiary" onClick={onDismiss}>
            {t("dashboard.review.secondary")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
