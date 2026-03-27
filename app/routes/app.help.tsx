import { Page, Card, Text, BlockStack, List, Box, Badge, Banner, Divider, InlineStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
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
            <Text as="h2" variant="headingMd">1. The Dashboard Workflow</Text>
            <List type="number">
              <List.Item>
                <strong>Set Rules:</strong> Go to the Rules page to define your Markup % and Rounding Step.
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
            <Text as="h2" variant="headingMd">2. Why is the "Apply" button disabled?</Text>
            <Text as="p">
              The "Apply" button is only active when there is a difference between your <strong>Current Price</strong> and the <strong>Optimized Price</strong>.
            </Text>
            <Box paddingInlineStart="400">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">No change</Badge>
                  <Text as="p">If the prices are identical, the button is disabled because there is nothing to update.</Text>
                </InlineStack>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="success">Profit Optimized</Badge>
                  <Text as="p">Once you click Apply, the product's price is updated in Shopify. The button then becomes disabled because the prices are now perfectly synced.</Text>
                </InlineStack>
              </BlockStack>
            </Box>
            <Text as="p" tone="subdued">
              Tip: If you change your Pricing Rules again, the buttons will become active once more to match your new strategy!
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">3. Admin Update vs. Storefront Live Control</Text>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Admin Update (Apply Button)</Text>
              <Text as="p">
                This permanently changes the price in your Shopify Admin product database. This is a <strong>hard update</strong>. Use the "Undo" button if you make a mistake.
              </Text>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Storefront Control Panel (Go Live / Stop Live)</Text>
              <Text as="p">
                This controls the <strong>dynamic storefront extension</strong>. It doesn't change your database; it only changes what customers see on your website.
              </Text>
              <List>
                <List.Item><strong>Go Live:</strong> Customers see optimized prices instantly.</List.Item>
                <List.Item><strong>Stop Live:</strong> Customers see original prices instantly.</List.Item>
              </List>
            </BlockStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">4. Safety & Trust</Text>
            <Text as="p">✔️ All bulk updates can be undone with a single click using the "Undo Last Update" button.</Text>
            <Text as="p">✔️ Your original prices are always backed up before any changes are made.</Text>
            <Text as="p">✔️ The "Safe Mode" banner ensures you can test rules without fear of permanent errors.</Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
