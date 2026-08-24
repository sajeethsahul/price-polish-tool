import enDefault from "../locales/en.default.json";

type Dictionary = typeof enDefault;

type Join<K, P> = K extends string
  ? P extends string
    ? `${K}.${P}`
    : never
  : never;

type TranslationKeyOf<T> = T extends string
  ? never
  : {
      [K in Extract<keyof T, string>]: T[K] extends string
        ? K
        : Join<K, TranslationKeyOf<T[K]>>;
    }[Extract<keyof T, string>];

export type TranslationKey = TranslationKeyOf<Dictionary>;

const localeModules = import.meta.glob("../locales/*.json", {
  eager: true,
}) as Record<string, { default?: unknown }>;

const DEFAULT_LOCALE_ID = "en.default";

function resolveLocaleDictionary(localeId: string): Dictionary {
  for (const [path, mod] of Object.entries(localeModules)) {
    const fileName = path.split("/").pop() ?? "";
    const id = fileName.replace(/\.json$/i, "");
    if (id === localeId && mod?.default && typeof mod.default === "object") {
      return mod.default as Dictionary;
    }
  }
  return enDefault;
}

let activeDictionary: Dictionary = resolveLocaleDictionary(DEFAULT_LOCALE_ID);

export function setLocale(localeId: string): void {
  activeDictionary =
    resolveLocaleDictionary(localeId) ??
    resolveLocaleDictionary(DEFAULT_LOCALE_ID);
}

export function getActiveDictionary(): Dictionary {
  return activeDictionary;
}

function getValueAtPath(obj: unknown, parts: string[]): unknown {
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function t(key: TranslationKey): string {
  const value = getValueAtPath(activeDictionary, key.split("."));
  return typeof value === "string" ? value : key;
}

/**
 * Server-side locale detection helper.
 * Detects the locale from a Shopify session (BCP-47) or falls back to "en".
 * Call setLocale() with the detected value before using t() server-side.
 */
export function detectLocaleFromSession(session: { locale?: string } | null | undefined | any): string {
  const raw = session?.locale;
  if (typeof raw === "string" && raw.length > 0) {
    const normalized = raw.toLowerCase();
    if (normalized.startsWith("es")) return "es";
    if (normalized.startsWith("en")) return "en.default";
  }
  return "en.default";
}

/**
 * Server-side helper: given a session, set the active dictionary and return
 * the resolved locale id. Call this at the top of API loaders/actions before
 * using t() to localize response messages.
 */
export function applyLocaleFromSession(session: { locale?: string } | null | undefined | any): string {
  const localeId = detectLocaleFromSession(session);
  setLocale(localeId);
  return localeId;
}

// Client-side locale init: the Remix loader sets the locale server-side,
// but the browser bundle re-initialises this module with the default locale.
// Read the locale injected into window.__LOCALE__ by root.tsx and apply it.
if (typeof window !== "undefined" && (window as any).__LOCALE__) {
  setLocale((window as any).__LOCALE__);
}