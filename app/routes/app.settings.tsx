import { Page, Card, Text, BlockStack } from "@shopify/polaris";

export default function SettingsPage() {
    return (
        <Page title="Advanced Settings" backAction={{ url: "/app" }}>
            <Card>
                <BlockStack gap="400">
                    <Text as="p" variant="bodyMd">
                        Price Polish automatically uses your Shopify store currency. Advanced settings coming soon.
                    </Text>
                </BlockStack>
            </Card>
        </Page>
    );
}
