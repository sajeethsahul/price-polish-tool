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
} from "@shopify/polaris";
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
  const status = normalize(params.subscription?.status);
  if (!status) return "inactive";
  if (["active", "accepted", "trialing", "free"].includes(status)) return "active";
  return "inactive";
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<BillingPageData> => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth as any;

  const { session } = auth;
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
    shopLifecycle: lifecycle
      ? {
          isInstalled: lifecycle.isInstalled,
          installedAt: lifecycle.installedAt.toISOString(),
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
    isTest: true,
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
    return t("common.yes");
  }, []);

  const toggleDiagnostics = useCallback(() => {
    setDiagnosticsOpen((open) => !open);
  }, []);

  return (
    <Page
      title={t("common.nav.billing")}
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
                Plans
              </Text>
              <InlineStack gap="400" wrap>
                <Box width="100%" maxWidth="460px">
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center" wrap>
                        <Text as="h3" variant="headingSm">
                          Free
                        </Text>
                        {(data.subscription?.plan ?? "free") === "free" ? (
                          <Badge tone="success">Current plan</Badge>
                        ) : null}
                      </InlineStack>
                      <Text as="p" variant="headingLg">
                        $0
                        <Text as="span" tone="subdued">
                          {" "}/month
                        </Text>
                      </Text>
                      <Text as="p" tone="subdued">
                        Get started with Price Polish at no cost.
                      </Text>
                      <ul style={{ paddingLeft: "1.2rem", margin: 0 }}>
                        <li>1 campaign per month</li>
                        <li>Up to 50 products per campaign</li>
                        <li>Core pricing rules &amp; scheduling</li>
                      </ul>
                    </BlockStack>
                  </Card>
                </Box>

                <Box width="100%" maxWidth="460px">
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center" wrap>
                        <Text as="h3" variant="headingSm">
                          Basic
                        </Text>
                        {data.subscription?.plan === "basic" ? (
                          <Badge tone="success">Current plan</Badge>
                        ) : (
                          <Badge tone="info">Recommended</Badge>
                        )}
                      </InlineStack>
                      <Text as="p" variant="headingLg">
                        $9.99
                        <Text as="span" tone="subdued">
                          {" "}/month
                        </Text>
                      </Text>
                      <Text as="p" tone="subdued">
                        For growing stores running regular price campaigns.
                      </Text>
                      <ul style={{ paddingLeft: "1.2rem", margin: 0 }}>
                        <li>Unlimited campaigns</li>
                        <li>Up to 1,000 products per campaign</li>
                        <li>14-day free trial</li>
                      </ul>
                      <Form method="post">
                        <input type="hidden" name="plan" value="basic" />
                        <Button
                          variant="primary"
                          disabled={data.subscription?.plan === "basic"}
                          submit
                        >
                          Upgrade to Basic
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
