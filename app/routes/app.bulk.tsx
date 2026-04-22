import { useState, useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import {
    Page,
    Card,
    Text,
    BlockStack,
    Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface BulkEditorData {
    hasRules: boolean;
    error?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const isBypass = url.searchParams.get("bypass") === "true";

    try {
        const { session } = await authenticate.admin(request);

        const rule = await prisma.pricingRule.findUnique({
            where: { shop: session.shop },
        });

        return { hasRules: !!rule };
    } catch (error: any) {
        if (isBypass) {
            console.warn("⚠️ BYPASS MODE ACTIVE: Bulk loader failed, returning mock data.");
            return { hasRules: true, isBypass: true };
        }
        console.error("❌ Bulk Editor Loader Error:", error);
        
        if (error?.code === 'P2021' || error?.message?.includes("does not exist")) {
            return { hasRules: false, error: "Database table not found. Please run migrations." };
        }
        return { hasRules: false, error: "Failed to load pricing rules." };
    }
};

export default function BulkEditorPage() {
    const { hasRules, error } = useLoaderData<BulkEditorData>();
    const navigate = useNavigate();

    return (
        <Page title="Bulk Editor" backAction={{ onAction: () => navigate("/app") }}>
            <BlockStack gap="500">
                {error && (
                    <Banner tone="critical">
                        <p>{error}</p>
                    </Banner>
                )}

                {!hasRules && !error && (
                    <Banner title="No pricing rules found" tone="warning">
                        <p>The bulk editor requires at least one pricing rule to be configured. Please go to the <strong>Pricing Rules</strong> page to create your first rule.</p>
                    </Banner>
                )}

                {hasRules && (
                    <Card>
                        <BlockStack gap="300">
                            <Text  as="h2"  variant="headingLg">
                                Bulk Price Editor
                            </Text>
                            <Text as="p" variant="bodyMd">
                                This feature is under development. Once complete, you will be able to manually edit product prices in bulk using your configured pricing rules.
                            </Text>
                        </BlockStack>
                    </Card>
                )}
            </BlockStack>
        </Page>
    );
}
