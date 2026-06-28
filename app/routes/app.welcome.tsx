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

type WizardStep = "welcome" | "create-rule" | "preview-prices" | "apply-update";

interface OnboardingState {
  hasRule: boolean;
  hasPreviewed: boolean;
  hasApplied: boolean;
}

// ================= LOADER =================
export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("[WELCOME LOADER START]", request.url);
  try {
    let auth: Awaited<ReturnType<typeof authenticate.admin>>;
    try {
      auth = await authenticate.admin(request);
    } catch (error) {
      if (error instanceof Response) {
        console.log("[WELCOME AUTH REDIRECT]", error.headers.get("Location"));
        return error;
      }
      throw error;
    }

    if (auth instanceof Response) {
      const location = auth.headers.get("Location");
      console.log("[WELCOME AUTH REDIRECT]", location);
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
        onboardingFirstApplyAt: true,
      },
    });

    console.log("[WELCOME LOADER SUCCESS]");
    return Response.json({
      shop,
      onboarding: {
        hasRule: Boolean(appState?.onboardingFirstRuleAt),
        hasPreviewed: Boolean(appState?.onboardingFirstPreviewAt),
        hasApplied: Boolean(appState?.onboardingFirstApplyAt),
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      console.log("[WELCOME AUTH REDIRECT]", error.headers.get("Location"));
      return error;
    }

    console.error("[WELCOME LOADER ERROR]", error);
    throw error;
  }
};

// ================= COMPONENT =================
export default function WelcomePage() {
  const navigate = useNavigate();
  const data = useLoaderData() as { onboarding: OnboardingState };
  const [step, setStep] = useState<WizardStep>("welcome");
  const [onboarding, setOnboarding] = useState<OnboardingState>(() => data.onboarding);

  useEffect(() => {
    setOnboarding(data.onboarding);
  }, [data.onboarding]);

  return (
    <Page title={t("welcome.pageTitle")}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 0" }}>
        <BlockStack gap="400">
          {step === "welcome" && (
            <WelcomeStep
              onGetStarted={() => setStep("create-rule")}
            />
          )}
          {step === "create-rule" && (
            <CreateRuleStep
              hasRule={onboarding.hasRule}
              onDone={() => setStep("preview-prices")}
              onSkip={() => setStep("preview-prices")}
            />
          )}
          {step === "preview-prices" && (
            <PreviewPricesStep
              hasPreviewed={onboarding.hasPreviewed}
              onDone={() => setStep("apply-update")}
              onSkip={() => setStep("apply-update")}
            />
          )}
          {step === "apply-update" && (
            <ApplyUpdateStep
              hasApplied={onboarding.hasApplied}
              onDone={() => navigate("/app")}
              onSkip={() => navigate("/app/preview")}
            />
          )}
        </BlockStack>
      </div>
    </Page>
  );
}

// ─── Step components ────────────────────────────────────────────────────────────

function WelcomeStep({ onGetStarted }: { onGetStarted: () => void }) {
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
          <InlineStack gap="200">
            <Button
              variant="primary"
              onClick={() => {
                onGetStarted();
              }}
            >
              {t("welcome.hero.primary")}
            </Button>
          </InlineStack>
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
                  onClick={() => navigate("/app/preview")}
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
