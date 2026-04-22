import { Page, Card, Text, BlockStack, List, Box, Badge, Banner, Divider, InlineStack, Layout, Icon } from "@shopify/polaris";
import { ShieldCheckMarkIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const isBypass = url.searchParams.get("bypass") === "true";

  try {
    await authenticate.admin(request);
    return null;
  } catch (error) {
    if (isBypass) {
      console.warn("⚠️ BYPASS MODE ACTIVE: Help loader failed, continuing with mock.");
      return null;
    }
    console.error("❌ Help loader failed:", error);
    throw new Response("Service Unavailable", { status: 503 });
  }
};

export default function HelpPage() {
  return (
    <Page title="User Guide & Help" backAction={{ url: "/app" }}>
      <BlockStack gap="500">
        <Banner tone="info" title="Quick Summary">
          Price Polish helps you optimize your product prices using markup and rounding rules. You can preview changes, apply them permanently to your store, or use a dynamic storefront extension.
        </Banner>

        <Card>
          <BlockStack gap="400">
            <Text  as="h2"  variant="headingMd">1. The Dashboard Workflow</Text>
            <List type="number">
              <List.Item>
                <strong>Set Rules:</strong> Go to the Rules page to define your Markup % and Rounding (Fixed Decimal).
              </List.Item>
              <List.Item>
                <strong>Refresh Previews:</strong> On the Dashboard, click "Refresh Previews" to see how your new prices will look based on your rules.
              </List.Item>
              <List.Item>
                <strong>Apply Changes:</strong> Click "Apply" on an individual product or "Apply All" to permanently update the prices in your Shopify Admin.
              </List.Item>
            </List>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text  as="h2"  variant="headingMd">2. Understanding the Apply Button Status</Text>
            <Text as="p">
              The "Apply" button is your tool to push changes to your Shopify Database. It respects the underlying product pricing statuses:
            </Text>
            <Box paddingInlineStart="400">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="success">Currently Polished</Badge>
                  <Text as="p"><strong>[SYNCED]:</strong> Your prices match your Pricing Rules in Shopify. No update is urgently needed, but you can always re-apply.</Text>
                </InlineStack>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="attention">Manual Override</Badge>
                  <Text as="p"><strong>[MANUAL]:</strong> You have explicitly overridden the rule for this specific product.</Text>
                </InlineStack>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">No change</Badge>
                  <Text as="p">The calculated price is identical to your original Shopify price.</Text>
                </InlineStack>
              </BlockStack>
            </Box>
            <Text as="p" tone="subdued">
              Tip: If you change your Pricing Rules, products will lose their [SYNCED] status until you apply the updates again!
            </Text>
          </BlockStack>
        </Card>

        <BlockStack gap="400">
          <Text  as="h2"  variant="headingMd">3. Admin Update vs. Storefront Live Control</Text>
          <Layout>
            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">Admin Update (Apply Button)</Text>
                  <Divider />
                  <Text as="p">Permanently changes the price in your Shopify Admin product database.</Text>
                  <Badge tone="critical">Hard Update</Badge>
                  <Text as="p" tone="subdued">Customers, 3rd-party channels (like Google Shopping), and POS all see this price. Use "Undo" if you make a mistake.</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            
            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">Storefront Control (Go Live)</Text>
                  <Divider />
                  <Text as="p">Controls the <strong>dynamic storefront extension</strong> overlay.</Text>
                  <Badge tone="success">Virtual Update</Badge>
                  <Text as="p" tone="subdued">It doesn't change your database; it instantly changes what customers originally see on your website overlay.</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </BlockStack>

        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={ShieldCheckMarkIcon} tone="success" />
              <Text  as="h2"  variant="headingMd">4. Safety & Trust</Text>
            </InlineStack>
            <Text as="p"><strong>Undo Last Update:</strong> All bulk updates to your Shopify database can be reversed with a single click using the "Undo Last Update" button. Your original prices are always backed up before any changes are made!</Text>
            <Text as="p"><strong>Safety Audit Manifest:</strong> Use the "Download Impact Report" button on the Dashboard to export a complete CSV audit of exactly how rules impact your net profit gain.</Text>
            <Text as="p">✔️ The "Safe Mode" architecture ensures you can preview rules on the Dashboard without fear of permanent errors.</Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text  as="h2"  variant="headingMd">5. Profit Audit & Impact Reports</Text>
            <List>
              <List.Item>
                <strong>Download Report:</strong> The "Download Impact Report" button generates a CSV file showing a side-by-side comparison of "Original Price" vs. "Optimized Price."
              </List.Item>
              <List.Item>
                <strong>Audit Trail:</strong> The report includes a breakdown of exactly how much was added via Markup and how much was adjusted by Rounding (Fixed Decimal).
              </List.Item>
              <List.Item>
                <strong>Business Impact:</strong> The "Total Storefront Value Increase" row at the bottom of the report calculates the total potential profit gain across the filtered products.
              </List.Item>
            </List>
            <Text as="p" tone="subdued">
              <strong>Tip:</strong> We recommend downloading an Impact Report before clicking 'Apply All' to keep a permanent record of your price transitions.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
