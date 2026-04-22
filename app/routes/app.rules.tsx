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
import { calculatePrice } from "../utils/pricing";

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

function RulesContent({ loaderData, actionData, currencyCode }: any) {
    const navigate = useNavigate();
    const navigation = useNavigation();
    const shopify = useAppBridge();

    const isSubmitting = navigation.state === "submitting";

    const [markupPercent, setMarkupPercent] = useState(
        String(loaderData.markupPercent)
    );
    const [roundingStep, setRoundingStep] = useState(
        String(loaderData.roundingStep)
    );
    const [charmPricing, setCharmPricing] = useState(
        loaderData.charmPricing
    );

    const [impact, setImpact] = useState({ gain: 0, percent: 0 });

    useEffect(() => {
        if (actionData?.saved) {
            shopify.toast.show("Saved successfully");
        }
    }, [actionData, shopify]);

    // 🔥 Impact Preview
    useEffect(() => {
        let isMounted = true;

        const fetchImpact = async () => {
            try {
                const res = await fetch("/api/staged-preview");
                const data = await res.json();

                if (!isMounted) return;

                if (!data || data.length === 0) {
                    setImpact({ gain: 0, percent: 0 });
                    return;
                }

                let totalOriginal = 0;
                let totalNew = 0;

                for (const item of data) {
                    totalOriginal += Number(item.originalPrice);
                    totalNew += Number(item.stagedPrice);
                }

                const gain = totalNew - totalOriginal;
                const percent =
                    totalOriginal > 0 ? (gain / totalOriginal) * 100 : 0;

                setImpact({ gain, percent });
            } catch (err) {
                console.error("Impact fetch failed", err);
            }
        };

        fetchImpact();

        return () => {
            isMounted = false;
        };
    }, []);

    // ================= CALC =================

    const basePrice = 59.99;

    const finalPrice = calculatePrice(
        basePrice,
        Number(markupPercent) || 0,
        Number(roundingStep) || 0,
        charmPricing
    );

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
                                    autoComplete="off"
                                    value={markupPercent}
                                    disabled={isSubmitting}
                                    onChange={(value) => setMarkupPercent(value)}
                                    helpText="Between -99 and +99"
                                />

                                <TextField
                                    label="Rounding"
                                    name="roundingStep"
                                    autoComplete="off"
                                    value={roundingStep}
                                    disabled={isSubmitting}
                                    onChange={(value) => setRoundingStep(value)}
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

                            <Text as="h2" variant="headingMd">Live Example</Text>

                            <InlineStack align="space-between">
                                <Text as="span" tone="subdued">Base Price</Text>
                                <Text as="span">{currencyCode} {basePrice.toFixed(2)}</Text>
                            </InlineStack>

                            <InlineStack align="space-between">
                                <Text as="span" tone="subdued">Final Price</Text>
                                <Text as="span" variant="heading2xl" tone="success">
                                    {currencyCode} {finalPrice.toFixed(2)}
                                </Text>
                            </InlineStack>

                            <div style={{ borderTop: "1px solid #eee" }} />

                            {loaderData.updatedAt && (
                                <Text as="span" tone="subdued">
                                    Last updated: {new Date(loaderData.updatedAt).toLocaleString()}
                                </Text>
                            )}

                            {loaderData.history?.length > 0 && (
                                <BlockStack gap="100">
                                    <Text as="span" variant="headingSm">Recent Changes</Text>

                                    {loaderData.history.map((h: any) => (
                                        <Text as="span" key={h.id} tone="subdued">
                                            {h.markupPercent > 0 ? "+" : ""}
                                            {h.markupPercent}% • {new Date(h.createdAt).toLocaleString()}
                                        </Text>
                                    ))}
                                </BlockStack>
                            )}

                        </BlockStack>
                    </Card>

                    {/* 🔥 Impact Preview */}
                    <div style={{ marginTop: "16px" }}>
                        <Card>
                            <BlockStack gap="300">

                                <Text as="h3" variant="headingMd">
                                    Impact Preview
                                </Text>

                                {impact.gain === 0 ? (
                                    <Text as="p" tone="subdued">
                                        Apply pricing rules to preview revenue impact.
                                    </Text>
                                ) : (
                                    <>
                                        <InlineStack align="space-between">
                                            <Text as="span" tone="subdued">
                                                Revenue Change
                                            </Text>
                                            <Text
                                                as="span"
                                                variant="headingLg"
                                                tone={impact.gain >= 0 ? "success" : "critical"}
                                            >
                                                {currencyCode} {impact.gain.toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                })}
                                            </Text>
                                        </InlineStack>

                                        <InlineStack align="space-between">
                                            <Text as="span" tone="subdued">
                                                Growth
                                            </Text>
                                            <Text
                                                as="span"
                                                tone={impact.gain >= 0 ? "success" : "critical"}
                                            >
                                                {impact.gain >= 0 ? "+" : ""}
                                                {impact.percent.toFixed(2)}%
                                            </Text>
                                        </InlineStack>
                                    </>
                                )}

                            </BlockStack>
                        </Card>
                    </div>

                </Layout.Section>

            </Layout>
        </Page>
    );
}