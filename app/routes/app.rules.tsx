import { useState, useEffect, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Form, useNavigation, useActionData } from "react-router";
import {
    Page,
    Card,
    Text,
    BlockStack,
    TextField,
    Checkbox,
    Button,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface PricingRuleData {
    markupPercent: number;
    charmPricing: boolean;
    roundingStep: number;
    saved?: boolean;
    error?: string;
    fieldErrors?: Record<string, string>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);

    const rule = await prisma.pricingRule.findUnique({
        where: { shop: session.shop },
    });

    return {
        markupPercent: rule?.markupPercent ?? 10,
        charmPricing: rule?.charmPricing ?? true,
        roundingStep: rule?.roundingStep ?? 1,
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();

    const markupStr = formData.get("markupPercent") as string;
    const roundingStr = formData.get("roundingStep") as string;
    const charmPricing = formData.get("charmPricing") === "true";

    const markupPercent = parseFloat(markupStr);
    const roundingStep = parseFloat(roundingStr);

    // Backend Validation
    const fieldErrors: Record<string, string> = {};
    if (isNaN(markupPercent) || markupPercent < -99 || markupPercent > 99) {
        fieldErrors.markupPercent = "Markup must be between -99% and +99%";
    }
    if (isNaN(roundingStep) || roundingStep < 0 || roundingStep > 100) {
        fieldErrors.roundingStep = "Rounding step must be between 0 and 100";
    }

    if (Object.keys(fieldErrors).length > 0) {
        return {
            markupPercent: isNaN(markupPercent) ? 0 : markupPercent,
            charmPricing,
            roundingStep: isNaN(roundingStep) ? 0 : roundingStep,
            saved: false,
            fieldErrors,
        };
    }

    try {
        await prisma.pricingRule.upsert({
            where: { shop: session.shop },
            update: { markupPercent, charmPricing, roundingStep },
            create: { shop: session.shop, markupPercent, charmPricing, roundingStep },
        });

        return {
            markupPercent,
            charmPricing,
            roundingStep,
            saved: true,
        };
    } catch (error) {
        return {
            markupPercent,
            charmPricing,
            roundingStep,
            saved: false,
            error: "Failed to save pricing rules.",
        };
    }
};

export default function RulesPage() {
    const loaderData = useLoaderData<PricingRuleData>();
    const actionData = useActionData<PricingRuleData>();
    const navigation = useNavigation();
    const shopify = useAppBridge();
    const isSubmitting = navigation.state === "submitting";

    const initialData = actionData || loaderData;

    const [markupPercent, setMarkupPercent] = useState(String(initialData.markupPercent));
    const [charmPricing, setCharmPricing] = useState(initialData.charmPricing);
    const [roundingStep, setRoundingStep] = useState(String(initialData.roundingStep));

    // Real-time validation
    const getMarkupError = () => {
        const val = parseFloat(markupPercent);
        if (markupPercent === "" || markupPercent === "-") return null;
        if (isNaN(val)) return "Invalid number";
        if (val < -99 || val > 99) return "Must be between -99 and +99";
        if (markupPercent.length > 6) return "Too many digits";
        return null;
    };

    const getRoundingError = () => {
        const val = parseFloat(roundingStep);
        if (roundingStep === "") return null;
        if (isNaN(val)) return "Invalid number";
        if (val < 0 || val > 100) return "Must be between 0 and 100";
        if (roundingStep.length > 6) return "Too many digits";
        return null;
    };

    const currentMarkupError = getMarkupError() || actionData?.fieldErrors?.markupPercent;
    const currentRoundingError = getRoundingError() || actionData?.fieldErrors?.roundingStep;

    useEffect(() => {
        if (actionData?.saved) {
            shopify.toast.show("Pricing rules saved successfully.");
        } else if (actionData?.error) {
            shopify.toast.show(actionData.error, { isError: true });
        }
    }, [actionData, shopify]);

    const handleMarkupChange = useCallback((value: string) => {
        // Prevent extremely long inputs
        if (value.length > 10) return;
        // Allow only numbers, one decimal point, and one leading minus
        if (/^-?\d*\.?\d*$/.test(value)) {
            setMarkupPercent(value);
        }
    }, []);

    const handleRoundingChange = useCallback((value: string) => {
        if (value.length > 10) return;
        if (/^\d*\.?\d*$/.test(value)) {
            setRoundingStep(value);
        }
    }, []);

    return (
        <Page title="Pricing Rules" backAction={{ url: "/app" }}>
            <BlockStack gap="500">
                <Card>
                    <BlockStack gap="400">
                        <Text as="h2" variant="headingLg">
                            Configure Pricing Rules
                        </Text>
                        <Text as="p" variant="bodyMd">
                            Set your markup percentage (-99 to +99) and rounding preferences.
                        </Text>
                    </BlockStack>
                </Card>

                <Card>
                    <Form method="post">
                        <BlockStack gap="400">
                            <TextField
                                label="Markup Percentage (%)"
                                type="text" // Using text for better manual control over long inputs
                                name="markupPercent"
                                value={markupPercent}
                                onChange={handleMarkupChange}
                                autoComplete="off"
                                helpText="Between -99% and +99% (e.g., 5.5 or -10)."
                                error={currentMarkupError}
                            />

                            <TextField
                                label="Rounding Step"
                                type="text"
                                name="roundingStep"
                                value={roundingStep}
                                onChange={handleRoundingChange}
                                autoComplete="off"
                                helpText="Nearest value (0 to 100). E.g., 0.5 or 1.0."
                                error={currentRoundingError}
                            />

                            <input
                                type="hidden"
                                name="charmPricing"
                                value={String(charmPricing)}
                            />
                            <Checkbox
                                label="Enable Charm Pricing"
                                checked={charmPricing}
                                onChange={setCharmPricing}
                                helpText="Ends prices in .99 (e.g., $19.99)."
                            />

                            <Button
                                variant="primary"
                                submit
                                loading={isSubmitting}
                                disabled={isSubmitting || !!currentMarkupError || !!currentRoundingError}
                            >
                                Save Rules
                            </Button>
                        </BlockStack>
                    </Form>
                </Card>
            </BlockStack>
        </Page>
    );
}
