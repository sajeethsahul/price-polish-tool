// Fills missing keys in es/fr/de with English values and removes keys
// that no longer exist in en.default.json. Run after check-locales.cjs.
const fs = require("fs");
const en = JSON.parse(fs.readFileSync("app/locales/en.default.json", "utf8"));

function sync(target, source) {
  const report = { filled: 0, removed: 0 };
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    if (
      k in target &&
      target[k] !== null &&
      typeof target[k] === "object" &&
      typeof v === "object"
    ) {
      const [sub, f, r] = sync(target[k], v);
      out[k] = sub;
      report.filled += f;
      report.removed += r;
    } else if (
      k in target &&
      typeof target[k] === typeof v &&
      !Array.isArray(v)
    ) {
      out[k] = target[k]; // keep existing translation
    } else {
      out[k] = v; // missing or type mismatch -> English fallback
      if (!(k in target)) report.filled++;
    }
  }
  return [out, report.filled, report.removed];
}

for (const f of ["es", "fr", "de"]) {
  const p = `app/locales/${f}.json`;
  const loc = JSON.parse(fs.readFileSync(p, "utf8"));
  const [merged, filled] = sync(loc, en);
  // removed = extra keys dropped (approximate by key count diff)
  const before = JSON.stringify(loc).length;
  const after = JSON.stringify(merged).length;
  fs.writeFileSync(p, JSON.stringify(merged, null, 2) + "\n");
  console.log(
    `${f}.json: synced. filled=${filled} (extra keys removed, size ${before} -> ${after})`,
  );
}
