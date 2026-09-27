import { useCallback, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, Form } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  Divider,
  InlineStack,
  Page,
  Text,
  Icon,
} from "@shopify/polaris";
import { CreditCardIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { BILLING_PLANS } from "../config/billing";
import { t } from "../utils/i18n";

type BillingPageData = {
  shop: string;
  subscription: {
    id: string;
    plan: string;
    status: string;
    chargeId: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  testBilling: boolean | null;
  shopLifecycle: {
    isInstalled: boolean;
    installedAt: string | null;
    uninstalledAt: string | null;
    updatedAt: string | null;
  } | null;
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function resolveBillingHealth(params: {
  subscription: BillingPageData["subscription"];
  isInstalled: boolean;
}) {
  if (!params.isInstalled) return "inactive";
  if (!params.subscription) return "active";
  const status = normalize(params.subscription?.status);
  if (!status) return "active";
  if (["active", "accepted", "trialing", "free"].includes(status))
    return "active";
  return "inactive";
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<BillingPageData> => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth as any;

  const { session, admin } = auth;
  const shop = session.shop;

  const [subscription, lifecycle] = await Promise.all([
    prisma.subscription.findUnique({
      where: { shop },
      select: {
        id: true,
        plan: true,
        status: true,
        chargeId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.shop.findUnique({
      where: { shop },
      select: {
        isInstalled: true,
        installedAt: true,
        uninstalledAt: true,
        updatedAt: true,
      },
    }),
  ]);

  let testBilling: boolean | null = null;

  if (subscription?.plan === BILLING_PLANS.BASIC.name) {
    try {
      const response = await admin.graphql(`
        query BillingDiagnostics {
          currentAppInstallation {
            activeSubscriptions {
              name
              test
            }
          }
        }
      `);
      const json = (await response.json().catch(() => null)) as any;
      const subs: Array<{ name?: string | null; test?: boolean | null }> =
        json?.data?.currentAppInstallation?.activeSubscriptions ?? [];
      const match =
        subs.find((s) => normalize(s.name) === BILLING_PLANS.BASIC.name) ??
        subs[0] ??
        null;
      testBilling = typeof match?.test === "boolean" ? match.test : null;
    } catch {
      testBilling = null;
    }
  } else if (subscription) {
    testBilling = false;
  } else {
    testBilling = false;
  }

  return {
    shop,
    subscription: subscription
      ? {
          id: subscription.id,
          plan: subscription.plan,
          status: subscription.status,
          chargeId: subscription.chargeId ?? null,
          createdAt: subscription.createdAt.toISOString(),
          updatedAt: subscription.updatedAt.toISOString(),
        }
      : null,
    testBilling,
    shopLifecycle: lifecycle
      ? {
          isInstalled: lifecycle.isInstalled,
          installedAt: lifecycle.installedAt
            ? lifecycle.installedAt.toISOString()
            : null,
          uninstalledAt: lifecycle.uninstalledAt
            ? lifecycle.uninstalledAt.toISOString()
            : null,
          updatedAt: lifecycle.updatedAt
            ? lifecycle.updatedAt.toISOString()
            : null,
        }
      : null,
  };
};

export async function action({ request }: LoaderFunctionArgs) {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth as any;

  const { billing } = auth;

  const body = await request.formData().catch(() => null);
  const plan = String(body?.get("plan") ?? "");

  if (plan !== BILLING_PLANS.BASIC.name) {
    return Response.json({ error: "Unsupported plan" }, { status: 400 });
  }

  // Shopify redirects to the payment confirmation screen.
  const response = await billing.request({
    plan: BILLING_PLANS.BASIC.name,
   isTest: process.env.NODE_ENV !== "production"
  });

  return response;
}

export default function BillingPage() {
  const data = useLoaderData() as BillingPageData;
  const navigate = useNavigate();
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const installed = data.shopLifecycle?.isInstalled ?? true;
  const billingHealth = resolveBillingHealth({
    subscription: data.subscription,
    isInstalled: installed,
  });
  const billingHealthTone =
    billingHealth === "active" ? ("success" as const) : ("critical" as const);

  const testBillingValue = useMemo(() => {
    if (data.testBilling === null) return "—";
    return data.testBilling ? t("common.yes") : t("common.no");
  }, [data.testBilling]);

  const planLabels = useMemo(() => {
    const formatTemplate = (
      key:
        | "billing.page.plans.campaignsPerMonth"
        | "billing.page.plans.productsPerCampaign"
        | "billing.page.plans.freeTrialDays",
      count: number,
    ) => t(key).replace("{count}", String(count));

    const freeCampaigns = BILLING_PLANS.FREE.limits.campaignsPerMonth;
    const freeProducts = BILLING_PLANS.FREE.limits.productsPerCampaign;
    const basicCampaigns = BILLING_PLANS.BASIC.limits.campaignsPerMonth;
    const basicProducts = BILLING_PLANS.BASIC.limits.productsPerCampaign;
    const basicTrialDays = BILLING_PLANS.BASIC.trialDays;

    return {
      free: {
        campaigns:
          freeCampaigns === null
            ? t("billing.page.plans.unlimitedCampaigns")
            : formatTemplate("billing.page.plans.campaignsPerMonth", freeCampaigns),
        products: formatTemplate(
          "billing.page.plans.productsPerCampaign",
          freeProducts,
        ),
      },
      basic: {
        campaigns:
          basicCampaigns === null
            ? t("billing.page.plans.unlimitedCampaigns")
            : formatTemplate(
                "billing.page.plans.campaignsPerMonth",
                basicCampaigns,
              ),
        products: formatTemplate(
          "billing.page.plans.productsPerCampaign",
          basicProducts,
        ),
        trial: formatTemplate("billing.page.plans.freeTrialDays", basicTrialDays),
      },
      prices: {
        free: t("billing.page.plans.freePrice"),
        basic: t("billing.page.plans.basicPrice"),
      },
    };
  }, []);

  const toggleDiagnostics = useCallback(() => {
    setDiagnosticsOpen((open) => !open);
  }, []);

  return (
    <Page
      title={t("common.nav.billing")}
      titleMetadata={<Icon source={CreditCardIcon} tone="base" />}
      backAction={{ onAction: () => navigate("/app") }}
      fullWidth
    >
      <div style={{ maxWidth: "980px", margin: "0 auto" }}>
        <BlockStack gap="500">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("billing.page.subscriptionOverview")}
              </Text>
              <Divider />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "220px 1fr",
                  rowGap: 10,
                  columnGap: 16,
                }}
              >
                <Text as="p" tone="subdued">
                  {t("billing.page.shop")}
                </Text>
                <Text as="p">{data.shop}</Text>

                <Text as="p" tone="subdued">
                  {t("billing.page.plan")}
                </Text>
                <Text as="p">{data.subscription?.plan ?? "—"}</Text>

                <Text as="p" tone="subdued">
                  {t("billing.page.status")}
                </Text>
                <Text as="p">{data.subscription?.status ?? "—"}</Text>

                <Text as="p" tone="subdued">
                  {t("billing.page.activatedAt")}
                </Text>
                <Text as="p">
                  {formatDateTime(data.subscription?.createdAt ?? null)}
                </Text>

                <Text as="p" tone="subdued">
                  {t("billing.page.testBilling")}
                </Text>
                <Text as="p">{testBillingValue}</Text>
              </div>
            </BlockStack>
          </Card>

          <InlineStack gap="500" wrap>
            <Box width="100%" maxWidth="480px">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {t("billing.page.healthTitle")}
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={billingHealthTone}>
                      {billingHealth === "active"
                        ? t("billing.page.healthActive")
                        : t("billing.page.healthInactive")}
                    </Badge>
                    <Text as="p" tone="subdued">
                      {billingHealth === "active"
                        ? t("billing.page.healthActiveDesc")
                        : t("billing.page.healthInactiveDesc")}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Box>

            <Box width="100%" maxWidth="480px">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {t("billing.page.lifecycleTitle")}
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={installed ? "success" : "critical"}>
                      {installed
                        ? t("billing.page.lifecycleInstalled")
                        : t("billing.page.lifecycleUninstalled")}
                    </Badge>
                    <Text as="p" tone="subdued">
                      {installed
                        ? t("billing.page.lifecycleInstalledDesc")
                        : t("billing.page.lifecycleUninstalledDesc")}
                    </Text>
                  </InlineStack>
                  <Divider />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "220px 1fr",
                      rowGap: 10,
                      columnGap: 16,
                    }}
                  >
                    <Text as="p" tone="subdued">
                      {t("billing.page.installedAt")}
                    </Text>
                    <Text as="p">
                      {formatDateTime(data.shopLifecycle?.installedAt ?? null)}
                    </Text>

                    <Text as="p" tone="subdued">
                      {t("billing.page.uninstalledAt")}
                    </Text>
                    <Text as="p">
                      {formatDateTime(
                        data.shopLifecycle?.uninstalledAt ?? null,
                      )}
                    </Text>
                  </div>
                </BlockStack>
              </Card>
            </Box>
          </InlineStack>

          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Text as="h2" variant="headingMd">
                  {t("billing.page.diagnosticsTitle")}
                </Text>
                <Button
                  variant="tertiary"
                  onClick={toggleDiagnostics}
                  disclosure={diagnosticsOpen ? "up" : "down"}
                >
                  {diagnosticsOpen
                    ? t("billing.page.hide")
                    : t("billing.page.show")}
                </Button>
              </InlineStack>
              <Collapsible
                open={diagnosticsOpen}
                id="billing-diagnostics"
                transition={{ duration: "150ms", timingFunction: "ease" }}
              >
                <Box paddingBlockStart="300">
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "220px 1fr",
                      rowGap: 10,
                      columnGap: 16,
                    }}
                  >
                    <Text as="p" tone="subdued">
                      {t("billing.page.subscriptionId")}
                    </Text>
                    <Text as="p">{data.subscription?.id ?? "—"}</Text>

                    <Text as="p" tone="subdued">
                      {t("billing.page.chargeId")}
                    </Text>
                    <Text as="p">{data.subscription?.chargeId ?? "—"}</Text>

                    <Text as="p" tone="subdued">
                      {t("billing.page.activatedAt")}
                    </Text>
                    <Text as="p">
                      {formatDateTime(data.subscription?.createdAt ?? null)}
                    </Text>

                    <Text as="p" tone="subdued">
                      {t("billing.page.updatedAt")}
                    </Text>
                    <Text as="p">
                      {formatDateTime(data.subscription?.updatedAt ?? null)}
                    </Text>

                    <Text as="p" tone="subdued">
                      {t("billing.page.testBilling")}
                    </Text>
                    <Text as="p">{testBillingValue}</Text>
                  </div>
                </Box>
              </Collapsible>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("billing.page.plans.title")}
              </Text>
              <InlineStack gap="400" wrap>
                <Box width="100%" maxWidth="460px">
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center" wrap>
                        <Text as="h3" variant="headingSm">
                          {t("billing.page.plans.freeTitle")}
                        </Text>
                        {(data.subscription?.plan ?? "free") === "free" ? (
                          <Badge tone="success">
                            {t("billing.page.plans.currentPlan")}
                          </Badge>
                        ) : null}
                      </InlineStack>
                      <Text as="p" variant="headingLg">
                        {planLabels.prices.free}
                        <Text as="span" tone="subdued">
                          {" "}
                          {t("billing.page.plans.perMonth")}
                        </Text>
                      </Text>
                      <Text as="p" tone="subdued">
                        {t("billing.page.plans.freeDesc")}
                      </Text>
                      <ul style={{ paddingLeft: "1.2rem", margin: 0 }}>
                        <li>{planLabels.free.campaigns}</li>
                        <li>{planLabels.free.products}</li>
                        <li>{t("billing.page.plans.fullFeatureSet")}</li>
                      </ul>
                    </BlockStack>
                  </Card>
                </Box>

                <Box width="100%" maxWidth="460px">
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center" wrap>
                        <Text as="h3" variant="headingSm">
                          {t("billing.page.plans.basicTitle")}
                        </Text>
                        {data.subscription?.plan === "basic" ? (
                          <Badge tone="success">
                            {t("billing.page.plans.currentPlan")}
                          </Badge>
                        ) : (
                          <Badge tone="info">
                            {t("billing.page.plans.recommended")}
                          </Badge>
                        )}
                      </InlineStack>
                      <Text as="p" variant="headingLg">
                        {planLabels.prices.basic}
                        <Text as="span" tone="subdued">
                          {" "}
                          {t("billing.page.plans.perMonth")}
                        </Text>
                      </Text>
                      <Text as="p" tone="subdued">
                        {t("billing.page.plans.basicDesc")}
                      </Text>
                      <ul style={{ paddingLeft: "1.2rem", margin: 0 }}>
                        <li>{planLabels.basic.campaigns}</li>
                        <li>{planLabels.basic.products}</li>
                        <li>{t("billing.page.plans.sameFullFeatureSet")}</li>
                        <li>{planLabels.basic.trial}</li>
                      </ul>
                      <Form method="post">
                        <input type="hidden" name="plan" value="basic" />
                        <Button
                          variant="primary"
                          disabled={data.subscription?.plan === "basic"}
                          submit
                        >
                          {t("billing.page.plans.upgradeToBasic")}
                        </Button>
                      </Form>
                    </BlockStack>
                  </Card>
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </BlockStack>
      </div>
    </Page>
  );
}
