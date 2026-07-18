import { useEffect, useState } from "react";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  Icon,
  InlineGrid,
  InlineStack,
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

const VALID_WIZARD_STEPS: readonly WizardStep[] = [
  "welcome",
  "create-rule",
  "preview-prices",
  "apply-update",
];

function parseWizardStepParam(value: string | null): WizardStep | null {
  if (!value) return null;
  return (VALID_WIZARD_STEPS as readonly string[]).includes(value)
    ? (value as WizardStep)
    : null;
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const isRevisit = searchParams.get("revisit") === "1";
  const stepParam = parseWizardStepParam(searchParams.get("step"));
  const [step, setStepState] = useState<WizardStep>(stepParam ?? "welcome");
  const [onboarding, setOnboarding] = useState<OnboardingState>(() => data.onboarding);

  // Preserve `revisit=1` through outbound navigation so that the app.tsx
  // loader guard (onboarded → /app/welcome ⇒ redirect) does not fire when
  // an already-onboarded merchant is browsing the wizard via "Revisit Setup".
  const withOnboardingContext = (path: string) => {
    const url = new URL(path, "http://placeholder");
    url.searchParams.set("from", "onboarding");
    if (isRevisit) url.searchParams.set("revisit", "1");
    return `${url.pathname}${url.search}`;
  };

  // Keep local wizard step in sync with the URL (?step=). This enables
  // deep-links from Phase 2 return-to-wizard flows (e.g. Rules save →
  // /app/welcome?step=preview-prices) and preserves position on refresh
  // or browser back/forward navigation.
  useEffect(() => {
    const next = parseWizardStepParam(searchParams.get("step"));
    if (next && next !== step) {
      setStepState(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setStep = (next: WizardStep) => {
    if (next === step) return;
    setStepState(next);
    const params = new URLSearchParams(searchParams);
    if (next === "welcome") {
      params.delete("step");
    } else {
      params.set("step", next);
    }
    setSearchParams(params, { replace: true });
  };

  useEffect(() => {
    setOnboarding(data.onboarding);
  }, [data.onboarding]);

  return (
    <Page title={t("welcome.pageTitle")}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 0" }}>
        <BlockStack gap="400">
          {isRevisit ? (
            <Banner
              tone="info"
              title="You're revisiting the setup guide"
            >
              <p>
                Reopening the guide won't change your pricing rules, published prices, or any existing configuration. Feel free to review the steps and close this page whenever you're done.
              </p>
            </Banner>
          ) : null}
          {step !== "welcome" ? (
            <StepIndicator step={step} onboarding={onboarding} />
          ) : null}
          {step === "welcome" && (
            <WelcomeStep
              onGetStarted={() => setStep("create-rule")}
            />
          )}
          {step === "create-rule" && (
            <CreateRuleStep
              hasRule={onboarding.hasRule}
              onPrimary={() => navigate(withOnboardingContext("/app/rules"))}
              onDone={() => setStep("preview-prices")}
              onSkip={() => setStep("preview-prices")}
            />
          )}
          {step === "preview-prices" && (
            <PreviewPricesStep
              hasPreviewed={onboarding.hasPreviewed}
              onPrimary={() => navigate(withOnboardingContext("/app/preview"))}
              onDone={() => setStep("apply-update")}
              onSkip={() => setStep("apply-update")}
            />
          )}
          {step === "apply-update" && (
            <ApplyUpdateStep
              hasApplied={onboarding.hasApplied}
              onDone={() => navigate("/app")}
              onSkip={() => navigate("/app")}
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
      {/* HERO — single dominant CTA, scannable proof points */}
      <Card>
        <BlockStack gap="500">
          <BlockStack gap="200">
            <Text as="h1" variant="headingXl">
              {t("welcome.landing.heroTitle")}
            </Text>
            <Text as="p" variant="bodyLg" tone="subdued">
              {t("welcome.landing.heroSubtitle")}
            </Text>
          </BlockStack>

          <BlockStack gap="200">
            <HeroBullet label={t("welcome.landing.heroBullet1")} />
            <HeroBullet label={t("welcome.landing.heroBullet2")} />
            <HeroBullet label={t("welcome.landing.heroBullet3")} />
            <HeroBullet label={t("welcome.landing.heroBullet4")} />
          </BlockStack>

          <InlineStack gap="300" blockAlign="center" wrap>
            <Button
              variant="primary"
              size="large"
              onClick={onGetStarted}
            >
              {t("welcome.landing.heroPrimary")}
            </Button>
            <Button variant="plain" onClick={onGetStarted}>
              {t("welcome.landing.heroSecondary")}
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>

      {/* HOW IT WORKS — compact 3-step strip */}
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            {t("welcome.landing.howItWorksTitle")}
          </Text>
          <InlineStack gap="400" wrap blockAlign="center">
            <StepChip index={1} label={t("welcome.landing.step1")} />
            <StepConnector />
            <StepChip index={2} label={t("welcome.landing.step2")} />
            <StepConnector />
            <StepChip index={3} label={t("welcome.landing.step3")} />
          </InlineStack>
        </BlockStack>
      </Card>

      {/* PROTECTION — 2-column feature grid, icon + title + one-line body */}
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {t("welcome.landing.protectionTitle")}
          </Text>
          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
            <FeatureItem
              icon={CheckIcon}
              title={t("welcome.landing.protection1Title")}
              body={t("welcome.landing.protection1Body")}
            />
            <FeatureItem
              icon={CheckIcon}
              title={t("welcome.landing.protection2Title")}
              body={t("welcome.landing.protection2Body")}
            />
            <FeatureItem
              icon={CalendarTimeIcon}
              title={t("welcome.landing.protection3Title")}
              body={t("welcome.landing.protection3Body")}
            />
            <FeatureItem
              icon={CheckIcon}
              title={t("welcome.landing.protection4Title")}
              body={t("welcome.landing.protection4Body")}
            />
            <FeatureItem
              icon={ShieldCheckMarkIcon}
              title={t("welcome.landing.protection5Title")}
              body={t("welcome.landing.protection5Body")}
            />
            <FeatureItem
              icon={CheckIcon}
              title={t("welcome.landing.protection6Title")}
              body={t("welcome.landing.protection6Body")}
            />
          </InlineGrid>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function HeroBullet({ label }: { label: string }) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          flexShrink: 0,
        }}
      >
        <Icon source={CheckIcon} tone="success" />
      </span>
      <Text as="span" variant="bodyMd">
        {label}
      </Text>
    </InlineStack>
  );
}

function StepChip({ index, label }: { index: number; label: string }) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <span
        aria-label={`Step ${index}`}
        role="img"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "var(--p-color-bg-fill-emphasis)",
          color: "var(--p-color-text-inverse)",
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {index}
      </span>
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {label}
      </Text>
    </InlineStack>
  );
}

function StepConnector() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 24,
        height: 2,
        background: "var(--p-color-border)",
        borderRadius: 1,
        flexShrink: 0,
      }}
    />
  );
}

