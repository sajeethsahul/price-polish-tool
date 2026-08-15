import {
  Page,
  Card,
  Text,
  BlockStack,
  List,
  Box,
  Badge,
  Banner,
  Divider,
  InlineStack,
  Layout,
  Icon,
} from "@shopify/polaris";
import { ShieldCheckMarkIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

export default function HelpPage() {
  const navigate = useNavigate();
  const { t } = useTranslation(["help", "common"]);

  return (
    <Page
      title={t("help:page.title")}
      backAction={{ onAction: () => navigate("/app") }}
      fullWidth
    >
      <div style={{ maxWidth: "980px", margin: "0 auto" }}>
        <BlockStack gap="500">

          <Banner tone="info" title={t("help:section.quickOverview")}>
            {t("help:banner.intro")}
          </Banner>

          <Text as="h2" variant="headingLg">
            {t("help:section.coreWorkflow")}
          </Text>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:section.recommendedWorkflow")}
              </Text>

              <Text as="p" tone="subdued">
                {t("help:desc.recommendedWorkflow")}
              </Text>

              <Divider />

              <List type="number">
                <List.Item>
                  <strong>{t("help:workflow.step1_label")}</strong>{" "}
                  {t("help:workflow.step1_desc")}
                </List.Item>

                <List.Item>
                  <strong>{t("help:workflow.step2_label")}</strong>{" "}
                  {t("help:workflow.step2_desc")}
                </List.Item>

                <List.Item>
                  <strong>{t("help:workflow.step3_label")}</strong>{" "}
                  {t("help:workflow.step3_desc")}
                </List.Item>

                <List.Item>
                  <strong>{t("help:workflow.step4_label")}</strong>{" "}
                  {t("help:workflow.step4_desc")}
                </List.Item>

                <List.Item>
                  <strong>{t("help:workflow.step5_label")}</strong>{" "}
                  {t("help:workflow.step5_desc")}
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:section.currentVsTextbox")}
              </Text>

              <Text as="p" tone="subdued">
                {t("help:desc.currentVsTextbox")}
              </Text>

              <Divider />

              <InlineStack gap="200" wrap>
                <Badge tone="info">{t("help:labels.current")}</Badge>

                <Text as="p">
                  {t("help:currentVsTextbox.current_desc")}
                </Text>
              </InlineStack>

              <InlineStack gap="200" wrap>
                <Badge tone="success">{t("help:labels.textbox")}</Badge>

                <Text as="p">
                  {t("help:currentVsTextbox.textbox_desc")}
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>

          <Layout>
            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    {t("help:section.applyUpdates")}
                  </Text>

                  <Text as="p" tone="subdued">
                    {t("help:desc.applyUpdates")}
                  </Text>

                  <Divider />

                  <List>
                    <List.Item>
                      <strong>{t("help:labels.applyAll")}</strong>{" "}
                      {t("help:applyUpdates.all_desc")}
                    </List.Item>

                    <List.Item>
                      <strong>{t("help:labels.applySelected")}</strong>{" "}
                      {t("help:applyUpdates.selected_desc")}
                    </List.Item>

                    <List.Item>
                      <strong>{t("help:labels.filteredWorkflow")}</strong>{" "}
                      {t("help:applyUpdates.filtered_desc")}
                    </List.Item>

                    <List.Item>
                      <strong>{t("help:labels.collection")}</strong>{" "}
                      {t("help:applyUpdates.collection_desc")}
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    {t("help:section.livePricing")}
                  </Text>

                  <Text as="p" tone="subdued">
                    {t("help:desc.livePricing")}
                  </Text>

                  <Divider />

                  <List>
                    <List.Item>
                      {t("help:livePricing.point1")}
                    </List.Item>

                    <List.Item>
                      {t("help:livePricing.point2")}
                    </List.Item>

                    <List.Item>
                      {t("help:livePricing.point3")}
                    </List.Item>
                  </List>

                  <Banner tone="info">
                    {t("help:banner.livePricingTip")}
                  </Banner>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:section.manualOverrides")}
              </Text>

              <Text as="p" tone="subdued">
                {t("help:desc.manualOverrides")}
              </Text>

              <Divider />

              <List>
                <List.Item>
                  {t("help:manualOverrides.point1")}
                </List.Item>

                <List.Item>
                  {t("help:manualOverrides.point2")}
                </List.Item>

                <List.Item>
                  {t("help:manualOverrides.point3")}
                </List.Item>

                <List.Item>
                  {t("help:manualOverrides.point4")}
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          <Text as="h2" variant="headingLg">
            {t("help:section.automationSafety")}
          </Text>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:section.scheduling")}
              </Text>

              <Text as="p" tone="subdued">
                {t("help:desc.scheduling")}
              </Text>

              <Divider />

              <List>
                <List.Item>
                  {t("help:scheduling.point1")}
                </List.Item>

                <List.Item>
                  {t("help:scheduling.point2")}
                </List.Item>

                <List.Item>
                  {t("help:scheduling.point3")}
                </List.Item>

                <List.Item>
                  {t("help:scheduling.point4")}
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={ShieldCheckMarkIcon} tone="success" />

                <Text as="h2" variant="headingMd">
                  {t("help:section.safetyRecovery")}
                </Text>
              </InlineStack>

              <Text as="p" tone="subdued">
                {t("help:desc.safetyRecovery")}
              </Text>

              <Divider />

              <List>
                <List.Item>
                  <strong>{t("help:safety.step1_label")}</strong>{" "}
                  {t("help:safety.step1_desc")}
                </List.Item>

                <List.Item>
                  <strong>{t("help:safety.step2_label")}</strong>{" "}
                  {t("help:safety.step2_desc")}
                </List.Item>

                <List.Item>
                  <strong>{t("help:safety.step3_label")}</strong>{" "}
                  {t("help:safety.step3_desc")}
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("help:section.pricingRulesBasics")}
              </Text>

              <Text as="p" tone="subdued">
                {t("help:desc.pricingRulesBasics")}
              </Text>

              <Divider />

              <List>
                <List.Item>
                  <strong>{t("help:pricingRules.markup_label")}</strong>{" "}
                  {t("help:pricingRules.markup_desc")}
                </List.Item>

                <List.Item>
                  <strong>{t("help:pricingRules.rounding_label")}</strong>{" "}
                  {t("help:pricingRules.rounding_desc")}
                </List.Item>

                <List.Item>
                  <strong>{t("help:pricingRules.charm_label")}</strong>{" "}
                  {t("help:pricingRules.charm_desc")}
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          <Banner tone="success">
            {t("help:banner.refreshTip")}
          </Banner>

        </BlockStack>
      </div>
    </Page>
  );
}