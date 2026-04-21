import { useState, useEffect, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
    useLoaderData,
    Form,
    useNavigation,
    useActionData,
    useOutletContext,
    useNavigate,
} from "react-router";

import {
    Page,
    Card,
    Text,
    BlockStack,
    TextField,
    Checkbox,
    Button,
    Layout,
    InlineStack,
} from "@shopify/polaris";

import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ================= TYPES =================

interface PricingRuleData {
    markupPercent: number;
    charmPricing: boolean;
    roundingStep: number;
    updatedAt?: string | null;
    saved?: boolean;
    error?: string;
    fieldErrors?: Record<string, string>;
}

// ================= LOADER =================

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);

    const rule = await prisma.pricingRule.findUnique({
        where: { shop: session.shop },
    });

    return {
        markupPercent: rule?.markupPercent ?? 10,
        charmPricing: rule?.charmPricing ?? true,
        roundingStep: rule?.roundingStep ?? 1,
        updatedAt: rule?.updatedAt ?? null,
    };
};

// ================= ACTION =================

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();

    const markupPercent = parseFloat(formData.get("markupPercent") as string);
    const roundingStep = parseFloat(formData.get("roundingStep") as string);
    const charmPricing = formData.get("charmPricing") === "true";

    const fieldErrors: Record<string, string> = {};

    if (isNaN(markupPercent) || markupPercent < -99 || markupPercent > 99) {
        fieldErrors.markupPercent = "Markup must be between -99% and +99%";
    }

    if (isNaN(roundingStep) || roundingStep < 0 || roundingStep > 100) {
        fieldErrors.roundingStep = "Rounding must be between 0 and 100";
    }

    if (Object.keys(fieldErrors).length > 0) {
        return {
            markupPercent,
            charmPricing,
            roundingStep,
            saved: false,
            fieldErrors,
        };
    }

    try {
        // ✅ Save history FIRST
        await prisma.pricingRuleHistory.create({
            data: {
                shop: session.shop,
                markupPercent,
                charmPricing,
                roundingStep,
            },
        });

        // ✅ Update main rule
        await prisma.pricingRule.upsert({
            where: { shop: session.shop },
            update: { markupPercent, charmPricing, roundingStep },
            create: {
                shop: session.shop,
                markupPercent,
                charmPricing,
                roundingStep,
            },
        });

        return {
            markupPercent,
            charmPricing,
            roundingStep,
            saved: true,
        };
    } catch (err) {
        return {
            markupPercent,
            charmPricing,
            roundingStep,
            saved: false,
            error: "Failed to save pricing rules",
        };
    }
};

// ================= COMPONENT =================

export default function RulesPage() {
    const loaderData = useLoaderData<PricingRuleData>();
    const actionData = useActionData<PricingRuleData>();
    const { currencyCode } = useOutletContext<{ currencyCode: string }>();
    const navigation = useNavigation();
    const navigate = useNavigate();
    const shopify = useAppBridge();

    const isSubmitting = navigation.state === "submitting";

    const initialData = actionData || loaderData;

    // ================= STATE =================

    const [markupPercent, setMarkupPercent] = useState(
        String(initialData.markupPercent)
    );
    const [charmPricing, setCharmPricing] = useState(initialData.charmPricing);
    const [roundingStep, setRoundingStep] = useState(
        String(initialData.roundingStep)
    );

    // ================= TOAST =================

    useEffect(() => {
        if (actionData?.saved) {
            shopify.toast.show("Pricing rules saved successfully");
        } else if (actionData?.error) {
            shopify.toast.show(actionData.error, { isError: true });
        }
    }, [actionData, shopify]);

    // ================= UPDATED TIME =================

    const updatedAt = actionData?.saved
        ? new Date().toISOString()
        : loaderData.updatedAt;

    // ================= VALIDATION =================

    const isInvalid =
        isNaN(parseFloat(markupPercent)) ||
        isNaN(parseFloat(roundingStep));

    // ================= UI =================

    return (
        <Page title="Pricing Rules" backAction={{ onAction: () => navigate("/app") }}>
            <BlockStack gap="500">
                <Card>
                    <BlockStack gap="400">
                        <Text as="h2" variant="headingLg">
                            Configure Pricing Rules
                        </Text>

                        <Text tone="subdued">
                            Set markup percentage and rounding behavior for your store.
                        </Text>
                    </BlockStack>
                </Card>

                <Layout>
                    <Layout.Section>
                        <Card>
                            <Form method="post">
                                <BlockStack gap="400">

                                    <TextField
                                        label="Markup (%)"
                                        name="markupPercent"
                                        value={markupPercent}
                                        onChange={setMarkupPercent}
                                        autoComplete="off"
                                    />

                                    <TextField
                                        label="Rounding"
                                        name="roundingStep"
                                        value={roundingStep}
                                        onChange={setRoundingStep}
                                        autoComplete="off"
                                    />

                                    <input
                                        type="hidden"
                                        name="charmPricing"
                                        value={String(charmPricing)}
                                    />

                                    <Checkbox
                                        label="Enable Charm Pricing (.99)"
                                        checked={charmPricing}
                                        onChange={setCharmPricing}
                                    />

                                    <Button
                                        submit
                                        variant="primary"
                                        loading={isSubmitting}
                                        disabled={isSubmitting || isInvalid}
                                    >
                                        Save Rules
                                    </Button>

                                    {/* ✅ FIXED UPDATED TIME */}
                                    {updatedAt && (
                                        <Text as="p" tone="subdued">
                                            Last updated:{" "}
                                            {new Date(updatedAt).toLocaleString()}
                                        </Text>
                                    )}
                                </BlockStack>
                            </Form>
                        </Card>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}