function FeatureItem({
  icon,
  title,
  body,
}: {
  icon: any;
  title: string;
  body: string;
}) {
  return (
    <InlineStack gap="300" blockAlign="start" wrap={false}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <Icon source={icon} tone="success" />
      </span>
      <BlockStack gap="050">
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {title}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {body}
        </Text>
      </BlockStack>
    </InlineStack>
  );
}

function CreateRuleStep({
  hasRule,
  onPrimary,
  onDone,
  onSkip,
}: {
  hasRule: boolean;
  onPrimary: () => void;
  onDone: () => void;
  onSkip: () => void;
}) {
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
                  onClick={onPrimary}
                >
                  {t("welcome.step.createRule.cta")}
                </Button>
                <Button onClick={onSkip}>
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

      <InlineStack gap="200" align="end">
        <Button variant="primary" onClick={onDone} disabled={!hasRule}>
          {t("welcome.step.next")}
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

function PreviewPricesStep({
  hasPreviewed,
  onPrimary,
  onDone,
  onSkip,
}: {
  hasPreviewed: boolean;
  onPrimary: () => void;
  onDone: () => void;
  onSkip: () => void;
}) {
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
                  onClick={onPrimary}
                >
                  {t("welcome.step.preview.cta")}
                </Button>
                <Button onClick={onSkip}>
                  {t("welcome.step.skip")}
                </Button>
              </InlineStack>
            </>
          )}
        </BlockStack>
      </Card>

      <InlineStack gap="200" align="end">
        <Button variant="primary" onClick={onDone} disabled={!hasPreviewed}>
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
                {/*
                <Button onClick={onSkip}>
                  {t("welcome.step.skip")}
                </Button>
                */}
              </InlineStack>
            </>
          )}
        </BlockStack>
      </Card>

      <InlineStack gap="200" align="end">
        <Button variant="primary" onClick={onDone} disabled={!hasApplied}>
          {t("welcome.step.next")}
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

// ─── Shared helpers ─────────────────────────────────────────────────────────────

const WIZARD_STEP_ORDER: Array<{
  key: Exclude<WizardStep, "welcome">;
  label: string;
  completedKey: keyof OnboardingState;
}> = [
  { key: "create-rule", label: "Create Pricing Rule", completedKey: "hasRule" },
  { key: "preview-prices", label: "Preview Prices", completedKey: "hasPreviewed" },
  { key: "apply-update", label: "Apply Pricing", completedKey: "hasApplied" },
];

function StepIndicator({
  step,
  onboarding,
}: {
  step: WizardStep;
  onboarding: OnboardingState;
}) {
  const activeIndex = WIZARD_STEP_ORDER.findIndex((entry) => entry.key === step);
  const currentIndex = activeIndex >= 0 ? activeIndex : 0;
  const currentEntry = WIZARD_STEP_ORDER[currentIndex];
  const totalSteps = WIZARD_STEP_ORDER.length;

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <Text as="p" variant="bodySm" tone="subdued">
            {`Step ${currentIndex + 1} of ${totalSteps}`}
          </Text>
          <Text as="p" variant="bodySm" fontWeight="semibold">
            {currentEntry.label}
          </Text>
        </InlineStack>
        <Divider />
        <InlineStack
          gap="200"
          blockAlign="center"
          wrap
          aria-label={`Onboarding progress. Currently on step ${currentIndex + 1} of ${totalSteps}: ${currentEntry.label}.`}
        >
          {WIZARD_STEP_ORDER.map((entry, index) => {
            const isCompleted = Boolean(onboarding[entry.completedKey]);
            const isActive = index === currentIndex;
            const progress: "complete" | "partiallyComplete" | "incomplete" = isCompleted
              ? "complete"
              : isActive
              ? "partiallyComplete"
              : "incomplete";
            const tone: "success" | "attention" | undefined = isCompleted
              ? "success"
              : isActive
              ? "attention"
              : undefined;

            return (
              <Badge
                key={entry.key}
                progress={progress}
                tone={tone}
              >
                {`Step ${index + 1}: ${entry.label}`}
              </Badge>
            );
          })}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
