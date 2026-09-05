import { Page, Card, Text, BlockStack, Icon } from "@shopify/polaris";
import { SettingsIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router";
import { t } from "../utils/i18n";

export default function SettingsPage() {
    const navigate = useNavigate();
    return (
        <Page
            title={t("settings.page.title")}
            titleMetadata={<Icon source={SettingsIcon} tone="base" />}
            backAction={{ onAction: () => navigate("/app") }}
        >
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
