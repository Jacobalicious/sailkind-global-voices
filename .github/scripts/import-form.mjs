// Rebuilds the "form-" stories in stories.json from the Google Form sheet.
// Un-approving or editing a row in the sheet is reflected on the next run.
// Usage: node .github/scripts/import-form.mjs [csv-url-or-file]
import fs from "node:fs";
import { FORM_CSV, formStories } from "../../form.js";

const source = process.argv[2] || FORM_CSV;
if (!source) {
  console.log("No form sheet link set in form.js yet. Nothing to do.");
} else {
  const csv = /^https?:/.test(source) ? await (await fetch(source)).text() : fs.readFileSync(source, "utf8");
  const stories = JSON.parse(fs.readFileSync("stories.json", "utf8"));
  const known = Object.fromEntries(stories.filter(s => s.id.startsWith("form-")).map(s => [s.id, s]));
  const { stories: fromForm, problems } = await formStories(csv, { known });

  const before = JSON.stringify(stories, null, 2) + "\n";
  const after = JSON.stringify([...fromForm, ...stories.filter(s => !s.id.startsWith("form-"))], null, 2) + "\n";
  const changed = before !== after;
  if (changed) fs.writeFileSync("stories.json", after);

  const summary = [
    `Approved form stories on the map: ${fromForm.length}`,
    changed ? "stories.json updated." : "No changes.",
    ...problems.map(p => "⚠️ " + p),
  ];
  console.log(summary.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n\n") + "\n");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}
