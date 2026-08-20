import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  Banner,
  BlockStack,
  InlineStack,
  List,
  Divider,
  Box,
  Icon,
  CalloutCard,
  Collapsible,
  Button,
} from "@shopify/polaris";
import { ShieldCheckMarkIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

export default function HelpPage() {
  const navigate = useNavigate();
  const { t } = useTranslation(["help", "common"]);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);

  return (
    <Page
      title={t("help:page.title")}
      backAction={{ onAction: () => navigate("/app") }}
      fullWidth
    >
      <div style={{ maxWidth: "980px", margin: "0 auto" }}>
        <BlockStack gap="500">
          {/* SECTION 38 — Price Polish in One Sentence */}
          <Banner tone="info" title={t("help:section38.title")}>
            {t("help:section38.desc")}
          </Banner>

          {/* SECTION A — Hero Banner */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:sectionA.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:sectionA.desc")}
              </Text>
              <Divider />
              <Text as="p" fontWeight="semibold">
                {t("help:sectionA.workflow")}
              </Text>
            </BlockStack>
          </Card>

          {/* SECTION B — Getting Started */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:sectionB.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:sectionB.subtitle")}
              </Text>
              <Divider />
              <List type="number">
                <List.Item>{t("help:sectionB.step1")}</List.Item>
                <List.Item>{t("help:sectionB.step2")}</List.Item>
                <List.Item>{t("help:sectionB.step3")}</List.Item>
                <List.Item>{t("help:sectionB.step4")}</List.Item>
                <List.Item>{t("help:sectionB.step5")}</List.Item>
                <List.Item>{t("help:sectionB.step6")}</List.Item>
              </List>
            </BlockStack>
          </Card>

          {/* SECTION C — Core Workflow */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:sectionC.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:sectionC.subtitle")}
              </Text>
              <Divider />
              <List type="number">
                <List.Item>
                  <strong>{t("help:sectionC.step1_label")}</strong>{" "}
                  {t("help:sectionC.step1_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionC.step2_label")}</strong>{" "}
                  {t("help:sectionC.step2_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionC.step3_label")}</strong>{" "}
                  {t("help:sectionC.step3_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionC.step4_label")}</strong>{" "}
                  {t("help:sectionC.step4_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionC.step5_label")}</strong>{" "}
                  {t("help:sectionC.step5_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionC.step6_label")}</strong>{" "}
                  {t("help:sectionC.step6_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionC.step7_label")}</strong>{" "}
                  {t("help:sectionC.step7_desc")}
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          {/* SECTION D — Pricing Rules (3 cards in a grid) */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:sectionD.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:sectionD.subtitle")}
              </Text>
              <Divider />
              <Layout>
                <Layout.Section variant="oneThird">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        {t("help:sectionD.markup_title")}
                      </Text>
                      <Text as="p" tone="subdued">
                        {t("help:sectionD.markup_desc")}
                      </Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneThird">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        {t("help:sectionD.rounding_title")}
                      </Text>
                      <Text as="p" tone="subdued">
                        {t("help:sectionD.rounding_desc")}
                      </Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneThird">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        {t("help:sectionD.charm_title")}
                      </Text>
                      <Text as="p" tone="subdued">
                        {t("help:sectionD.charm_desc")}
                      </Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>
            </BlockStack>
          </Card>

          {/* SECTION E — Preview & Product Grid */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:sectionE.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:sectionE.subtitle")}
              </Text>
              <Divider />
              <List>
                <List.Item>
                  <strong>{t("help:sectionE.preview_label")}</strong>{" "}
                  {t("help:sectionE.preview_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionE.grid_label")}</strong>{" "}
                  {t("help:sectionE.grid_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionE.override_label")}</strong>{" "}
                  {t("help:sectionE.override_desc")}
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          {/* SECTION F — Apply Pricing */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:sectionF.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:sectionF.subtitle")}
              </Text>
              <Divider />
              <List>
                <List.Item>
                  <strong>{t("help:sectionF.applyAll_label")}</strong>{" "}
                  {t("help:sectionF.applyAll_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionF.applySelected_label")}</strong>{" "}
                  {t("help:sectionF.applySelected_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionF.undo_label")}</strong>{" "}
                  {t("help:sectionF.undo_desc")}
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          {/* SECTION 37 — Processing caution */}
          <Banner tone="warning" title={t("help:section37.title")}>
            {t("help:section37.desc")}
          </Banner>

          {/* SECTION 10 — Processing */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:section10.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:section10.subtitle")}
              </Text>
              <Divider />
              <List>
                <List.Item>{t("help:section10.point1")}</List.Item>
                <List.Item>{t("help:section10.point2")}</List.Item>
              </List>
            </BlockStack>
          </Card>

          {/* SECTION 35 — Go Live vs Apply distinction */}
          <Banner tone="warning" title={t("help:section35.title")}>
            {t("help:section35.desc")}
          </Banner>

          {/* SECTION G — Storefront Control */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:sectionG.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:sectionG.subtitle")}
              </Text>
              <Divider />
              <List>
                <List.Item>
                  <strong>{t("help:sectionG.goLive_label")}</strong>{" "}
                  {t("help:sectionG.goLive_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionG.stopLive_label")}</strong>{" "}
                  {t("help:sectionG.stopLive_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionG.apply_label")}</strong>{" "}
                  {t("help:sectionG.apply_desc")}
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          {/* SECTION H — Scheduling & Campaigns */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:sectionH.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:sectionH.subtitle")}
              </Text>
              <Divider />
              <List>
                <List.Item>
                  <strong>{t("help:sectionH.schedule_label")}</strong>{" "}
                  {t("help:sectionH.schedule_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionH.window_label")}</strong>{" "}
                  {t("help:sectionH.window_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionH.conflicts_label")}</strong>{" "}
                  {t("help:sectionH.conflicts_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionH.history_label")}</strong>{" "}
                  {t("help:sectionH.history_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionH.detail_label")}</strong>{" "}
                  {t("help:sectionH.detail_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionH.status_label")}</strong>{" "}
                  {t("help:sectionH.status_desc")}
                </List.Item>
              </List>
              <InlineStack gap="200" wrap>
                <Badge tone="info">{t("help:status.draft")}</Badge>
                <Badge tone="warning">{t("help:status.scheduled")}</Badge>
                <Badge tone="attention">{t("help:status.active")}</Badge>
                <Badge tone="info">{t("help:status.publishing")}</Badge>
                <Badge tone="success">{t("help:status.published")}</Badge>
                <Badge tone="success">{t("help:status.reverted")}</Badge>
                <Badge tone="critical">{t("help:status.failed")}</Badge>
                <Badge tone="critical">{t("help:status.unrecoverable")}</Badge>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* SECTION I — Revert & Safety */}
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={ShieldCheckMarkIcon} tone="success" />
                <Text as="h2" variant="headingMd">
                  {t("help:sectionI.title")}
                </Text>
              </InlineStack>
              <Text as="p" tone="subdued">
                {t("help:sectionI.subtitle")}
              </Text>
              <Divider />
              <List>
                <List.Item>
                  <strong>{t("help:sectionI.undo_label")}</strong>{" "}
                  {t("help:sectionI.undo_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionI.revert_label")}</strong>{" "}
                  {t("help:sectionI.revert_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionI.preview_label")}</strong>{" "}
                  {t("help:sectionI.preview_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionI.protection_label")}</strong>{" "}
                  {t("help:sectionI.protection_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionI.failures_label")}</strong>{" "}
                  {t("help:sectionI.failures_desc")}
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          {/* SECTION 31 — Safety Philosophy */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:section31.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:section31.subtitle")}
              </Text>
              <Divider />
              <List>
                <List.Item>{t("help:section31.item1")}</List.Item>
                <List.Item>{t("help:section31.item2")}</List.Item>
                <List.Item>{t("help:section31.item3")}</List.Item>
                <List.Item>{t("help:section31.item4")}</List.Item>
                <List.Item>{t("help:section31.item5")}</List.Item>
                <List.Item>{t("help:section31.item6")}</List.Item>
                <List.Item>{t("help:section31.item7")}</List.Item>
                <List.Item>{t("help:section31.item8")}</List.Item>
                <List.Item>{t("help:section31.item9")}</List.Item>
                <List.Item>{t("help:section31.item10")}</List.Item>
                <List.Item>{t("help:section31.item11")}</List.Item>
              </List>
            </BlockStack>
          </Card>

          {/* SECTION J — Quick Reference (CalloutCard per feature) */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:sectionJ.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:sectionJ.subtitle")}
              </Text>
              <Divider />
              <Layout>
                <Layout.Section variant="oneHalf">
                  <CalloutCard
                    title={t("help:sectionJ.dashboard_title")}
                    illustration=""
                    primaryAction={{
                      content: t("help:sectionJ.view"),
                      onAction: () => navigate("/app"),
                    }}
                  >
                    <Text as="p">{t("help:sectionJ.dashboard_desc")}</Text>
                  </CalloutCard>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <CalloutCard
                    title={t("help:sectionJ.rules_title")}
                    illustration=""
                    primaryAction={{
                      content: t("help:sectionJ.view"),
                      onAction: () => navigate("/app/rules"),
                    }}
                  >
                    <Text as="p">{t("help:sectionJ.rules_desc")}</Text>
                  </CalloutCard>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <CalloutCard
                    title={t("help:sectionJ.schedule_title")}
                    illustration=""
                    primaryAction={{
                      content: t("help:sectionJ.view"),
                      onAction: () => navigate("/app/schedule"),
                    }}
                  >
                    <Text as="p">{t("help:sectionJ.schedule_desc")}</Text>
                  </CalloutCard>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <CalloutCard
                    title={t("help:sectionJ.history_title")}
                    illustration=""
                    primaryAction={{
                      content: t("help:sectionJ.view"),
                      onAction: () => navigate("/app/campaign-history"),
                    }}
                  >
                    <Text as="p">{t("help:sectionJ.history_desc")}</Text>
                  </CalloutCard>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        {t("help:sectionJ.detail_title")}
                      </Text>
                      <Text as="p">{t("help:sectionJ.detail_desc")}</Text>
                      <Text as="p" tone="subdued">
                        {t("help:sectionJ.campaignDetail_note")}
                      </Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <CalloutCard
                    title={t("help:sectionJ.revert_title")}
                    illustration=""
                    primaryAction={{
                      content: t("help:sectionJ.view"),
                      onAction: () => navigate("/app/campaign-history"),
                    }}
                  >
                    <Text as="p">{t("help:sectionJ.revert_desc")}</Text>
                  </CalloutCard>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <CalloutCard
                    title={t("help:sectionJ.storefront_title")}
                    illustration=""
                    primaryAction={{
                      content: t("help:sectionJ.view"),
                      onAction: () => navigate("/app"),
                    }}
                  >
                    <Text as="p">{t("help:sectionJ.storefront_desc")}</Text>
                  </CalloutCard>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <CalloutCard
                    title={t("help:sectionJ.settings_title")}
                    illustration=""
                    primaryAction={{
                      content: t("help:sectionJ.view"),
                      onAction: () => navigate("/app/settings"),
                    }}
                  >
                    <Text as="p">{t("help:sectionJ.settings_desc")}</Text>
                  </CalloutCard>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        {t("help:sectionJ.help_title")}
                      </Text>
                      <Text as="p">{t("help:sectionJ.help_desc")}</Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <CalloutCard
                    title={t("help:sectionJ.billing_title")}
                    illustration=""
                    primaryAction={{
                      content: t("help:sectionJ.view"),
                      onAction: () => navigate("/app/billing"),
                    }}
                  >
                    <Text as="p">{t("help:sectionJ.billing_desc")}</Text>
                  </CalloutCard>
                </Layout.Section>
              </Layout>
            </BlockStack>
          </Card>

          {/* SECTION K — Recommended Workflows (Collapsible) */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:sectionK.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("help:sectionK.subtitle")}
              </Text>
              <Divider />
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Text as="h3" variant="headingSm">
                  {t("help:sectionK.workflow_title")}
                </Text>
                <Button
                  variant="tertiary"
                  onClick={() => setWorkflowOpen((open) => !open)}
                  disclosure={workflowOpen ? "up" : "down"}
                >
                  {workflowOpen
                    ? t("help:sectionK.hide")
                    : t("help:sectionK.show")}
                </Button>
              </InlineStack>
              <Collapsible open={workflowOpen} id="help-workflow">
                <Box paddingBlockStart="300">
                  <List type="number">
                    <List.Item>{t("help:sectionK.workflow_step1")}</List.Item>
                    <List.Item>{t("help:sectionK.workflow_step2")}</List.Item>
                    <List.Item>{t("help:sectionK.workflow_step3")}</List.Item>
                    <List.Item>{t("help:sectionK.workflow_step4")}</List.Item>
                    <List.Item>{t("help:sectionK.workflow_step5")}</List.Item>
                    <List.Item>{t("help:sectionK.workflow_step6")}</List.Item>
                    <List.Item>{t("help:sectionK.workflow_step7")}</List.Item>
                    <List.Item>{t("help:sectionK.workflow_step8")}</List.Item>
                    <List.Item>{t("help:sectionK.workflow_step9")}</List.Item>
                    <List.Item>{t("help:sectionK.workflow_step10")}</List.Item>
                    <List.Item>{t("help:sectionK.workflow_step11")}</List.Item>
                    <List.Item>{t("help:sectionK.workflow_step12")}</List.Item>
                  </List>
                </Box>
              </Collapsible>
              <Divider />
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Text as="h3" variant="headingSm">
                  {t("help:sectionK.promotion_title")}
                </Text>
                <Button
                  variant="tertiary"
                  onClick={() => setPromotionOpen((open) => !open)}
                  disclosure={promotionOpen ? "up" : "down"}
                >
                  {promotionOpen
                    ? t("help:sectionK.hide")
                    : t("help:sectionK.show")}
                </Button>
              </InlineStack>
              <Collapsible open={promotionOpen} id="help-promotion">
                <Box paddingBlockStart="300">
                  <List type="number">
                    <List.Item>{t("help:sectionK.promotion_step1")}</List.Item>
                    <List.Item>{t("help:sectionK.promotion_step2")}</List.Item>
                    <List.Item>{t("help:sectionK.promotion_step3")}</List.Item>
                    <List.Item>{t("help:sectionK.promotion_step4")}</List.Item>
                    <List.Item>{t("help:sectionK.promotion_step5")}</List.Item>
                    <List.Item>{t("help:sectionK.promotion_step6")}</List.Item>
                    <List.Item>{t("help:sectionK.promotion_step7")}</List.Item>
                    <List.Item>{t("help:sectionK.promotion_step8")}</List.Item>
                    <List.Item>{t("help:sectionK.promotion_step9")}</List.Item>
                    <List.Item>{t("help:sectionK.promotion_step10")}</List.Item>
                    <List.Item>{t("help:sectionK.promotion_step11")}</List.Item>
                  </List>
                </Box>
              </Collapsible>
              <Divider />
              <List>
                <List.Item>
                  <strong>{t("help:sectionK.apply_label")}</strong>{" "}
                  {t("help:sectionK.apply_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionK.schedule_label")}</strong>{" "}
                  {t("help:sectionK.schedule_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionK.window_label")}</strong>{" "}
                  {t("help:sectionK.window_desc")}
                </List.Item>
                <List.Item>
                  <strong>{t("help:sectionK.goLive_label")}</strong>{" "}
                  {t("help:sectionK.goLive_desc")}
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </BlockStack>
      </div>
    </Page>
  );
}