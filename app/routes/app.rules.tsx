import { useState, useEffect, useMemo } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
    useLoaderData,
    Form,
    useNavigation,
    useActionData,
    useOutletContext,
    useNavigate,
    useSearchParams,
} from "react-router";

import {
    Page,
    Card,
    Text,
    BlockStack,
    TextField,
    Button,
    Layout,
    InlineStack,
    Select,
    Divider,
    Banner,
    Box,
    Badge,
} from "@shopify/polaris";

import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { calculatePrice } from "../utils/pricing";
import { requireActiveBilling } from "../utils/billing-protection.server";
import { BillingBlockModal, type BillingBlockModalCode } from "../components/BillingBlockModal";
import { DiscardChangesModal } from "../components/DiscardChangesModal";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { t } from "../utils/i18n";

// ================= LOADER =================

const SELECT_OPTION_PREFIX = "\u2002";

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
        markupPercent: rule?.markupPercent ?? 0,
        charmPricing: rule?.charmPricing ?? true,
        roundingStep: rule?.roundingStep ?? 0,
        adjustmentType: rule?.adjustmentType ?? "percentage",
        adjustmentDirection: rule?.adjustmentDirection ?? "increase",
        adjustmentValue: rule?.adjustmentValue ?? Math.abs(rule?.markupPercent ?? 0),
        endingOption: rule?.endingOption ?? (rule?.charmPricing ? "0.99" : (rule?.roundingStep ? Number(rule.roundingStep).toFixed(2) : "none")),
        roundingPrecision: rule?.roundingPrecision ?? "standard",
        minPrice: rule?.minPrice ?? null,
        maxPrice: rule?.maxPrice ?? null,
        updatedAt: rule?.updatedAt ?? null,
        history,
    };
};

