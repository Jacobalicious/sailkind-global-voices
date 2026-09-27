// Bundles Code.gs + Admin.html into one file to paste into Apps Script.
// Run: node admin/build.mjs
import fs from "node:fs";
const dir = new URL(".", import.meta.url);
const code = fs.readFileSync(new URL("Code.gs", dir), "utf8");
const html = fs.readFileSync(new URL("Admin.html", dir), "utf8");
fs.writeFileSync(new URL("paste-into-apps-script.gs", dir),
  "// Built from admin/Code.gs and admin/Admin.html by admin/build.mjs. Don't edit by hand.\n\n" +
  code + "\nconst ADMIN_HTML = " + JSON.stringify(html) + ";\n");
console.log("Wrote admin/paste-into-apps-script.gs");
