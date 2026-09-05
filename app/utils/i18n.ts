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
// Supported locale codes — add more here when ready (German/English/Spanish/French/Italy/Dutch/Portuguese)
const SUPPORTED_LOCALES = ["es", "fr", "de","it","nl"];

export function detectLocaleFromSession(
  session: { locale?: string } | null | undefined | any
): string {
  const raw = session?.locale;
  if (typeof raw === "string" && raw.length > 0) {
      if (raw.toLowerCase() === "pt-br") return "pt-BR";
    const base = raw.toLowerCase().split("-")[0];
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  // Everything else → English
  return "en.default";
}

/**
 * Server-side helper: given a session (and optionally an explicit locale
 * override sent by the client), set the active dictionary and return
 * the resolved locale id. Call this at the top of API loaders/actions before
 * using t() to localize response messages.
 */
export function applyLocaleFromSession(
  session: { locale?: string } | null | undefined | any,
  overrideLocale?: string | null,
): string {
  let localeId: string | null = null;

  if (typeof overrideLocale === "string" && overrideLocale.length > 0) {
    const base = overrideLocale.toLowerCase().split("-")[0];
    if (SUPPORTED_LOCALES.includes(base)) localeId = base;
  }

  if (!localeId) localeId = detectLocaleFromSession(session);

  setLocale(localeId);
  return localeId;
}

// Client-side locale init: the Remix loader sets the locale server-side,
// but the browser bundle re-initialises this module with the default locale.
// Read the locale injected into window.__LOCALE__ by root.tsx and apply it.
if (typeof window !== "undefined" && (window as any).__LOCALE__) {
  setLocale((window as any).__LOCALE__);
}