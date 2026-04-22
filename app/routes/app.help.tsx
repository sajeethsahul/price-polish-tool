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

export default function HelpPage() {
  return (
    <Page title="User Guide & Help" backAction={{ url: "/app" }} fullWidth>
      <Box maxWidth="1000px" marginInline="auto">
        <BlockStack gap="400">

          {/* 🔥 SUMMARY */}
          <Banner tone="info" title="Quick Summary">
            Price Polish helps you optimize product prices using markup and smart rounding.
            You can preview changes safely, apply them permanently, or control storefront pricing dynamically.
          </Banner>

          {/* 🔥 WORKFLOW */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">1. Dashboard Workflow</Text>
              <List type="number">
                <List.Item>
                  <strong>Set Rules:</strong> Configure Markup %, Rounding, and Charm Pricing.
                </List.Item>
                <List.Item>
                  <strong>Refresh Previews:</strong> See calculated prices before applying.
                </List.Item>
                <List.Item>
                  <strong>Apply Changes:</strong> Update Shopify prices permanently.
                </List.Item>
                <List.Item>
                  <strong>Apply Modes:</strong> Apply to All, Selected, Filtered, or Collection.
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          {/* 🔥 STATUS */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">2. Apply Button Status</Text>

              <InlineStack gap="300">
                <Badge tone="success">[SYNCED]</Badge>
                <Text>Your product matches pricing rules</Text>
              </InlineStack>

              <InlineStack gap="300">
                <Badge tone="attention">[MANUAL]</Badge>
                <Text>Manually overridden price</Text>
              </InlineStack>

              <InlineStack gap="300">
                <Badge tone="info">No Change</Badge>
                <Text>Calculated price equals original</Text>
              </InlineStack>

              <Text tone="subdued">
                Tip: Updating rules resets SYNCED status until re-applied.
              </Text>
            </BlockStack>
          </Card>

          {/* 🔥 ADMIN vs LIVE */}
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm">Admin Update</Text>
                  <Badge tone="critical">Hard Update</Badge>
                  <Text tone="subdued">
                    Permanently updates Shopify database. All channels reflect this.
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm">Storefront Live Control</Text>
                  <Badge tone="success">Virtual Update</Badge>
                  <Text tone="subdued">
                    Changes storefront display only. Database remains unchanged.
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          {/* 🔥 SCHEDULING */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">3. Scheduling Pricing</Text>
              <Text>
                Schedule pricing updates to run automatically at a specific time.
              </Text>
              <List>
                <List.Item>Select date & time</List.Item>
                <List.Item>Click "Schedule Pricing"</List.Item>
                <List.Item>System applies rules automatically</List.Item>
              </List>
              <Text tone="subdued">
                Ideal for promotions, peak hours, or timed campaigns.
              </Text>
            </BlockStack>
          </Card>

          {/* 🔥 SAFETY */}
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={ShieldCheckMarkIcon} tone="success" />
                <Text as="h2" variant="headingMd">4. Safety & Trust</Text>
              </InlineStack>

              <Text>
                <strong>Undo Last Update:</strong> Instantly revert bulk changes.
              </Text>

              <Text>
                <strong>Safe Mode:</strong> Preview changes before applying.
              </Text>

              <Text>
                Your original prices are always backed up.
              </Text>
            </BlockStack>
          </Card>

          {/* 🔥 IMPACT */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">5. Impact & Profit Insights</Text>

              <List>
                <List.Item>
                  <strong>Impact Preview:</strong> See estimated revenue gain before applying
                </List.Item>
                <List.Item>
                  <strong>Download Report:</strong> CSV with price comparison
                </List.Item>
                <List.Item>
                  <strong>Audit Trail:</strong> Includes markup & rounding breakdown
                </List.Item>
              </List>

              <Text tone="subdued">
                Tip: Always export report before bulk updates.
              </Text>
            </BlockStack>
          </Card>

          {/* 🔥 RELIABILITY */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">6. Bulk Processing</Text>

              <List>
                <List.Item>Real-time progress tracking</List.Item>
                <List.Item>Retry failed updates only</List.Item>
                <List.Item>Safe batch processing system</List.Item>
              </List>
            </BlockStack>
          </Card>

          {/* 🔥 PRICING LOGIC */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">7. Pricing Logic</Text>

              <List>
                <List.Item>
                  <strong>Markup:</strong> Percentage increase/decrease
                </List.Item>
                <List.Item>
                  <strong>Rounding:</strong> Set decimal endings (e.g., .55)
                </List.Item>
                <List.Item>
                  <strong>Charm Pricing:</strong> Ends prices in .99
                </List.Item>
              </List>
            </BlockStack>
          </Card>

        </BlockStack>
      </Box>
    </Page>
  );
}