// ================= ACTION =================

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const billingError = await requireActiveBilling(shop);
    if (billingError) return Response.json(billingError, { status: 403 });

    const formData = await request.formData();

    const adjustmentType = String(formData.get("adjustmentType") ?? "percentage");
    const adjustmentDirection = String(formData.get("adjustmentDirection") ?? "increase");
    const adjustmentValueStr = String(formData.get("adjustmentValue") ?? "");
    const endingOption = String(formData.get("endingOption") ?? "0.99");
    const roundingPrecision = String(formData.get("roundingPrecision") ?? "standard");
    const minPriceStr = String(formData.get("minPrice") ?? "");
    const maxPriceStr = String(formData.get("maxPrice") ?? "");

    const fieldErrors: Record<string, string> = {};

    const normalizedType = adjustmentType.toLowerCase();
    const normalizedDirection = adjustmentDirection.toLowerCase();
    const normalizedEnding = endingOption.toLowerCase();
    const normalizedPrecision = roundingPrecision.toLowerCase();

    if (normalizedType !== "percentage" && normalizedType !== "fixed") {
        fieldErrors.adjustmentType = "Select an adjustment type";
    }

    if (normalizedDirection !== "increase" && normalizedDirection !== "decrease") {
        fieldErrors.adjustmentDirection = "Select increase or decrease";
    }

    if (!/^\d{1,5}(\.\d{1,2})?$/.test(adjustmentValueStr)) {
        fieldErrors.adjustmentValue = "Enter a valid number";
    }

    const adjustmentValue = Number(adjustmentValueStr);

    if (!fieldErrors.adjustmentValue) {
        if (!isFinite(adjustmentValue) || adjustmentValue < 0) {
            fieldErrors.adjustmentValue = "Enter a valid number";
        } else if (normalizedType === "percentage" && adjustmentValue > 99.99) {
            fieldErrors.adjustmentValue = "Percentage must be between 0 and 99.99";
        }
    }

    const allowedEndings = new Set(["none", "0.00", "0.25", "0.49", "0.50", "0.75", "0.95", "0.99"]);
    if (!allowedEndings.has(normalizedEnding)) {
        fieldErrors.endingOption = "Select a price ending";
    }

    const allowedPrecisions = new Set(["standard", "whole", "keep-cents", "nearest-0.05"]);
    if (!allowedPrecisions.has(normalizedPrecision)) {
        fieldErrors.roundingPrecision = "Select a rounding mode";
    }

    const minPrice = minPriceStr.trim() === "" ? null : Number(minPriceStr);
    const maxPrice = maxPriceStr.trim() === "" ? null : Number(maxPriceStr);

    if (minPrice !== null && (!isFinite(minPrice) || minPrice < 0)) {
        fieldErrors.minPrice = "Enter a valid minimum price";
    }

    if (maxPrice !== null && (!isFinite(maxPrice) || maxPrice < 0)) {
        fieldErrors.maxPrice = "Enter a valid maximum price";
    }

    if (!fieldErrors.minPrice && !fieldErrors.maxPrice && minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
        fieldErrors.maxPrice = "Maximum must be greater than or equal to minimum";
    }

    const markupPercent =
        normalizedType === "percentage"
            ? (normalizedDirection === "decrease" ? -adjustmentValue : adjustmentValue)
            : 0;

    const charmPricing = normalizedEnding === "0.99";
    const roundingStep = normalizedEnding === "none" ? 0 : Number(normalizedEnding);

    if (Object.keys(fieldErrors).length > 0) {
        return {
            adjustmentType,
            adjustmentDirection,
            adjustmentValue: adjustmentValueStr,
            endingOption,
            roundingPrecision,
            minPrice: minPriceStr,
            maxPrice: maxPriceStr,
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
                adjustmentType: normalizedType,
                adjustmentDirection: normalizedDirection,
                adjustmentValue,
                endingOption: normalizedEnding,
                roundingPrecision: normalizedPrecision,
                minPrice,
                maxPrice,
            },
        }),
        prisma.pricingRule.upsert({
            where: { shop: session.shop },
            update: {
                markupPercent,
                charmPricing,
                roundingStep,
                adjustmentType: normalizedType,
                adjustmentDirection: normalizedDirection,
                adjustmentValue,
                endingOption: normalizedEnding,
                roundingPrecision: normalizedPrecision,
                minPrice,
                maxPrice,
            },
            create: {
                shop: session.shop,
                markupPercent,
                charmPricing,
                roundingStep,
                adjustmentType: normalizedType,
                adjustmentDirection: normalizedDirection,
                adjustmentValue,
                endingOption: normalizedEnding,
                roundingPrecision: normalizedPrecision,
                minPrice,
                maxPrice,
            },
        }),
    ]);

    const existingState = await prisma.appState.findUnique({
        where: { shop: session.shop },
        select: { onboardingFirstRuleAt: true, isLive: true },
    });

    if (!existingState?.onboardingFirstRuleAt) {
        const now = new Date();
        await prisma.appState.upsert({
            where: { shop: session.shop },
            update: { onboardingFirstRuleAt: now },
            create: { shop: session.shop, isLive: existingState?.isLive ?? false, onboardingFirstRuleAt: now },
        });
    }

    return {
        adjustmentType: normalizedType,
        adjustmentDirection: normalizedDirection,
        adjustmentValue,
        endingOption: normalizedEnding,
        roundingPrecision: normalizedPrecision,
        minPrice,
        maxPrice,
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
    const { currencyCode, shop, host } = useOutletContext<{ currencyCode: string; shop: string; host: string }>();

    return (
        <RulesContent
            loaderData={loaderData}
            actionData={actionData}
            currencyCode={currencyCode}
            shop={shop}
            host={host}
        />
    );
}

// ================= UI =================

