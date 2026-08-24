// Temporary i18n patching script — adds preview.* and settings.page.description keys.
import { readFileSync, writeFileSync } from "node:fs";

function detectEol(str) {
  return str.includes("\r\n") ? "\r\n" : "\n";
}

const EN_PREVIEW = {
  backToDashboard: "Back to dashboard",
  currency: "Currency: {currencyCode}",
  showingCount: "Showing {visible} of {total} products",
  showFewer: "Show fewer",
  viewFull: "View Full Preview",
  collapseAria: "Collapse the preview list back to the first {count} products",
  expandAria: "Expand the preview to show all {count} products",
  previousStep: "\u2190 Previous Step",
  previousStepAria: "Return to Step 1: Create Pricing Rule",
  continue: "Continue \u2192",
  continueAria: "Continue to Step 3: Apply Pricing",
  priceChange: "Old: {old} \u2192 New: {new}",
  empty: {
    heading: "No products to preview yet",
    action: "Adjust pricing rule",
    body: "Once you create or refine a pricing rule, we'll show a live preview of the new prices here so you can review them before applying.",
  },
};

const ES_PREVIEW = {
  backToDashboard: "Volver al panel",
  currency: "Moneda: {currencyCode}",
  showingCount: "Mostrando {visible} de {total} productos",
  showFewer: "Mostrar menos",
  viewFull: "Ver vista completa",
  collapseAria: "Colapsar la lista de vista previa a los primeros {count} productos",
  expandAria: "Expandir la vista previa para mostrar todos los {count} productos",
  previousStep: "\u2190 Paso anterior",
  previousStepAria: "Volver al Paso 1: Crear regla de precios",
  continue: "Continuar \u2192",
  continueAria: "Continuar al Paso 3: Aplicar precios",
  priceChange: "Antes: {old} \u2192 Despu\u00e9s: {new}",
  empty: {
    heading: "A\u00fan no hay productos para previsualizar",
    action: "Ajustar la regla de precios",
    body: "Una vez que cree o refuerce una regla de precios, le mostraremos una vista previa en vivo de los nuevos precios aqu\u00ed para que los revise antes de aplicar.",
  },
};

const EN_SETTINGS_DESC =
  "Price Polish automatically uses your Shopify store currency. Advanced settings coming soon.";
const ES_SETTINGS_DESC =
  "Price Polish usa autom\u00e1ticamente la moneda de su tienda Shopify. Configuraci\u00f3n avanzada pr\u00f3ximamente.";

function blockJson(obj, indent) {
  // Render a JSON object literal block with `indent` leading spaces, no trailing comma on last entry handled by caller.
  const pad = " ".repeat(indent);
  const pad2 = " ".repeat(indent + 2);
  const lines = [];
  lines.push(pad + "{");
  const keys = Object.keys(obj);
  keys.forEach((k, i) => {
    const v = obj[k];
    const isLast = i === keys.length - 1;
    const comma = isLast ? "" : ",";
    if (v && typeof v === "object" && !Array.isArray(v)) {
      // nested object on one line is not desired; render multi-line then close inline
      const inner = blockJson(v, indent + 4);
      // inner starts with pad+4 "{", ends with "    }" — we want: "key": {\n ... \n    }
      lines.push(pad2 + JSON.stringify(k) + ": " + inner.trimEnd().replace(/^\s*/, ""));
      // The above is messy; simpler: emit nested manually.
    } else {
      lines.push(pad2 + JSON.stringify(k) + ": " + JSON.stringify(v) + comma);
    }
  });
  lines[lines.length - 1] = lines[lines.length - 1].replace(/,?$/, (m) => (m === "," ? "" : m));
  lines.push(pad + "}");
  return lines.join("\n");
}

// Build the preview block lines directly to control formatting/exact output.
function buildPreviewBlock(preview, eol) {
  const lines = [];
  lines.push('  "preview": {');
  const keys = Object.keys(preview);
  keys.forEach((k, i) => {
    const v = preview[k];
    const comma = i < keys.length - 1 ? "," : "";
    if (v && typeof v === "object" && !Array.isArray(v)) {
      lines.push(`    ${JSON.stringify(k)}: {`);
      const subKeys = Object.keys(v);
      subKeys.forEach((sk, si) => {
        const sc = si < subKeys.length - 1 ? "," : "";
        lines.push(`      ${JSON.stringify(sk)}: ${JSON.stringify(v[sk])}${sc}`);
      });
      lines.push(`    }${comma}`);
    } else {
      lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(v)}${comma}`);
    }
  });
  lines.push("  },");
  return lines.join(eol);
}

function patchFile(file, settingsTitle, settingsDesc, preview) {
  const raw = readFileSync(file, "utf8");
  const eol = detectEol(raw);

  const anchor =
    `  "settings": {${eol}` +
    `    "page": {${eol}` +
    `      "title": ${JSON.stringify(settingsTitle)}${eol}` +
    `    }${eol}` +
    `  },${eol}` +
    `  "loader": {`;

  const settingsNew =
    `  "settings": {${eol}` +
    `    "page": {${eol}` +
    `      "title": ${JSON.stringify(settingsTitle)},${eol}` +
    `      "description": ${JSON.stringify(settingsDesc)}${eol}` +
    `    }${eol}` +
    `  },${eol}` +
    buildPreviewBlock(preview, eol) + `${eol}` +
    `  "loader": {`;

  if (!raw.includes(anchor)) {
    console.error(`[FAIL] ${file}: anchor not found. Aborting.`);
    console.error("Anchor looked for:");
    console.error(anchor);
    return false;
  }
  const occurrences = raw.split(anchor).length - 1;
  if (occurrences !== 1) {
    console.error(`[FAIL] ${file}: anchor found ${occurrences} times, expected 1. Aborting.`);
    return false;
  }

  const out = raw.replace(anchor, settingsNew);

  // Safety: ensure we didn't accidentally add duplicate preview blocks
  const previewCount = (out.match(/(^|\r?\n)\s*"preview":\s*\{/g) || []).length;
  const descCount = (out.match(/"description"/g) || []).length;

  // Verify JSON validity
  try {
    JSON.parse(out);
  } catch (e) {
    console.error(`[FAIL] ${file}: resulting JSON is invalid: ${e.message}`);
    return false;
  }

  writeFileSync(file, out, "utf8");
  console.log(`[OK]   ${file}: patched. preview block occurrences=${previewCount}, description occurrences=${descCount}`);
  return true;
}

let ok = true;
ok = patchFile("app/locales/en.default.json", "Advanced Settings", EN_SETTINGS_DESC, EN_PREVIEW) && ok;
ok = patchFile("app/locales/es.json", "Configuraci\u00f3n Avanzada", ES_SETTINGS_DESC, ES_PREVIEW) && ok;

console.log(ok ? "ALL PATCHES APPLIED." : "SOME PATCHES FAILED.");
