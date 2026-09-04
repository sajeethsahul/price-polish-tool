const fs = require("fs");
function flat(o, p = "") {
  let out = [];
  for (const [k, v] of Object.entries(o)) {
    const key = p ? p + "." + k : k;
    if (v && typeof v === "object") out = out.concat(flat(v, key));
    else out.push(key);
  }
  return out;
}
const en = flat(
  JSON.parse(fs.readFileSync("app/locales/en.default.json", "utf8")),
);
for (const f of ["es", "fr", "de"]) {
  const d = flat(JSON.parse(fs.readFileSync(`app/locales/${f}.json`, "utf8")));
  const missing = en.filter((k) => !d.includes(k));
  const extra = d.filter((k) => !en.includes(k));
  console.log(`=== ${f}.json ===`);
  console.log("missing:", missing.length, JSON.stringify(missing));
  console.log("extra:", extra.length, JSON.stringify(extra));
}
