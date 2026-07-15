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

      <InlineStack gap="200">
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

      <InlineStack gap="200">
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
                <Button onClick={onSkip}>
                  {t("welcome.step.skip")}
                </Button>
              </InlineStack>
            </>
          )}
        </BlockStack>
      </Card>

      <InlineStack gap="200">
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