function RulesContent({ loaderData, actionData, currencyCode, shop, host }: any) {
    const navigate = useNavigate();
    const navigation = useNavigation();
    const shopify = useAppBridge();
    const [searchParams] = useSearchParams();
    const isFromOnboarding = searchParams.get("from") === "onboarding";
    const isRevisit = searchParams.get("revisit") === "1";
    const revisitSuffix = isRevisit ? "&revisit=1" : "";

    const isSubmitting = navigation.state === "submitting";

    const initialType = String(loaderData.adjustmentType ?? "percentage").toLowerCase();
    const derivedDirection = (Number(loaderData.markupPercent ?? 0) < 0) ? "decrease" : "increase";
    
    const [adjustmentType, setAdjustmentType] = useState(initialType);
    const [adjustmentDirection, setAdjustmentDirection] = useState(
        initialType === "percentage" ? derivedDirection : String(loaderData.adjustmentDirection ?? "increase").toLowerCase()
    );
    const [adjustmentValue, setAdjustmentValue] = useState(
        initialType === "percentage"
            ? String(Math.abs(Number(loaderData.markupPercent ?? 0)))
            : String(loaderData.adjustmentValue ?? 0)
    );
    const [endingOption, setEndingOption] = useState(String(loaderData.endingOption ?? "0.99").toLowerCase());
    const [roundingPrecision, setRoundingPrecision] = useState(String(loaderData.roundingPrecision ?? "standard").toLowerCase());
    const [minPrice, setMinPrice] = useState(loaderData.minPrice === null ? "" : String(loaderData.minPrice));
    const [maxPrice, setMaxPrice] = useState(loaderData.maxPrice === null ? "" : String(loaderData.maxPrice));
    
    const [billingBlockModalOpen, setBillingBlockModalOpen] = useState(false);
    const [billingBlockModalCode, setBillingBlockModalCode] = useState<BillingBlockModalCode | null>(null);

    // Baseline saved state
    const baseline = useMemo(() => {
        const type = String(actionData?.adjustmentType ?? loaderData.adjustmentType ?? "percentage").toLowerCase();
        const dir = actionData
            ? String(actionData.adjustmentDirection ?? "increase").toLowerCase()
            : (type === "percentage" ? derivedDirection : String(loaderData.adjustmentDirection ?? "increase").toLowerCase());
        const val = actionData
            ? String(actionData.adjustmentValue ?? 0)
            : (type === "percentage" ? String(Math.abs(Number(loaderData.markupPercent ?? 0))) : String(loaderData.adjustmentValue ?? 0));
        const ending = String(actionData?.endingOption ?? loaderData.endingOption ?? "0.99").toLowerCase();
        const precision = String(actionData?.roundingPrecision ?? loaderData.roundingPrecision ?? "standard").toLowerCase();
        
        const minVal = actionData?.minPrice !== undefined 
            ? String(actionData.minPrice ?? "") 
            : (loaderData.minPrice === null ? "" : String(loaderData.minPrice));
            
        const maxVal = actionData?.maxPrice !== undefined 
            ? String(actionData.maxPrice ?? "") 
            : (loaderData.maxPrice === null ? "" : String(loaderData.maxPrice));

        return {
            adjustmentType: type,
            adjustmentDirection: dir,
            adjustmentValue: val,
            endingOption: ending,
            roundingPrecision: precision,
            minPrice: minVal,
            maxPrice: maxVal,
        };
    }, [loaderData, actionData, derivedDirection]);

    const isDirty = useMemo(() => {
        return (
            adjustmentType !== baseline.adjustmentType ||
            adjustmentDirection !== baseline.adjustmentDirection ||
            adjustmentValue !== baseline.adjustmentValue ||
            endingOption !== baseline.endingOption ||
            roundingPrecision !== baseline.roundingPrecision ||
            minPrice !== baseline.minPrice ||
            maxPrice !== baseline.maxPrice
        );
    }, [
        adjustmentType,
        adjustmentDirection,
        adjustmentValue,
        endingOption,
        roundingPrecision,
        minPrice,
        maxPrice,
        baseline,
    ]);

    // Intercept router-based navigation attempts when dirty.
    // (beforeunload + useBlocker live inside the shared hook.)
    const { blocker, discardChanges, keepEditing } = useUnsavedChangesGuard(isDirty);

    useEffect(() => {
        if (actionData?.saved) {
            shopify.toast.show(t("toast.savedSuccessfully"));
            if (isFromOnboarding) {
                navigate(`/app/welcome?step=preview-prices${revisitSuffix}`, { replace: true });
            }
        }
        if (actionData?.code === "BILLING_INACTIVE") {
            setBillingBlockModalCode("BILLING_INACTIVE");
            setBillingBlockModalOpen(true);
        } else if (actionData?.code === "BILLING_UNKNOWN") {
            setBillingBlockModalCode("BILLING_UNKNOWN");
            setBillingBlockModalOpen(true);
        }
    }, [actionData]);

    const targetBackUrl = isFromOnboarding
        ? `/app/welcome?step=create-rule${revisitSuffix}`
        : "/app";

    const handleBackClick = () => {
        if (!isDirty) {
            navigate(targetBackUrl);
        }
        // If dirty, navigation triggered by back button will be caught automatically by `useBlocker`
    };

    const handleDiscard = () => {
        if (blocker.state === "blocked") {
            discardChanges();
        } else {
            navigate(targetBackUrl);
        }
    };

    const handleKeepEditing = () => {
        keepEditing();
    };

    const basePrice = 59.99;

    const safeAdjustmentValue = isNaN(Number(adjustmentValue)) ? 0 : Number(adjustmentValue);
    const safeMin = minPrice.trim() === "" || isNaN(Number(minPrice)) ? null : Number(minPrice);
    const safeMax = maxPrice.trim() === "" || isNaN(Number(maxPrice)) ? null : Number(maxPrice);

    const signed = adjustmentDirection === "decrease" ? -1 : 1;
    const rawAdjusted = adjustmentType === "fixed"
        ? basePrice + signed * safeAdjustmentValue
        : basePrice * (1 + signed * (safeAdjustmentValue / 100));

    const finalPrice = calculatePrice(basePrice, {
        adjustmentType,
        adjustmentDirection,
        adjustmentValue: safeAdjustmentValue,
        endingOption,
        roundingPrecision,
        minPrice: safeMin,
        maxPrice: safeMax,
    });

    return (
        <Page
            title={t("rules.pageTitle")}
            backAction={{
                onAction: handleBackClick,
            }}
            fullWidth
        >
            <div style={{ maxWidth: "1200px", margin: "0 auto", width: "100%" }}>
            <Layout>

                {/* LEFT */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="200">
                            <Text as="p" tone="subdued">
                                {t("rules.intro")}
                            </Text>
                        </BlockStack>
                    </Card>

                    <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", marginTop: "16px" }}>
                    <Card>
                        <Form method="post">
                            <BlockStack gap="200">
                                <Text as="h2" variant="headingMd">{t("rules.pricingAdjustment")}</Text>
                                <InlineStack gap="200" wrap>
                                    <div style={{ flex: "1 1 180px", minWidth: 160 }}>
                                        <Select
                                            label={t("rules.type")}
                                            name="adjustmentType"
                                            options={[
                                                { label: `${SELECT_OPTION_PREFIX}${t("rules.percentage")}`, value: "percentage" },
                                                { label: `${SELECT_OPTION_PREFIX}${t("rules.fixedAmount")}`, value: "fixed" },
                                            ]}
                                            value={adjustmentType}
                                            disabled={isSubmitting}
                                            onChange={(value) => setAdjustmentType(value)}
                                            error={actionData?.fieldErrors?.adjustmentType}
                                        />
                                    </div>
                                    <div style={{ flex: "1 1 180px", minWidth: 160 }}>
                                        <Select
                                            label={t("rules.direction")}
                                            name="adjustmentDirection"
                                            options={[
                                                { label: `${SELECT_OPTION_PREFIX}${t("rules.increase")}`, value: "increase" },
                                                { label: `${SELECT_OPTION_PREFIX}${t("rules.decrease")}`, value: "decrease" },
                                            ]}
                                            value={adjustmentDirection}
                                            disabled={isSubmitting}
                                            onChange={(value) => setAdjustmentDirection(value)}
                                            error={actionData?.fieldErrors?.adjustmentDirection}
                                        />
                                    </div>
                                    <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                                        <TextField
                                            label={t("rules.value")}
                                            name="adjustmentValue"
                                            autoComplete="off"
                                            value={adjustmentValue}
                                            disabled={isSubmitting}
                                            onChange={(value) => {
                                                if (/^\d{0,5}(\.\d{0,2})?$/.test(value) || value === "") {
                                                    setAdjustmentValue(value);
                                                }
                                            }}
                                            suffix={adjustmentType === "percentage" ? "%" : currencyCode}
                                            helpText={adjustmentType === "percentage" ? t("rules.valueHelpPercentage") : t("rules.valueHelpFixed")}
                                            error={actionData?.fieldErrors?.adjustmentValue}
                                        />
                                    </div>
                                </InlineStack>

                                <Divider />

                                <Text as="h2" variant="headingMd">{t("rules.priceEnding")}</Text>
                                <InlineStack gap="200" wrap>
                                    <div style={{ flex: "1 1 240px", minWidth: 220 }}>
                                        <Select
                                            label={t("rules.ending")}
                                            name="endingOption"
                                            options={[
                                                { label: `${SELECT_OPTION_PREFIX}${t("rules.none")}`, value: "none" },
                                                { label: `${SELECT_OPTION_PREFIX}.00`, value: "0.00" },
                                                { label: `${SELECT_OPTION_PREFIX}.25`, value: "0.25" },
                                                { label: `${SELECT_OPTION_PREFIX}.49`, value: "0.49" },
                                                { label: `${SELECT_OPTION_PREFIX}.50`, value: "0.50" },
                                                { label: `${SELECT_OPTION_PREFIX}.75`, value: "0.75" },
                                                { label: `${SELECT_OPTION_PREFIX}.95`, value: "0.95" },
                                                { label: `${SELECT_OPTION_PREFIX}.99`, value: "0.99" },
                                            ]}
                                            value={endingOption}
                                            disabled={isSubmitting}
                                            onChange={(value) => setEndingOption(value)}
                                            error={actionData?.fieldErrors?.endingOption}
                                        />
                                    </div>
                                    <div style={{ flex: "1 1 260px", minWidth: 240 }}>
                                        <Select
                                            label={t("rules.rounding")}
                                            name="roundingPrecision"
                                            options={[
                                                { label: `${SELECT_OPTION_PREFIX}${t("rules.roundingStandard")}`, value: "standard" },
                                                { label: `${SELECT_OPTION_PREFIX}${t("rules.roundingWhole")}`, value: "whole" },
                                                { label: `${SELECT_OPTION_PREFIX}${t("rules.roundingKeepCents")}`, value: "keep-cents" },
                                                { label: `${SELECT_OPTION_PREFIX}${t("rules.roundingNearest005")}`, value: "nearest-0.05" },
                                            ]}
                                            value={roundingPrecision}
                                            disabled={isSubmitting}
                                            onChange={(value) => setRoundingPrecision(value)}
                                            error={actionData?.fieldErrors?.roundingPrecision}
                                        />
                                    </div>
                                </InlineStack>

                                <Divider />

                                <Text as="h2" variant="headingMd">{t("rules.safeguards")}</Text>
                                <InlineStack gap="200" wrap>
                                    <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                                        <TextField
                                            label={t("rules.minimumPriceOptional")}
                                            name="minPrice"
                                            autoComplete="off"
                                            value={minPrice}
                                            disabled={isSubmitting}
                                            onChange={(value) => {
                                                if (/^\d{0,7}(\.\d{0,2})?$/.test(value) || value === "") {
                                                    setMinPrice(value);
                                                }
                                            }}
                                            prefix={currencyCode}
                                            error={actionData?.fieldErrors?.minPrice}
                                        />
                                    </div>
                                    <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                                        <TextField
                                            label={t("rules.maximumPriceOptional")}
                                            name="maxPrice"
                                            autoComplete="off"
                                            value={maxPrice}
                                            disabled={isSubmitting}
                                            onChange={(value) => {
                                                if (/^\d{0,7}(\.\d{0,2})?$/.test(value) || value === "") {
                                                    setMaxPrice(value);
                                                }
                                            }}
                                            prefix={currencyCode}
                                            error={actionData?.fieldErrors?.maxPrice}
                                        />
                                    </div>
                                </InlineStack>

                                <Button submit loading={isSubmitting} variant="primary">
                                    {t("rules.saveRule")}
                                </Button>

                            </BlockStack>
                        </Form>
                    </Card>
                    </div>
                </Layout.Section>

                {/* RIGHT */}
                <Layout.Section variant="oneThird">

                    <div style={{ background: "linear-gradient(135deg, #f9fafb, #f1f5f9)", border: "1px solid #e5e7eb", borderRadius: "12px" }}>
                    <Card>
                        <BlockStack gap="200">
                            <Text as="span" variant="headingMd">{t("rules.previewExample")}</Text>

                            <Banner tone="info">
                                {t("rules.previewBanner")}
                            </Banner>

                            <BlockStack gap="150">
                                <InlineStack align="space-between">
                                    <Text as="span" tone="subdued">{t("rules.current")}</Text>
                                    <Text as="span">{currencyCode} {basePrice.toFixed(2)}</Text>
                                </InlineStack>
                                <InlineStack align="space-between">
                                    <Text as="span" tone="subdued">{t("rules.adjustment")}</Text>
                                    <Text as="span">
                                        {adjustmentDirection === "decrease" ? t("rules.decrease") : t("rules.increase")}{" "}
                                        {adjustmentType === "percentage"
                                            ? `${safeAdjustmentValue.toFixed(2)}%`
                                            : `${currencyCode} ${safeAdjustmentValue.toFixed(2)}`}
                                    </Text>
                                </InlineStack>
                                <InlineStack align="space-between">
                                    <Text as="span" tone="subdued">{t("rules.afterAdjustment")}</Text>
                                    <Text as="span">{currencyCode} {Number(rawAdjusted.toFixed(2)).toFixed(2)}</Text>
                                </InlineStack>
                                <Divider />
                                <InlineStack align="space-between" blockAlign="center">
                                    <Text as="span" variant="headingSm">Final price</Text>
                                    <Text as="span" variant="headingLg" tone="success">
                                        {currencyCode} {finalPrice.toFixed(2)}
                                    </Text>
                                </InlineStack>
                            </BlockStack>

                            {loaderData.updatedAt && (
                                <Text as="span" tone="subdued">
                                    Last updated: {new Date(loaderData.updatedAt).toLocaleString()}
                                </Text>
                            )}

                            <BlockStack gap="200">
                                <Text as="span" variant="headingSm">Recent Changes</Text>

                                <BlockStack gap="150">
                                    {loaderData.history.map((h: any) => {
                                        const type = String(h.adjustmentType ?? "percentage").toLowerCase();
                                        const dir = type === "percentage"
                                            ? (Number(h.markupPercent ?? 0) < 0 ? "decrease" : "increase")
                                            : String(h.adjustmentDirection ?? "increase").toLowerCase();
                                        const value = type === "percentage"
                                            ? Math.abs(Number(h.markupPercent ?? 0))
                                            : Number(h.adjustmentValue ?? 0);
                                        const ending = String(h.endingOption ?? (h.charmPricing ? "0.99" : (h.roundingStep ? Number(h.roundingStep).toFixed(2) : "none"))).toLowerCase();

                                        return (
                                            <Box
                                                key={h.id}
                                                padding="200"
                                                background="bg-surface"
                                                borderRadius="200"
                                            >
                                                <BlockStack gap="100">
                                                    <InlineStack gap="200" wrap>
                                                        <Badge tone={dir === "decrease" ? "attention" : "success"}>
                                                            {dir === "decrease" ? "Decrease" : "Increase"}
                                                        </Badge>
                                                        <Text as="span" variant="bodyMd" fontWeight="medium">
                                                            {type === "percentage"
                                                                ? `${value.toFixed(2)}%`
                                                                : `${currencyCode} ${value.toFixed(2)}`}
                                                        </Text>
                                                        {ending !== "none" && (
                                                            <Badge tone="info">{`Ending .${ending.split(".")[1] ?? "00"}`}</Badge>
                                                        )}
                                                    </InlineStack>
                                                    <Text as="span" tone="subdued" variant="bodySm">
                                                        {new Date(h.createdAt).toLocaleString()}
                                                    </Text>
                                                </BlockStack>
                                            </Box>
                                        );
                                    })}
                                </BlockStack>
                            </BlockStack>
                        </BlockStack>
                    </Card>
                    </div>

                </Layout.Section>

            </Layout>
            </div>

            <BillingBlockModal
                open={billingBlockModalOpen}
                code={billingBlockModalCode}
                shop={shop}
                host={host}
                onClose={() => setBillingBlockModalOpen(false)}
            />

            <DiscardChangesModal
                open={blocker.state === "blocked"}
                onDiscard={handleDiscard}
                onKeepEditing={handleKeepEditing}
            />
        </Page>
    );
}