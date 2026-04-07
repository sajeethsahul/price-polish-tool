import { Page, Card, Text, BlockStack } from "@shopify/polaris";
import { useNavigate } from "react-router";

export default function SettingsPage() {
    const navigate = useNavigate();
    return (
        <Page title="Advanced Settings" backAction={{ onAction: () => navigate("/app") }}>
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
