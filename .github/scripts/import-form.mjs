// Rebuilds the "form-" stories in stories.json from the Google Form sheet.
// Un-approving or editing a row in the sheet is reflected on the next run.
// It also rewrites the plain story list in index.html to match.
// Usage: node .github/scripts/import-form.mjs [csv-url-or-file]
import fs from "node:fs";
import { FORM_CSV, fetchFormCsv, formStories } from "../../form.js";
import { syncStoryList } from "./story-list.mjs";

const source = process.argv[2] || FORM_CSV;
if (!source) {
  console.log("No form sheet link set in form.js yet. Nothing to do.");
} else {
  const csv = /^https?:/.test(source) ? await fetchFormCsv(source) : fs.readFileSync(source, "utf8");
  const stories = JSON.parse(fs.readFileSync("stories.json", "utf8"));
  const known = Object.fromEntries(stories.filter(s => s.id.startsWith("form-")).map(s => [s.id, s]));
  const { stories: fromForm, problems } = await formStories(csv, { known });

  const before = JSON.stringify(stories, null, 2) + "\n";
  const after = JSON.stringify([...fromForm, ...stories.filter(s => !s.id.startsWith("form-"))], null, 2) + "\n";
  const storiesChanged = before !== after;
  if (storiesChanged) fs.writeFileSync("stories.json", after);
  // Runs every time, so a story published another way reaches the page on the next run too.
  const listChanged = syncStoryList();
  const changed = storiesChanged || listChanged;

  const summary = [
    `Approved form stories on the map: ${fromForm.length}`,
    storiesChanged ? "stories.json updated." : "stories.json unchanged.",
    listChanged ? "Story list in index.html updated." : "Story list in index.html unchanged.",
    ...problems.map(p => "⚠️ " + p),
  ];
  console.log(summary.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n\n") + "\n");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}
