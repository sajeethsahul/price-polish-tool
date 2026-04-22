// SAME IMPORTS (no change)

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

    // 🔒 STRICT VALIDATION (RESTORED)
    if (!/^-?\d{1,2}(\.\d{1,2})?$/.test(markupStr) || markupStr.length > 5) {
        fieldErrors.markupPercent = "Enter valid % (-99.99 to 99.99)";
    }

    if (!/^0(\.\d{1,2})?$/.test(roundingStr)) {
        fieldErrors.roundingStep = "Use decimal (0.01 to 0.99)";
    }

    const markupPercent = Number(markupStr);
    const roundingStep = Number(roundingStr);

    if (!fieldErrors.markupPercent && (markupPercent < -99.99 || markupPercent > 99.99)) {
        fieldErrors.markupPercent = "Must be between -99.99 and 99.99";
    }

    if (!fieldErrors.roundingStep && (roundingStep < 0 || roundingStep > 0.99)) {
        fieldErrors.roundingStep = "Must be between 0 and 0.99";
    }

    if (Object.keys(fieldErrors).length > 0) {
        return {
            markupPercent: markupStr,
            roundingStep: roundingStr,
            charmPricing,
            saved: false,
            fieldErrors,
        };
    }

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

    const [markupPercent, setMarkupPercent] = useState(String(loaderData.markupPercent));
    const [roundingStep, setRoundingStep] = useState(String(loaderData.roundingStep));
    const [charmPricing, setCharmPricing] = useState(loaderData.charmPricing);

    useEffect(() => {
        if (actionData?.saved) {
            shopify.toast.show("Saved successfully");
        }
    }, [actionData]);

    const basePrice = 59.99;

    const markupApplied = basePrice * (1 + (Number(markupPercent) || 0) / 100);

    const finalPrice = calculatePrice(
        basePrice,
        Number(markupPercent) || 0,
        Number(roundingStep) || 0,
        charmPricing
    );

    return (
        <Page title="Pricing Rules" backAction={{ onAction: () => navigate("/app") }}>
            <Layout>

                {/* LEFT */}
                <Layout.Section>
                    <Card>
                        <Form method="post">
                            <BlockStack gap="300">

                                <TextField
                                    label="Markup (%)"
                                    name="markupPercent"
                                    autoComplete="off"
                                    value={markupPercent}
                                    disabled={isSubmitting}
                                    onChange={(value) => setMarkupPercent(value)}
                                    helpText="Between -99 and +99"
                                    error={actionData?.fieldErrors?.markupPercent}
                                />

                                <TextField
                                    label="Rounding"
                                    name="roundingStep"
                                    autoComplete="off"
                                    value={roundingStep}
                                    disabled={isSubmitting}
                                    onChange={(value) => setRoundingStep(value)}
                                    helpText="Decimal (e.g., 0.55)"
                                    error={actionData?.fieldErrors?.roundingStep}
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
                        <BlockStack gap="300">

                            <Text   as="span" variant="headingMd">Live Example</Text>

                            <InlineStack align="space-between">
                                <Text   as="span" tone="subdued">Base</Text>
                                <Text   as="span">{currencyCode} {basePrice.toFixed(2)}</Text>
                            </InlineStack>

                            <InlineStack align="space-between">
                                <Text   as="span" tone="subdued">+{markupPercent}%</Text>
                                <Text   as="span">{currencyCode} {markupApplied.toFixed(2)}</Text>
                            </InlineStack>

                            <InlineStack align="space-between">
                                <Text   as="span" tone="subdued">Rounded</Text>
                                <Text   as="span">{currencyCode} {finalPrice.toFixed(2)}</Text>
                            </InlineStack>

                            <Text   as="span" variant="heading2xl" tone="success">
                                {currencyCode} {finalPrice.toFixed(2)}
                            </Text>

                            {loaderData.updatedAt && (
                                <Text   as="span" tone="subdued">
                                    Last updated: {new Date(loaderData.updatedAt).toLocaleString()}
                                </Text>
                            )}

                            <BlockStack gap="100">
                                <Text   as="span" variant="headingSm">Recent Changes</Text>

                                {loaderData.history.map((h: any) => (
                                    <Text   as="span" key={h.id} tone="subdued">
                                        {h.markupPercent > 0 ? "+" : ""}
                                        {h.markupPercent}% • {h.roundingStep?.toFixed(2)}
                                        {h.charmPricing && " • .99"} • {new Date(h.createdAt).toLocaleString()}
                                    </Text>
                                ))}
                            </BlockStack>

                        </BlockStack>
                    </Card>

                </Layout.Section>

            </Layout>
        </Page>
    );
}