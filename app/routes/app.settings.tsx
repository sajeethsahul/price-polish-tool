import { Page, Card, Text, BlockStack } from "@shopify/polaris";
import { useNavigate } from "react-router";
import { t } from "../utils/i18n";

export default function SettingsPage() {
    const navigate = useNavigate();
    return (
        <Page title={t("settings.page.title")} backAction={{ onAction: () => navigate("/app") }}>
            <Card>
                <BlockStack gap="400">
                    <Text as="p" variant="bodyMd">                        
                        {t("settings.page.description")}
                    </Text>
                </BlockStack>
            </Card>
        </Page>
    );
}
