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

export default function HelpPage() {
  const navigate = useNavigate();

  return (
    <Page
      title="Help & User Guide"
      backAction={{ onAction: () => navigate("/app") }}
      fullWidth
    >
      <div style={{ maxWidth: "980px", margin: "0 auto" }}>
        <BlockStack gap="500">

          <Banner tone="info" title="Quick Overview">
            Preview upcoming prices, apply catalog updates instantly, schedule future campaigns, or enable dynamic live storefront pricing.
          </Banner>

          <Text as="h2" variant="headingLg">
            Core Workflow
          </Text>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Recommended Workflow
              </Text>

              <Text as="p" tone="subdued">
                A safe and predictable workflow for managing pricing updates.
              </Text>

              <Divider />

              <List type="number">
                <List.Item>
                  <strong>Configure pricing rules:</strong> Set markup, rounding, and charm pricing in Pricing Rules.
                </List.Item>

                <List.Item>
                  <strong>Refresh previews:</strong> Load the latest calculated prices on the Dashboard.
                </List.Item>

                <List.Item>
                  <strong>Review changes:</strong> Compare Current vs Textbox before applying updates.
                </List.Item>

                <List.Item>
                  <strong>Apply now or Schedule for later:</strong> Apply updates Shopify immediately or schedule automated campaigns.
                </List.Item>

                <List.Item>
                  <strong>Undo if needed:</strong> Restore previous prices after bulk updates.
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Understanding Current vs Textbox
              </Text>

              <Text as="p" tone="subdued">
                These values work together to help you review pricing changes clearly.
              </Text>

              <Divider />

              <InlineStack gap="200" wrap>
                <Badge tone="info">Current</Badge>

                <Text as="p">
                  Your current live product price.
                </Text>
              </InlineStack>

              <InlineStack gap="200" wrap>
                <Badge tone="success">Textbox</Badge>

                <Text as="p">
                  Your next calculated preview price based on pricing rules or manual input.
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>

          <Layout>
            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    Apply Updates
                  </Text>

                  <Text as="p" tone="subdued">
                    Apply updates Shopify immediately across your catalog.
                  </Text>

                  <Divider />

                  <List>
                    <List.Item>
                      <strong>Apply All</strong> updates every item in the preview list.
                    </List.Item>

                    <List.Item>
                      <strong>Apply Selected</strong> updates only checked products.
                    </List.Item>

                    <List.Item>
                      <strong>Filtered workflow</strong> applies updates to filtered results.
                    </List.Item>

                    <List.Item>
                      <strong>Collection</strong> applies updates to a selected collection.
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    Live Pricing
                  </Text>

                  <Text as="p" tone="subdued">
                    Dynamically adjusts storefront display prices without modifying catalog values.
                  </Text>

                  <Divider />

                  <List>
                    <List.Item>
                      Live Pricing affects storefront display only.
                    </List.Item>

                    <List.Item>
                      Apply permanently updates catalog prices.
                    </List.Item>

                    <List.Item>
                      Live Pricing rules may layer on top of applied catalog prices.
                    </List.Item>
                  </List>

                  <Banner tone="info">
                    If you want your applied catalog value to remain the final customer-facing price, keep Live Pricing disabled or reduce Live Pricing rules to 0%.
                  </Banner>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Manual Overrides
              </Text>

              <Text as="p" tone="subdued">
                Manual input is designed for one-time pricing overrides.
              </Text>

              <Divider />

              <List>
                <List.Item>
                  Typing a custom value temporarily overrides the calculated preview for that product.
                </List.Item>

                <List.Item>
                  When applied, Shopify receives your exact manual value without additional pricing adjustments.
                </List.Item>

                <List.Item>
                  After apply, pricing rules resume using the newly updated product price as the baseline.
                </List.Item>

                <List.Item>
                  Use Reset to restore pricing-rule control before applying.
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          <Text as="h2" variant="headingLg">
            Automation & Safety
          </Text>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Scheduling
              </Text>

              <Text as="p" tone="subdued">
                Create automated pricing campaigns that run later without manual intervention.
              </Text>

              <Divider />

              <List>
                <List.Item>
                  Scheduling automatically stages and publishes pricing updates.
                </List.Item>

                <List.Item>
                  You no longer need to Apply before scheduling.
                </List.Item>

                <List.Item>
                  Schedule History tracks campaigns and included products.
                </List.Item>

                <List.Item>
                  Ideal for promotions, launch events, and timed campaigns.
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={ShieldCheckMarkIcon} tone="success" />

                <Text as="h2" variant="headingMd">
                  Safety & Recovery
                </Text>
              </InlineStack>

              <Text as="p" tone="subdued">
                All pricing actions are designed to be reviewable and recoverable.
              </Text>

              <Divider />

              <List>
                <List.Item>
                  <strong>Preview first:</strong> Review calculated changes before applying.
                </List.Item>

                <List.Item>
                  <strong>Undo:</strong> Restore previous prices after bulk updates.
                </List.Item>

                <List.Item>
                  <strong>History:</strong> Original prices are stored securely for rollback and audit purposes.
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Pricing Rules Basics
              </Text>

              <Text as="p" tone="subdued">
                Preview prices are calculated from your current live product prices.
              </Text>

              <Divider />

              <List>
                <List.Item>
                  <strong>Markup:</strong> Percentage increase or decrease.
                </List.Item>

                <List.Item>
                  <strong>Rounding:</strong> Set consistent decimal endings.
                </List.Item>

                <List.Item>
                  <strong>Charm Pricing:</strong> Common endings like .99 when enabled.
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          <Banner tone="success">
            Refresh previews after updating pricing rules so the dashboard reflects your latest calculations.
          </Banner>

        </BlockStack>
      </div>
    </Page>
  );
}