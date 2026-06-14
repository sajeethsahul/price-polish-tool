import { useEffect, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  BlockStack,
  Button,
  Card,
  Icon,
  InlineStack,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import {
  CalendarTimeIcon,
  CheckIcon,
  ShieldCheckMarkIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { t } from "../utils/i18n";

type WizardStep = "welcome" | "create-rule" | "preview-prices" | "apply-update" | "success";

interface OnboardingState {
  hasRule: boolean;
  hasPreviewed: boolean;
  hasApplied: boolean;
  hasScheduled: boolean;
  hasCompletedFirstUpdate: boolean;
}

const DEBUG_WELCOME_TEST_RENDER = false;

// ================= LOADER =================
export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("[WELCOME LOADER START]", request.url);
  try {
    const auth = await authenticate.admin(request);
    if (auth instanceof Response) {
      const location = auth.headers.get("Location");
      console.log("[AUTH/BILLING REDIRECT]");
      console.log("REQUEST:", request.url);
      console.log("STATUS:", auth.status);
      console.log("LOCATION:", location);

      if (location && location.startsWith("https://admin.shopify.com")) {
        const html = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><script>window.top.location.href=${JSON.stringify(location)};</script></body></html>`;
        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }

      return auth;
    }

    const { session } = auth;
    const shop = session.shop;

    const { default: prisma } = await import("../db.server");
    const appState = await prisma.appState.findUnique({
      where: { shop },
      select: {
        onboardingFirstRuleAt: true,
        onboardingFirstPreviewAt: true,
        onboardingFirstApplyStartAt: true,
        onboardingFirstApplyAt: true,
        onboardingFirstScheduleAt: true,
      },
    });

    console.log("[WELCOME LOADER SUCCESS]");
    return Response.json({
      shop,
      onboarding: {
        hasRule: Boolean(appState?.onboardingFirstRuleAt),
        hasPreviewed: Boolean(appState?.onboardingFirstPreviewAt),
        hasApplied: Boolean(appState?.onboardingFirstApplyStartAt),
        hasScheduled: Boolean(appState?.onboardingFirstScheduleAt),
        hasCompletedFirstUpdate: Boolean(appState?.onboardingFirstApplyAt),
      },
    });
  } catch (error) {
    console.error("[WELCOME LOADER ERROR]", error);
    throw error;
  }
};

// ================= COMPONENT =================
export default function WelcomePage() {
  console.log("[WELCOME COMPONENT RENDER]");
  if (DEBUG_WELCOME_TEST_RENDER) return <div>Welcome Test</div>;
  const navigate = useNavigate();
  const data = useLoaderData() as { onboarding: OnboardingState };
  const [step, setStep] = useState<WizardStep>("welcome");
  const [onboarding, setOnboarding] = useState<OnboardingState>(() => data.onboarding);

  useEffect(() => {
    setOnboarding(data.onboarding);
  }, [data.onboarding]);

  useEffect(() => {
    if (onboarding.hasCompletedFirstUpdate) {
      setStep("success");
    }
  }, [onboarding.hasCompletedFirstUpdate]);

  return (
    <Page title={t("welcome.pageTitle")}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 0" }}>
        <BlockStack gap="400">
          {step === "welcome" && (
            <WelcomeStep onContinue={() => setStep("create-rule")} />
          )}
          {step === "create-rule" && (
            <CreateRuleStep
              hasRule={onboarding.hasRule}
              onDone={() => {
                setStep("preview-prices");
              }}
              onSkip={() => setStep("preview-prices")}
            />
          )}
          {step === "preview-prices" && (
            <PreviewPricesStep
              hasPreviewed={onboarding.hasPreviewed}
              onDone={() => {
                setStep("apply-update");
              }}
              onSkip={() => setStep("apply-update")}
            />
          )}
          {step === "apply-update" && (
            <ApplyUpdateStep
              hasApplied={onboarding.hasApplied}
              onDone={() => {
                setStep("success");
              }}
              onSkip={() => setStep("success")}
            />
          )}
          {step === "success" && (
            <SuccessStep onGoToDashboard={() => navigate("/app")} />
          )}
        </BlockStack>
      </div>
    </Page>
  );
}

// ─── Step components ────────────────────────────────────────────────────────────

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="150">
          <Text as="p" tone="subdued">
            {t("welcome.hero.line1")}
          </Text>
          <Text as="p" tone="subdued">
            {t("welcome.hero.line2")}
          </Text>
          <Text as="p" tone="subdued">
            {t("welcome.hero.line3")}
          </Text>
          <Text as="p" tone="subdued">
            {t("welcome.hero.why")}
          </Text>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={ShieldCheckMarkIcon} tone="success" />
            <Text as="h3" variant="headingMd">
              {t("welcome.trust.title")}
            </Text>
          </InlineStack>
          <BlockStack gap="200">
            <TrustItem icon={ShieldCheckMarkIcon} label={t("welcome.trust.bulk")} />
            <TrustItem icon={CalendarTimeIcon} label={t("welcome.trust.schedule")} />
            <TrustItem icon={ShieldCheckMarkIcon} label={t("welcome.trust.history")} />
            <TrustItem icon={ShieldCheckMarkIcon} label={t("welcome.trust.revert")} />
            <TrustItem icon={ShieldCheckMarkIcon} label={t("welcome.trust.billing")} />
            <TrustItem icon={ShieldCheckMarkIcon} label={t("welcome.trust.integrated")} />
          </BlockStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={ShieldCheckMarkIcon} tone="success" />
            <Text as="h3" variant="headingMd">
              {t("welcome.safety.title")}
            </Text>
          </InlineStack>
          <Text as="p" tone="subdued">
            {t("welcome.safety.subtitle")}
          </Text>
          <List type="bullet">
            <List.Item>{t("welcome.safety.item1")}</List.Item>
            <List.Item>{t("welcome.safety.item2")}</List.Item>
            <List.Item>{t("welcome.safety.item3")}</List.Item>
            <List.Item>{t("welcome.safety.item4")}</List.Item>
            <List.Item>{t("welcome.safety.item5")}</List.Item>
          </List>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="150">
          <Text as="h3" variant="headingMd">
            {t("welcome.social.title")}
          </Text>
          <Text as="p" tone="subdued">
            {t("welcome.social.subtitle")}
          </Text>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function CreateRuleStep({
  hasRule,
  onDone,
  onSkip,
}: {
  hasRule: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const navigate = useNavigate();

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={hasRule ? CheckIcon : ShieldCheckMarkIcon} tone={hasRule ? "success" : "subdued"} />
            <Text as="h2" variant="headingMd">
              {hasRule
                ? t("welcome.step.createRule.done")
                : t("welcome.step.createRule.title")}
            </Text>
          </InlineStack>
          {hasRule ? (
            <Text as="p" tone="subdued">
              {t("welcome.step.createRule.doneBody")}
            </Text>
          ) : (
            <>
              <Text as="p" tone="subdued">
                {t("welcome.step.createRule.body")}
              </Text>
              <InlineStack gap="200">
                <Button
                  variant="primary"
                  onClick={() => navigate("/app/rules")}
                >
                  {t("welcome.step.createRule.cta")}
                </Button>
                <Button variant="tertiary" onClick={onSkip}>
                  {t("welcome.step.skip")}
                </Button>
              </InlineStack>
            </>
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd">
            {t("welcome.step.createRule.tipTitle")}
          </Text>
          <Text as="p" tone="subdued">
            {t("welcome.step.createRule.tip")}
          </Text>
        </BlockStack>
      </Card>

      <InlineStack gap="200">
        <Button onClick={onDone} disabled={!hasRule}>
          {t("welcome.step.next")}
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

function PreviewPricesStep({
  hasPreviewed,
  onDone,
  onSkip,
}: {
  hasPreviewed: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const navigate = useNavigate();

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Icon
              source={hasPreviewed ? CheckIcon : CalendarTimeIcon}
              tone={hasPreviewed ? "success" : "subdued"}
            />
            <Text as="h2" variant="headingMd">
              {hasPreviewed
                ? t("welcome.step.preview.done")
                : t("welcome.step.preview.title")}
            </Text>
          </InlineStack>
          {hasPreviewed ? (
            <Text as="p" tone="subdued">
              {t("welcome.step.preview.doneBody")}
            </Text>
          ) : (
            <>
              <Text as="p" tone="subdued">
                {t("welcome.step.preview.body")}
              </Text>
              <InlineStack gap="200">
                <Button
                  variant="primary"
                  onClick={() => navigate("/app")}
                >
                  {t("welcome.step.preview.cta")}
                </Button>
                <Button variant="tertiary" onClick={onSkip}>
                  {t("welcome.step.skip")}
                </Button>
              </InlineStack>
            </>
          )}
        </BlockStack>
      </Card>

      <InlineStack gap="200">
        <Button onClick={onDone} disabled={!hasPreviewed}>
          {t("welcome.step.next")}
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

function ApplyUpdateStep({
  hasApplied,
  onDone,
  onSkip,
}: {
  hasApplied: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const navigate = useNavigate();

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Icon
              source={hasApplied ? CheckIcon : ShieldCheckMarkIcon}
              tone={hasApplied ? "success" : "subdued"}
            />
            <Text as="h2" variant="headingMd">
              {hasApplied
                ? t("welcome.step.apply.done")
                : t("welcome.step.apply.title")}
            </Text>
          </InlineStack>
          {hasApplied ? (
            <Text as="p" tone="subdued">
              {t("welcome.step.apply.doneBody")}
            </Text>
          ) : (
            <>
              <Text as="p" tone="subdued">
                {t("welcome.step.apply.body")}
              </Text>
              <InlineStack gap="200">
                <Button
                  variant="primary"
                  onClick={() => navigate("/app")}
                >
                  {t("welcome.step.apply.cta")}
                </Button>
                <Button variant="tertiary" onClick={onSkip}>
                  {t("welcome.step.skip")}
                </Button>
              </InlineStack>
            </>
          )}
        </BlockStack>
      </Card>

      <InlineStack gap="200">
        <Button onClick={onDone} disabled={!hasApplied}>
          {t("welcome.step.next")}
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

function SuccessStep({
  onGoToDashboard,
}: {
  onGoToDashboard: () => void;
}) {
  const paragraphs = t("welcome.success.body").split("\n\n");

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="200" align="center">
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "#ECFDF3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon source={CheckIcon} tone="success" />
          </div>
          <Text as="h2" variant="headingLg" alignment="center">
            {t("welcome.success.title")}
          </Text>
          <BlockStack gap="100" align="center">
            {paragraphs.map((p, i) => (
              <Text key={i} as="p" tone="subdued" alignment="center">
                {p}
              </Text>
            ))}
          </BlockStack>
          <InlineStack gap="200">
            <Button variant="primary" onClick={onGoToDashboard}>
              {t("welcome.success.cta")}
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

// ─── Shared helpers ─────────────────────────────────────────────────────────────

function TrustItem({ icon, label }: { icon: any; label: string }) {
  return (
    <InlineStack gap="200" blockAlign="center">
      <Icon source={icon} tone="success" />
      <Text as="span" variant="bodyMd">
        {label}
      </Text>
    </InlineStack>
  );
}
