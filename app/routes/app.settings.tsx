import {
    Page,
    Card,
    Text,
    BlockStack,
} from "@shopify/polaris";

export default function SettingsPage() {
    return (
        <Page title="Settings" backAction={{ url: "/app" }}>
            <BlockStack gap="500">
                <Card>
                    <BlockStack gap="300">
                        <Text as="h2" variant="headingLg">
                            App Settings
                        </Text>
                        <Text as="p" variant="bodyMd">
                            Settings configuration will be available in a future update.
                            Use the Pricing Rules page to configure your pricing strategy.
                        </Text>
                    </BlockStack>
                </Card>

                <Card>
                    <BlockStack gap="300">
                        <Text as="h3" variant="headingMd">
                            About Price Polish
                        </Text>
                        <Text as="p" variant="bodyMd">
                            Price Polish helps you optimize product pricing with smart markup,
                            rounding, and charm pricing rules. Preview changes on the
                            dashboard before applying them to your store.
                        </Text>
                    </BlockStack>
                </Card>
            </BlockStack>
        </Page>
    );
}
