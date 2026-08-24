const fs = require("fs");
const lines = fs.readFileSync("app/components/ImmediateApplyConfirmationModal.tsx", "utf8").split("\n");
for (let i = 80; i <= 170; i++) {
  const line = lines[i - 1];
  const indent = line.match(/^\s*/)[0].replace(/ /g, ".").replace(/\t/g, ">");
  console.log(i + " [" + indent + "] " + line.trim());
}
