// Bundles Code.gs + Admin.html into one Apps Script file (admin/dist/Code.gs).
// Run: node admin/build.mjs   (admin/deploy.ps1 builds and uploads)
//
// Google's HtmlService rewrites inline scripts and mangles some valid JavaScript
// (regexes ending in a slash, HTML tags inside template strings…). So each inline
// script is shipped as base64 text and unpacked in the browser, where Google's
// processing can't touch it.
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const code = fs.readFileSync(new URL("Code.gs", dir), "utf8");
const html = fs.readFileSync(new URL("Admin.html", dir), "utf8");

const packed = html.replace(/<script>([\s\S]*?)<\/script>/g, (_, js) => {
  const b64 = Buffer.from(js, "utf8").toString("base64url");  // only letters, digits, - and _
  return `<script>(function(s){var b=atob(s.replace(/-/g,"+").replace(/_/g,"/"));` +
    `var u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);` +
    `(0,eval)(new TextDecoder().decode(u));})("${b64}");</script>`;
});

const out = "// Built from admin/Code.gs and admin/Admin.html by admin/build.mjs. Don't edit by hand.\n\n" +
  code + "\nconst ADMIN_HTML = " + JSON.stringify(packed) + ";\n";

fs.mkdirSync(new URL("dist/", dir), { recursive: true });
fs.writeFileSync(new URL("dist/Code.gs", dir), out);
fs.copyFileSync(new URL("appsscript.json", dir), new URL("dist/appsscript.json", dir));
fs.writeFileSync(new URL("preview.html", dir), packed);  // for testing the packed page locally (demo data)
console.log("Wrote admin/dist/Code.gs");
