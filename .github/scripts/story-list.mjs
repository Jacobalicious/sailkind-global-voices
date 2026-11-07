// Writes the approved stories into index.html as plain HTML, so search engines and
// visitors without JavaScript can read them. Run after anything that changes stories.json.
import fs from "node:fs";

const START = "<!-- stories:start (written by story-list.mjs, do not edit) -->";
const END = "<!-- stories:end -->";

// Story text comes from a public form, so everything is escaped.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = u => /^https:\/\/[^\s"'<>]+$/i.test(u || "") ? u : "";

// Stories mark their sections with "## Heading" lines.
function storyBody(text) {
  return String(text ?? "").split(/^## (.*)$/m).map((part, i) => {
    if (i % 2) return `<h4>${esc(part.trim())}</h4>`;
    const body = part.trim();
    return body ? `<p>${esc(body)}</p>` : "";
  }).join("");
}

function storyArticle(s) {
  const by = [`Shared by ${s.name}`, s.community, s.date].filter(Boolean).join(" · ");
  const link = safeUrl(s.link);
  return `<article data-id="${esc(s.id)}">
<h3>${esc(s.title)}</h3>
<div class="meta">${esc(s.place)} · ${esc(s.topic)}</div>
<div class="meta">${esc(by)}</div>
${storyBody(s.story)}${link ? `\n<p><a class="link" href="${esc(link)}" target="_blank" rel="ugc nofollow noopener">Learn more →</a></p>` : ""}
</article>`;
}

export function storyListHtml(stories) {
  // Same rule as the map: a story without a pin isn't shown.
  const shown = stories.filter(s => isFinite(s.lat) && isFinite(s.lng));
  const places = new Set(shown.map(s => s.country || s.place)).size;
  const count = `${shown.length} ${shown.length === 1 ? "story" : "stories"} from ${places} ${places === 1 ? "place" : "places"}`;
  return [`<p class="meta">${count}</p>`, ...shown.map(storyArticle)].join("\n");
}

// Returns true if index.html changed.
export function syncStoryList() {
  const page = fs.readFileSync("index.html", "utf8");
  const from = page.indexOf(START);
  const to = page.indexOf(END);
  if (from < 0 || to < from) throw new Error("index.html has lost its stories:start/stories:end markers.");
  const stories = JSON.parse(fs.readFileSync("stories.json", "utf8"));
  const next = page.slice(0, from + START.length) + "\n" + storyListHtml(stories) + "\n" + page.slice(to);
  if (next === page) return false;
  fs.writeFileSync("index.html", next);
  return true;
}
