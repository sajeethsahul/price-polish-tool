const fs = require("fs");
for (const f of fs.readdirSync("app/locales")) {
  const j = JSON.parse(fs.readFileSync("app/locales/" + f, "utf8"));
  const p = j.preview || {};
  console.log(
    f,
    "search:",
    !!p.searchPlaceholder,
    "filter:",
    !!p.filterLabel,
    "pageInfo:",
    !!p.pageInfo,
    "prev:",
    !!p.previousPage,
    "noRes:",
    !!p.noResultsHeading,
  );
}
