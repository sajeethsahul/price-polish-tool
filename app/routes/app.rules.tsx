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

interface PricingRuleHistoryItem {
    id: string;
    markupPercent: number;
    charmPricing: boolean;
    roundingStep: number;
    createdAt: string;
}

interface PricingRuleData {
    markupPercent: number;
    charmPricing: boolean;
    roundingStep: number;
    updatedAt?: string | null;
    history?: PricingRuleHistoryItem[];
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

    const history = await prisma.pricingRuleHistory.findMany({
        where: { shop: session.shop },
        orderBy: { createdAt: "desc" },
        take: 5,
    });

    return {
        markupPercent: rule?.markupPercent ?? 10,
        charmPricing: rule?.charmPricing ?? true,
        roundingStep: rule?.roundingStep ?? 1,
        updatedAt: rule?.updatedAt ?? null,
        history,
    };
};

// ================= ACTION =================

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();

    const markupStr = formData.get("markupPercent") as string;
    const roundingStr = formData.get("roundingStep") as string;
    const charmPricing = formData.get("charmPricing") === "true";

    const fieldErrors: Record<string, string> = {};

    /**
     * 1. PREVENT "BAD" VALUES VIA REGEX
     * - markupStr: Optional minus, then 1-2 digits, optional decimal with 1-2 digits (Max 5 chars)
     * - roundingStr: Must start with 0 or -0, decimal point, then 1-2 digits (e.g., 0.99, -0.50)
     */
    if (!/^-?\d{1,2}(\.\d{1,2})?$/.test(markupStr) || markupStr.length > 5) {
        fieldErrors.markupPercent = "Enter a valid percentage (e.g., 99.99 or -15.5)";
    }

    if (!/^-?0(\.\d{1,2})?$/.test(roundingStr)) {
        fieldErrors.roundingStep = "Rounding must be a fraction (e.g., 0.99 or -0.5)";
    }

    const markupPercent = Number(markupStr);
    const roundingStep = Number(roundingStr);

    /**
     * 2. STRICT RANGE VALIDATION
     */
    if (!fieldErrors.markupPercent && (markupPercent < -99.99 || markupPercent > 99.99)) {
        fieldErrors.markupPercent = "Value must be between -99.99 and 99.99";
    }

    if (!fieldErrors.roundingStep && (roundingStep < -0.99 || roundingStep > 0.99)) {
        fieldErrors.roundingStep = "Value must be between -0.99 and 0.99";
    }

    if (Object.keys(fieldErrors).length > 0) {
        return {
            markupPercent: isNaN(markupPercent) ? markupStr : markupPercent,
            charmPricing,
            roundingStep: isNaN(roundingStep) ? roundingStr : roundingStep,
            saved: false,
            fieldErrors,
        };
    }

    try {
        // ✅ Transactional logic: Save history and update current rule
        await prisma.$transaction([
            prisma.pricingRuleHistory.create({
                data: {
                    shop: session.shop,
                    markupPercent,
                    charmPricing,
                    roundingStep,
                },
            }),
            prisma.pricingRule.upsert({
                where: { shop: session.shop },
                update: { markupPercent, charmPricing, roundingStep },
                create: {
                    shop: session.shop,
                    markupPercent,
                    charmPricing,
                    roundingStep,
                },
            }),
        ]);

        return {
            markupPercent,
            charmPricing,
            roundingStep,
            saved: true,
        };
    } catch (error) {
        console.error("Database error:", error);
        return {
            markupPercent,
            charmPricing,
            roundingStep,
            saved: false,
            error: "System error: Could not sync pricing rules.",
        };
    }
};

// ================= COMPONENT =================

export default function RulesPage() {
    const loaderData = useLoaderData<PricingRuleData>();
    const actionData = useActionData<PricingRuleData>();
    const { currencyCode } = useOutletContext<{ currencyCode: string }>();

    return (
        <RulesContent
            loaderData={loaderData}
            actionData={actionData}
            currencyCode={currencyCode}
        />
    );
}

// ================= UI =================

