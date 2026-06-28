import { useEffect, useMemo, useState } from "react";
import { BlockStack, Card, Icon, InlineStack, Spinner, Text } from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { t } from "../utils/i18n";

type Stage = "preparing" | "still" | "almost";

function getStage(elapsedMs: number): Stage {
  if (elapsedMs < 2000) return "preparing";
  if (elapsedMs < 5000) return "still";
  return "almost";
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setPrefersReducedMotion(Boolean(media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return prefersReducedMotion;
}

export function AppLaunchSplash({
  minHeight = "100vh",
}: {
  minHeight?: number | string;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  const stage = getStage(now - startedAt);

  const status = useMemo(() => {
    if (stage === "preparing") {
      return {
        title: t("loading.preparingWorkspace"),
        subtitle: "",
      };
    }
    if (stage === "still") {
      return {
        title: t("loading.stillLoading"),
        subtitle: t("loading.storeSafe"),
      };
    }
    return {
      title: t("loading.almostReady"),
      subtitle: t("loading.connectionFinalizing"),
    };
  }, [stage]);

  const trustMessages = useMemo(
    () => [
      t("loading.trust.priceUnchanged"),
      t("loading.trust.reviewBeforePublish"),
      t("loading.trust.campaignHistory"),
      t("loading.trust.revertAnytime"),
    ],
    []
  );

  const [trustIndex, setTrustIndex] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const interval = window.setInterval(() => {
      setTrustIndex((i) => (i + 1) % trustMessages.length);
    }, 2800);
    return () => window.clearInterval(interval);
  }, [prefersReducedMotion, trustMessages.length]);

  const checklist = useMemo(
    () => [
      t("loading.secureConnection"),
      t("loading.subscriptionVerified"),
      t("loading.pricingEngineReady"),
    ],
    []
  );

  return (
    <div
      style={{
        minHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#F6F6F7",
      }}
      aria-busy="true"
    >
      <div style={{ width: "min(760px, 100%)" }}>
        <BlockStack gap="500" align="center">
          <BlockStack gap="100" align="center">
            <Text as="h1" variant="headingLg">
              {t("loading.appName")}
            </Text>
            <Text as="p" tone="subdued">
              {t("loading.tagline")}
            </Text>
          </BlockStack>

          <Card>
            <BlockStack gap="400" align="center">
              <div aria-live="polite">
                <BlockStack gap="100" align="center">
                  <Text as="h2" variant="headingMd">
                    {status.title}
                  </Text>
                  {status.subtitle ? (
                    <Text as="p" tone="subdued">
                      {status.subtitle}
                    </Text>
                  ) : null}
                </BlockStack>
              </div>

              <Spinner accessibilityLabel={status.title} size="large" />

              <BlockStack gap="150" align="start">
                {checklist.map((label) => (
                  <InlineStack key={label} gap="200" blockAlign="center">
                    <Icon source={CheckIcon} tone="success" />
                    <Text as="span">{label}</Text>
                  </InlineStack>
                ))}
              </BlockStack>

              <Text as="p" tone="subdued">
                {t("loading.usuallyTakesSeconds")}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200" align="center">
              <Text as="p" tone="subdued" alignment="center">
                {trustMessages[trustIndex] ?? trustMessages[0]}
              </Text>
            </BlockStack>
          </Card>
        </BlockStack>
      </div>
    </div>
  );
}
