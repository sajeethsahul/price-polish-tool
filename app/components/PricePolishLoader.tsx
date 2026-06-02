import { useEffect, useMemo, useState } from "react";

export type PricePolishLoaderCopy = {
  title: string;
  subtitle: string;
};

export const PRICE_POLISH_LOADER_COPY = {
  dashboard: {
    title: "Preparing your pricing workspace...",
    subtitle: "Loading storefront status, schedules, and campaign activity...",
  },
  campaignHistory: {
    title: "Reviewing campaign history...",
    subtitle: "Loading pricing campaigns and operational events...",
  },
  pricingRules: {
    title: "Polishing your pricing rules...",
    subtitle: "Loading pricing strategy and automation settings...",
  },
  help: {
    title: "Opening the help center...",
    subtitle: "Loading guides and best practices...",
  },
  settings: {
    title: "Preparing your preferences...",
    subtitle: "Loading store configuration...",
  },
  campaignDetails: {
    title: "Inspecting campaign details...",
    subtitle: "Loading tracked products and pricing history...",
  },
  revertPreview: {
    title: "Verifying restore information...",
    subtitle: "Preparing pricing recovery preview...",
  },
} satisfies Record<string, PricePolishLoaderCopy>;

export function resolvePricePolishLoaderCopy(pathname: string | null | undefined): PricePolishLoaderCopy {
  const normalized = (pathname ?? "").toLowerCase();
  if (normalized === "/app" || normalized === "/app/") return PRICE_POLISH_LOADER_COPY.dashboard;
  if (normalized.startsWith("/app/campaign-history")) return PRICE_POLISH_LOADER_COPY.campaignHistory;
  if (normalized.startsWith("/app/rules")) return PRICE_POLISH_LOADER_COPY.pricingRules;
  if (normalized.startsWith("/app/help")) return PRICE_POLISH_LOADER_COPY.help;
  if (normalized.startsWith("/app/settings")) return PRICE_POLISH_LOADER_COPY.settings;
  return PRICE_POLISH_LOADER_COPY.dashboard;
}

export function useDelayedVisibility(isActive: boolean, delayMs = 300) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setVisible(false);
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, isActive]);

  return visible;
}

export function PricePolishLoader({
  title,
  subtitle,
  minHeight = "70vh",
}: {
  title: string;
  subtitle: string;
  minHeight?: number | string;
}) {
  const hintMessages = useMemo(
    () => [
      "Syncing storefront status...",
      "Loading pricing rules...",
      "Fetching recent campaigns...",
      "Preparing operational controls...",
    ],
    []
  );

  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setMsgIndex((i) => (i + 1) % hintMessages.length);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [hintMessages.length]);

  return (
    <div
      style={{
        minHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
        aria-busy="true"
      >
        <style>{`
          @keyframes pp-bounce {
            0%, 100% { transform: translate(-50%, -50%) scale(1); }
            50%      { transform: translate(-50%, -55%) scale(1.06); }
          }
          @keyframes pp-shadow-pulse {
            0%, 100% { transform: translateX(-50%) scaleX(1); opacity: 0.16; }
            50%      { transform: translateX(-50%) scaleX(0.55); opacity: 0.10; }
          }
          @keyframes pp-shimmer {
            0%   { background-position: -400px 0; }
            100% { background-position:  400px 0; }
          }
          @keyframes pp-fade-slide {
            0%   { opacity: 0; transform: translateY(8px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          @keyframes pp-orbit {
            from { transform: rotate(0deg)   translateX(38px) rotate(0deg); }
            to   { transform: rotate(360deg) translateX(38px) rotate(-360deg); }
          }
          @keyframes pp-orbit2 {
            from { transform: rotate(180deg) translateX(38px) rotate(-180deg); }
            to   { transform: rotate(540deg) translateX(38px) rotate(-540deg); }
          }
        `}</style>

        <div style={{ position: "relative", width: 100, height: 100 }}>
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              fontSize: 52,
              animation: "pp-bounce 1.4s cubic-bezier(.36,.07,.19,.97) infinite",
              filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.18))",
              zIndex: 2,
              userSelect: "none",
            }}
          >
            💰
          </div>

          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              fontSize: 18,
              animation: "pp-orbit 2.2s linear infinite",
              transformOrigin: "0 0",
              userSelect: "none",
            }}
          >
            🪙
          </div>

          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              fontSize: 14,
              animation: "pp-orbit2 2.2s linear infinite",
              transformOrigin: "0 0",
              userSelect: "none",
            }}
          >
            ✨
          </div>

          <div
            style={{
              position: "absolute",
              bottom: -4,
              left: "50%",
              transform: "translateX(-50%)",
              width: 38,
              height: 8,
              borderRadius: "50%",
              background: "rgba(0,0,0,0.18)",
              animation: "pp-shadow-pulse 1.4s cubic-bezier(.36,.07,.19,.97) infinite",
            }}
          />
        </div>

        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            background: "linear-gradient(90deg, #4f46e5, #7c3aed, #2563eb)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-0.3px",
          }}
        >
          Price Polish
        </div>

        <div style={{ textAlign: "center", maxWidth: 520 }}>
          <div style={{ fontSize: 16, color: "#111827", fontWeight: 600, lineHeight: 1.3 }}>
            {title}
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#6b7280", fontWeight: 500, lineHeight: 1.5 }}>
            {subtitle}
          </div>
        </div>

        <div
          key={msgIndex}
          style={{
            fontSize: 12,
            color: "#9ca3af",
            fontWeight: 500,
            animation: "pp-fade-slide 0.4s ease both",
            textAlign: "center",
            maxWidth: 360,
            letterSpacing: "0.3px",
          }}
        >
          {hintMessages[msgIndex]}
        </div>

        <div
          style={{
            width: 240,
            height: 6,
            borderRadius: 99,
            background: "#e5e7eb",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 99,
              background:
                "linear-gradient(90deg, #e5e7eb 25%, #a5b4fc 50%, #818cf8 60%, #e5e7eb 80%)",
              backgroundSize: "800px 100%",
              animation: "pp-shimmer 1.6s linear infinite",
            }}
          />
        </div>
      </div>
    </div>
  );
}

