const fs = require("fs");

// 1) JSON validity + key presence
const en = JSON.parse(fs.readFileSync("app/locales/en.default.json", "utf8"));
const es = JSON.parse(fs.readFileSync("app/locales/es.json", "utf8"));
console.log("=== JSON VALIDATION ===");
console.log("Both locale files parsed OK");
console.log("en.common.apply =", JSON.stringify(en.common.apply));
console.log("es.common.apply =", JSON.stringify(es.common.apply));
console.log("en.common.cancel =", JSON.stringify(en.common.cancel));
console.log("es.common.cancel =", JSON.stringify(es.common.cancel));
console.log("en.toast.campaignTitleRequired =", JSON.stringify(en.toast.campaignTitleRequired));
console.log("es.toast.campaignTitleRequired =", JSON.stringify(es.toast.campaignTitleRequired));
console.log("en.bulk.modal.singleItemIncrease =", JSON.stringify(en.bulk.modal.singleItemIncrease));
console.log("en.bulk.modal.singleItemDecrease =", JSON.stringify(en.bulk.modal.singleItemDecrease));
console.log("en.bulk.modal.singleItemNoChange =", JSON.stringify(en.bulk.modal.singleItemNoChange));
console.log("es.bulk.modal.singleItemIncrease =", JSON.stringify(es.bulk.modal.singleItemIncrease));
console.log("es.bulk.modal.singleItemDecrease =", JSON.stringify(es.bulk.modal.singleItemDecrease));
console.log("es.bulk.modal.singleItemNoChange =", JSON.stringify(es.bulk.modal.singleItemNoChange));

// 2) Whitespace / indentation check on component
console.log("\n=== COMPONENT INDENTATION (lines 80-170) ===");
const lines = fs.readFileSync("app/components/ImmediateApplyConfirmationModal.tsx", "utf8").split("\n");
for (let i = 80; i <= 170; i++) {
  const line = lines[i - 1];
  if (line === undefined) break;
  const indent = line.match(/^\s*/)[0].replace(/ /g, ".").replace(/\t/g, ">");
  console.log(i + " [" + indent + "] " + line.trim());
}
