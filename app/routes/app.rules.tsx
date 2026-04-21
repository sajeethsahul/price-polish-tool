import { useState, useEffect } from "react";
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
        roundingStep: rule?.roundingStep ?? 0.99,
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

    if (!/^-?\d{1,2}(\.\d{1,2})?$/.test(markupStr)) {
        fieldErrors.markupPercent = "Invalid markup";
    }

    if (!/^0(\.\d{1,2})?$/.test(roundingStr)) {
        fieldErrors.roundingStep = "Invalid rounding (0.00–0.99)";
    }

    const markupPercent = Number(markupStr);
    let roundingStep = Number(roundingStr);

    if (markupPercent < -99 || markupPercent > 99) {
        fieldErrors.markupPercent = "Must be -99 to 99";
    }

    if (roundingStep < 0 || roundingStep > 0.99) {
        fieldErrors.roundingStep = "Must be 0–0.99";
    }

    if (Object.keys(fieldErrors).length > 0) {
        return {
            markupPercent,
            roundingStep,
            charmPricing,
            saved: false,
            fieldErrors,
        };
    }

    roundingStep = Math.round(roundingStep * 100) / 100;

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
        roundingStep,
        charmPricing,
        saved: true,
    };
};

// ================= COMPONENT =================

export default function RulesPage() {
    const loaderData = useLoaderData<any>();
    const actionData = useActionData<any>();
    const { currencyCode } = useOutletContext<any>();

    return (
        <RulesContent
            loaderData={loaderData}
            actionData={actionData}
            currencyCode={currencyCode}
        />
    );
}

// ================= UI =================

function RulesContent({ loaderData, actionData }: any) {
    const navigate = useNavigate();
    const navigation = useNavigation();
    const shopify = useAppBridge();

    const isSubmitting = navigation.state === "submitting";

    // ✅ FIX 1: Stable state (no flicker)
    const [markupPercent, setMarkupPercent] = useState(
        String(loaderData.markupPercent)
    );
    const [roundingStep, setRoundingStep] = useState(
        String(loaderData.roundingStep)
    );
    const [charmPricing, setCharmPricing] = useState(
        loaderData.charmPricing
    );

    // toast only (no UI reset)
    useEffect(() => {
        if (actionData?.saved) {
            shopify.toast.show("Saved successfully");
        }
    }, [actionData, shopify]);

    // ================= CALC =================

    const basePrice = 59.99;

    const markup = Number(markupPercent);
    const rounding = Number(roundingStep);

    const safeMarkup = isFinite(markup) ? markup : 0;
    const safeRounding = isFinite(rounding) ? rounding : 0;

    const priceAfterMarkup =
        basePrice + (basePrice * safeMarkup) / 100;

    let roundedPrice = priceAfterMarkup;

    if (safeRounding > 0) {
        roundedPrice = Math.floor(priceAfterMarkup) + safeRounding;
        if (roundedPrice < priceAfterMarkup) {
            roundedPrice += 1;
        }
    } else {
        roundedPrice = Math.round(priceAfterMarkup);
    }

    if (charmPricing) {
        roundedPrice = Math.floor(priceAfterMarkup) + 0.99;
    }

    // ================= UI =================

    return (
        <Page title="Pricing Rules" backAction={{ onAction: () => navigate("/app") }}>
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
                                    disabled={isSubmitting}
                                    onChange={(value) => {
                                        if (value === "" || value === "-") {
                                            setMarkupPercent(value);
                                            return;
                                        }
                                        if (value.length > 6) return;
                                        if (!/^-?\d{0,2}(\.\d{0,2})?$/.test(value)) return;

                                        const num = Number(value);
                                        if (!isNaN(num) && num >= -99 && num <= 99) {
                                            setMarkupPercent(value);
                                        }
                                    }}
                                    helpText="Between -99 and +99"
                                />

                                <TextField
                                    label="Rounding"
                                    name="roundingStep"
                                    value={roundingStep}
                                    disabled={isSubmitting}
                                    onChange={(value) => {
                                        if (value === "") {
                                            setRoundingStep(value);
                                            return;
                                        }
                                        if (value.length > 4) return;
                                        if (!/^0?(\.\d{0,2})?$/.test(value)) return;

                                        const num = Number(value);
                                        if (!isNaN(num) && num >= 0 && num <= 0.99) {
                                            setRoundingStep(value);
                                        }
                                    }}
                                    helpText="Decimal rounding (e.g., 0.99)"
                                />

                                <input
                                    type="hidden"
                                    name="charmPricing"
                                    value={String(charmPricing)}
                                />

                                <Checkbox
                                    label="Enable Charm Pricing (.99)"
                                    checked={charmPricing}
                                    disabled={isSubmitting}
                                    onChange={setCharmPricing}
                                />

                                <Button submit loading={isSubmitting} variant="primary">
                                    Save Rules
                                </Button>

                            </BlockStack>
                        </Form>
                    </Card>
                </Layout.Section>

                {/* RIGHT */}
                <Layout.Section variant="oneThird">
                    <Card>
                        <BlockStack gap="400">

                            <Text variant="headingMd">Live Example</Text>

                            <InlineStack align="space-between">
                                <Text tone="subdued">Base Price</Text>
                                <Text>${basePrice.toFixed(2)}</Text>
                            </InlineStack>

                            <InlineStack align="space-between">
                                <Text tone="subdued">
                                    {safeMarkup >= 0 ? "+" : ""}
                                    {safeMarkup}% Markup
                                </Text>
                                <Text tone="success">
                                    ${priceAfterMarkup.toFixed(2)}
                                </Text>
                            </InlineStack>

                            <InlineStack align="space-between">
                                <Text tone="subdued">Rounded</Text>
                                <Text>${roundedPrice.toFixed(2)}</Text>
                            </InlineStack>

                            <InlineStack align="space-between">
                                <Text variant="headingMd">Final Price</Text>
                                <Text variant="heading2xl" tone="success">
                                    ${roundedPrice.toFixed(2)}
                                </Text>
                            </InlineStack>

                            <div style={{ borderTop: "1px solid #eee" }} />

                            {loaderData.updatedAt && (
                                <Text tone="subdued">
                                    Last updated: {new Date(loaderData.updatedAt).toLocaleString()}
                                </Text>
                            )}

                            {loaderData.history?.length > 0 && (
                                <BlockStack gap="100">
                                    <Text variant="headingSm">Recent Changes</Text>

                                    {loaderData.history.map((h: any) => (
                                        <Text key={h.id} tone="subdued">
                                            {h.markupPercent > 0 ? "+" : ""}
                                            {h.markupPercent}% •{" "}
                                            {h.charmPricing ? ".99 • " : ""}
                                            {new Date(h.createdAt).toLocaleString()}
                                        </Text>
                                    ))}
                                </BlockStack>
                            )}

                        </BlockStack>
                    </Card>
                </Layout.Section>

            </Layout>
        </Page>
    );
}