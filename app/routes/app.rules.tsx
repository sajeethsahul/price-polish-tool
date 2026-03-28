import { useState, useEffect, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Form, useNavigation, useActionData, useOutletContext } from "react-router";
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
    Divider,
    Tooltip,
    Icon,
} from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";
import { formatMoney, ZERO_DECIMAL_CURRENCIES } from "../utils/format";
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
    const { currencyCode } = useOutletContext<{ currencyCode: string }>();
    const isSubmitting = navigation.state === "submitting";
    const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.includes(currencyCode);

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
        // Allow up to 3 digits before decimal (for -99 to 99), and max 2 decimals
        if (/^-?\d{0,3}(\.\d{0,2})?$/.test(value) || value === "-") {
            setMarkupPercent(value);
        }
    }, []);

    const handleRoundingChange = useCallback((value: string) => {
        if (value.length > 10) return;
        // Max 6 numbers before decimal, max 2 decimals
        if (/^\d{0,6}(\.\d{0,2})?$/.test(value)) {
            setRoundingStep(value);
        }
    }, []);

    const preview = (() => {
        const base = 59.99;
        const m = parseFloat(markupPercent) || 0;
        const r = parseFloat(roundingStep) || 0;
        
        const afterMarkup = base * (1 + m / 100);
        let finalPrice = afterMarkup;
        let roundedValue: number | null = null;
        let formattedCharm: string | null = null;

        if (charmPricing) {
             finalPrice = Math.floor(finalPrice) + 0.99;
             formattedCharm = "0.99";
        } else if (r > 0) {
             finalPrice = Math.floor(finalPrice) + r;
             roundedValue = r;
        }

        return {
             base: formatMoney(base, currencyCode),
             afterMarkup: formatMoney(afterMarkup, currencyCode),
             rounded: roundedValue ? roundedValue.toFixed(2) : null,
             charm: formattedCharm,
             final: formatMoney(finalPrice, currencyCode),
             r
        };
    })();

const receiptStyles = `
  .live-example-receipt {
    background: #f9f9fb;
    border: 1px solid #e1e3e5;
    border-radius: 8px;
    padding: 20px;
  }
  .live-example-receipt .receipt-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .live-example-receipt .receipt-label {
    color: #6d7175;
    font-size: 13px;
    font-family: sans-serif;
  }
  .live-example-receipt .receipt-value {
    font-family: sans-serif;
    font-size: 14px;
    color: #202223;
  }
  .live-example-receipt .receipt-markup {
    color: #008060;
  }
  .live-example-receipt .receipt-divider {
    border-top: 1px solid #e1e3e5;
    margin: 16px 0;
  }
  .live-example-receipt .receipt-final-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .live-example-receipt .receipt-final-label {
    font-weight: bold;
    color: #202223;
    font-size: 15px;
    font-family: sans-serif;
  }
  .live-example-receipt .receipt-final-value {
    font-size: 18px;
    font-weight: bold;
    color: #202223;
    font-family: sans-serif;
  }
`;

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

                <Layout>
                    <Layout.Section>

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
                                label={
                                  <InlineStack gap="100" blockAlign="center">
                                    <Text as="span">Rounding (Fixed Decimal)</Text>
                                    <Tooltip content="Sets the exact decimal ending for every price (e.g., entering 0.88 makes all prices end in .88).">
                                      <span style={{ cursor: "pointer", display: "inline-flex" }}>
                                        <Icon source={InfoIcon} tone="subdued" />
                                      </span>
                                    </Tooltip>
                                  </InlineStack>
                                }
                                type="text"
                                name="roundingStep"
                                value={roundingStep}
                                onChange={handleRoundingChange}
                                autoComplete="off"
                                disabled={isZeroDecimal}
                                helpText={isZeroDecimal ? "Not applicable for zero-decimal currencies." : "Sets the decimal ending (e.g., 0.88 for .88 endpoints)."}
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
                                disabled={isZeroDecimal}
                                helpText={isZeroDecimal ? "Not applicable for zero-decimal currencies." : "Ends prices in .99 (e.g., $19.99)."}
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
            </Layout.Section>
                    
            <Layout.Section variant="oneThird">
                        <Card>
                            <style>{receiptStyles}</style>
                            <BlockStack gap="400">
                                <Text as="h3" variant="headingMd">Live Example</Text>
                                <Text as="p" tone="subdued">See exactly how your rules calculate a regular product:</Text>
                                
                                <div className="live-example-receipt">
                                    <div className="receipt-row">
                                        <span className="receipt-label">Base Price</span>
                                        <span className="receipt-value">{preview.base}</span>
                                    </div>
                                    <div className="receipt-row">
                                        <span className="receipt-label">{parseFloat(preview.afterMarkup.replace(/[^\d.-]/g, '')) >= parseFloat(preview.base.replace(/[^\d.-]/g, '')) ? '+' : ''}{Math.abs(parseFloat(markupPercent) || 0)}% Markup</span>
                                        <span className="receipt-value receipt-markup">{preview.afterMarkup}</span>
                                    </div>
                                    
                                    {preview.charm ? (
                                        <div className="receipt-row">
                                            <span className="receipt-label">Charm Pricing (Auto .99)</span>
                                            <span className="receipt-value">to .{preview.charm.split('.')[1]}</span>
                                        </div>
                                    ) : preview.rounded ? (
                                        <div className="receipt-row">
                                            <span className="receipt-label">Rounding (Fixed Decimal)</span>
                                            <span className="receipt-value">to .{preview.rounded.split('.')[1] || '00'}</span>
                                        </div>
                                    ) : null}
                                    
                                    <div className="receipt-divider"></div>
                                    
                                    <div className="receipt-final-row">
                                        <span className="receipt-final-label">Final Storefront Price</span>
                                        <span className="receipt-final-value">{preview.final}</span>
                                    </div>
                                </div>
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}