function RulesContent({
    loaderData,
    actionData,
    currencyCode,
}: {
    loaderData: PricingRuleData;
    actionData?: PricingRuleData;
    currencyCode: string;
}) {
    const navigate = useNavigate();
    const navigation = useNavigation();
    const shopify = useAppBridge();

    const isSubmitting = navigation.state === "submitting";
    const initialData = actionData || loaderData;

    const [markupPercent, setMarkupPercent] = useState(
        String(initialData.markupPercent)
    );
    const [charmPricing, setCharmPricing] = useState(initialData.charmPricing);
    const [roundingStep, setRoundingStep] = useState(
        String(initialData.roundingStep)
    );

    // ✅ toast
    useEffect(() => {
        if (actionData?.saved) {
            shopify.toast.show("Pricing rules saved successfully");
        } else if (actionData?.error) {
            shopify.toast.show(actionData.error, { isError: true });
        }
    }, [actionData, shopify]);

    // ✅ updatedAt fix
    const updatedAt = actionData?.saved
        ? new Date().toISOString()
        : loaderData.updatedAt;

    return (
        <Page title="Pricing Rules" backAction={{ onAction: () => navigate("/app") }}>
            <BlockStack gap="500">
                <Card>
                    <BlockStack gap="300">
                        <Text as="h2" variant="headingLg">
                            Pricing Rules
                        </Text>
                        <Text tone="subdued">
                            Automatically adjust your product prices with markup and smart rounding.
                        </Text>
                    </BlockStack>
                </Card>

                <Layout>
                    {/* LEFT */}
                    <Layout.Section>
                        <Card>
                            <Form method="post">
                                <BlockStack gap="400">
                                    <TextField
                                        label="Markup (%)"
                                        name="markupPercent"
                                        value={markupPercent}
                                        onChange={(value) => {
                                            if (/^-?\d*\.?\d*$/.test(value)) {
                                                setMarkupPercent(value);
                                            }
                                        }}
                                        inputMode="decimal"
                                        autoComplete="off"
                                        helpText="Between -99 and +99"
                                    />

                                    <TextField
                                        label="Rounding"
                                        name="roundingStep"
                                        value={roundingStep}
                                        onChange={(value) => {
                                            if (/^\d*\.?\d*$/.test(value)) {
                                                setRoundingStep(value);
                                            }
                                        }}
                                        inputMode="decimal"
                                        autoComplete="off"
                                        helpText="0 to 100"
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
                                        helpText="Prices end in .99 (e.g., $19.99)"
                                    />

                                    <Button
                                        submit
                                        variant="primary"
                                        loading={isSubmitting}
                                    >
                                        Save Rules
                                    </Button>

                                    {/* ✅ Last updated */}
                                    {updatedAt && (
                                        <Text tone="subdued">
                                            Last updated: {new Date(updatedAt).toLocaleString()}
                                        </Text>
                                    )}

                                    {/* ✅ Recent Changes */}
                                    {loaderData.history && loaderData.history.length > 0 && (
                                        <BlockStack gap="200">
                                            <Text variant="headingSm">Recent Changes</Text>

                                            {loaderData.history.map((h) => (
                                                <Text key={h.id} tone="subdued">
                                                    {h.markupPercent > 0 ? "+" : ""}
                                                    {h.markupPercent}% markup •{" "}
                                                    {h.charmPricing ? ".99 enabled • " : ""}
                                                    {new Date(h.createdAt).toLocaleString()}
                                                </Text>
                                            ))}
                                        </BlockStack>
                                    )}
                                </BlockStack>
                            </Form>
                        </Card>
                    </Layout.Section>

                    {/* RIGHT (your preview untouched conceptually) */}
                    <Layout.Section variant="oneThird">
                        <Card>
                            <Text variant="headingMd">Live Example</Text>

                            <BlockStack gap="200">
                                <InlineStack align="space-between">
                                    <Text tone="subdued">Base Price</Text>
                                    <Text>${basePrice.toFixed(2)}</Text>
                                </InlineStack>

                                <InlineStack align="space-between">
                                    <Text tone="subdued">
                                        {markup >= 0 ? "+" : ""}
                                        {markup}% Markup
                                    </Text>
                                    <Text tone="success" variant="headingSm">
                                        ${priceAfterMarkup.toFixed(2)}
                                    </Text>
                                </InlineStack>

                                <InlineStack align="space-between">
                                    <Text tone="subdued">Rounded</Text>
                                    <Text>${roundedPrice.toFixed(2)}</Text>
                                </InlineStack>

                                {charmPricing && (
                                    <Text tone="subdued">Charm pricing applied (.99)</Text>
                                )}

                                <InlineStack align="space-between">
                                    <Text variant="headingMd">Final Price</Text>
                                    <Text variant="headingLg" tone="success">
                                        ${roundedPrice.toFixed(2)}
                                    </Text>
                                </InlineStack>
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}