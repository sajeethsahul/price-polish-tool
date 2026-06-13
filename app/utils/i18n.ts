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

const dictionary: Dictionary = resolveLocaleDictionary(DEFAULT_LOCALE_ID);

function getValueAtPath(obj: unknown, parts: string[]): unknown {
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function t(key: TranslationKey): string {
  const value = getValueAtPath(dictionary, key.split("."));
  return typeof value === "string" ? value : key;
}

