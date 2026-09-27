// Built from admin/Code.gs and admin/Admin.html by admin/build.mjs. Don't edit by hand.

// SailKind review page — runs inside the form's Google Sheet (Extensions → Apps Script).
// Shows each form response, lets you edit / approve / deny it, and writes approved,
// edited stories to the "Public" tab, which the website reads.
// The original responses are never changed except for the "Review status" column.

const RESPONSES_SHEET = "Form Responses 1";
const PUBLIC_SHEET = "Public";
const SITE = "https://jacobalicious.github.io/sailkind-global-voices/";

// The website finds these columns by name (see form.js), so keep the wording.
const PUBLIC_HEADERS = [
  "Timestamp", "Name you prefer to be called", "Title", "Map location", "Latitude", "Longitude", "Topic",
  "Tell me about yourself", "Relationship with the ocean", "One ocean issue",
  "What is your community doing", "Wish people understood", "Top 3 issues",
  "Media consent (by checking the box)", "File to attach", "Approved",
];

// Response columns, found by words in the question.
const RESPONSE_FIELDS = {
  timestamp:    h => h.startsWith("timestamp"),
  first:        h => h.startsWith("first name"),
  last:         h => h.startsWith("last name"),
  name:         h => h.includes("prefer to be called"),
  pronouns:     h => h.includes("pronoun"),
  about:        h => h.includes("about yourself"),
  relationship: h => h.includes("relationship with the ocean"),
  issue:        h => h.includes("one ocean issue"),
  doing:        h => h.includes("what is your community doing"),
  wish:         h => h.includes("wish people"),
  issues:       h => h.includes("top 3"),
  consent:      h => h.includes("by checking the box"),
  file:         h => h.includes("file to attach"),
  under18:      h => h.includes("under 18"),
  place:        h => h.startsWith("map location"),
  status:       h => h.startsWith("review status"),
};

function doGet() {
  return HtmlService.createHtmlOutput(ADMIN_HTML)
    .setTitle("SailKind · Review stories")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function responsesSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(RESPONSES_SHEET);
  if (!sh) throw new Error(`Couldn't find a tab called "${RESPONSES_SHEET}".`);
  return sh;
}

// Maps field -> column index (0-based). Adds a "Review status" column if missing.
function responseColumns_(sh) {
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const col = { emails: [] };
  header.forEach((raw, i) => {
    const h = raw.trim().toLowerCase();
    if (h.startsWith("email")) { col.emails.push(i); return; }
    const key = Object.keys(RESPONSE_FIELDS).find(k => RESPONSE_FIELDS[k](h));
    if (key && !(key in col)) col[key] = i;
  });
  if (!("status" in col)) {
    const c = header.length + 1;
    sh.getRange(1, c).setValue("Review status");
    col.status = c - 1;
  }
  return col;
}

// The Public tab: headers in place, everything stored as plain text.
function publicSheet_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(PUBLIC_SHEET) || ss.insertSheet(PUBLIC_SHEET);
  const header = sh.getRange(1, 1, 1, PUBLIC_HEADERS.length).getDisplayValues()[0];
  if (header.join("|") !== PUBLIC_HEADERS.join("|") || sh.getRange("A1").getFormula()) {
    sh.clear();
    sh.getRange(1, 1, 1, PUBLIC_HEADERS.length).setValues([PUBLIC_HEADERS]).setFontWeight("bold");
    sh.getRange("A:Z").setNumberFormat("@");
    sh.setFrozenRows(1);
  }
  return sh;
}

function publicRows_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return {};
  const out = {};
  sh.getRange(2, 1, n, PUBLIC_HEADERS.length).getDisplayValues().forEach((r, i) => {
    const o = { row: i + 2 };
    PUBLIC_HEADERS.forEach((h, j) => { o[h] = r[j]; });
    out[r[0]] = o;
  });
  return out;
}

function driveId_(text) {
  const m = /[?&]id=([\w-]+)|\/d\/([\w-]+)/.exec(text || "");
  return m ? (m[1] || m[2]) : "";
}

// ---- Called from the page ---------------------------------------------------

function listResponses() {
  const sh = responsesSheet_();
  const col = responseColumns_(sh);
  const last = sh.getLastRow();
  if (last < 2) return { items: [], site: SITE };
  const rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getDisplayValues();
  const pub = publicRows_(publicSheet_());
  const g = (r, k) => (col[k] === undefined ? "" : (r[col[k]] || "").trim());

  const items = rows.filter(r => g(r, "timestamp")).map(r => {
    const key = g(r, "timestamp");
    const p = pub[key];
    const original = {
      name: g(r, "name") || g(r, "first"),
      place: g(r, "place"),
      about: g(r, "about"), relationship: g(r, "relationship"), issue: g(r, "issue"),
      doing: g(r, "doing"), wish: g(r, "wish"), issues: g(r, "issues"),
    };
    // What's on the map now (if approved), otherwise the original answers.
    const current = p ? {
      name: p["Name you prefer to be called"], title: p["Title"], place: p["Map location"],
      lat: p["Latitude"], lng: p["Longitude"], topic: p["Topic"],
      about: p["Tell me about yourself"], relationship: p["Relationship with the ocean"],
      issue: p["One ocean issue"], doing: p["What is your community doing"],
      wish: p["Wish people understood"], issues: p["Top 3 issues"], showPhoto: !!p["File to attach"],
    } : Object.assign({ title: "", lat: "", lng: "", topic: "", showPhoto: false }, original);

    return {
      key,
      status: (g(r, "status") || "pending").toLowerCase(),
      private: {
        fullName: [g(r, "first"), g(r, "last")].filter(Boolean).join(" "),
        emails: [...new Set(col.emails.map(i => (r[i] || "").trim()).filter(Boolean))],
        pronouns: g(r, "pronouns"),
        under18: g(r, "under18"),
      },
      consent: !!g(r, "consent"),
      fileIds: (g(r, "file").match(/[?&]id=[\w-]+|\/d\/[\w-]+/g) || []).map(driveId_),
      current,
      original,
    };
  });
  return { items: items.reverse(), site: SITE };  // newest first
}

// action: "approve" | "save" | "deny" | "pending"
function saveResponse(key, action, story) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const sh = responsesSheet_();
    const col = responseColumns_(sh);
    const keys = sh.getRange(2, col.timestamp + 1, Math.max(sh.getLastRow() - 1, 1), 1).getDisplayValues().map(r => r[0]);
    const i = keys.indexOf(key);
    if (i < 0) throw new Error("Couldn't find that response any more.");
    const rowNum = i + 2;
    const row = sh.getRange(rowNum, 1, 1, sh.getLastColumn()).getDisplayValues()[0];

    const status = action === "save" ? (row[col.status] || "pending").toLowerCase() : (action === "approve" ? "approved" : action);
    sh.getRange(rowNum, col.status + 1).setValue(status);

    const ps = publicSheet_();
    const existing = publicRows_(ps)[key];

    if (status !== "approved") {
      if (existing) ps.deleteRow(existing.row);
      return { status };
    }
    if (!story.place || story.lat === "" || story.lng === "") throw new Error("Pick a map location first.");

    const consent = col.consent !== undefined ? row[col.consent] : "";
    const fileId = driveId_(col.file !== undefined ? row[col.file] : "");
    const showPhoto = !!(story.showPhoto && consent && fileId);
    if (showPhoto) {
      try {
        DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (e) {
        throw new Error("Couldn't share the photo: " + e.message);
      }
    }

    const values = [
      key, story.name, story.title, story.place, String(story.lat), String(story.lng), story.topic,
      story.about, story.relationship, story.issue, story.doing, story.wish, story.issues,
      consent, showPhoto ? "https://drive.google.com/open?id=" + fileId : "", "yes",
    ].map(v => String(v == null ? "" : v));

    const target = existing ? existing.row : ps.getLastRow() + 1;
    ps.getRange(target, 1, 1, values.length).setNumberFormat("@").setValues([values]);
    return { status };
  } finally {
    lock.releaseLock();
  }
}

// Place name -> coordinates, using Google's geocoder.
function locate(place) {
  const res = Maps.newGeocoder().geocode(place);
  const hit = res.results && res.results[0];
  if (!hit) return null;
  return { lat: +hit.geometry.location.lat.toFixed(4), lng: +hit.geometry.location.lng.toFixed(4), label: hit.formatted_address };
}

// A small preview of an uploaded file (the Drive link opens the full thing).
function filePreview(fileId) {
  const f = DriveApp.getFileById(fileId);
  const thumb = f.getThumbnail();
  return {
    name: f.getName(),
    type: f.getMimeType(),
    url: f.getUrl(),
    image: thumb ? "data:image/png;base64," + Utilities.base64Encode(thumb.getBytes()) : "",
  };
}

const ADMIN_HTML = "<!DOCTYPE html>\r\n<html lang=\"en\">\r\n<head>\r\n<meta charset=\"utf-8\">\r\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\r\n<title>SailKind · Review stories</title>\r\n<link rel=\"stylesheet\" href=\"https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css\">\r\n<link href=\"https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600&display=swap\" rel=\"stylesheet\">\r\n<style>\r\n  :root {\r\n    --ink: #0b2233; --ink-soft: #4a6477; --paper: #f3f7f9; --card: #fff; --line: #dbe7ec;\r\n    --sea: #0e7c86; --sea-deep: #0a4f63; --coral: #ff7a59; --ok: #2a9d8f; --no: #c0392b; --warn: #b7791f;\r\n  }\r\n  * { box-sizing: border-box; }\r\n  html, body { margin: 0; height: 100%; }\r\n  body { font-family: Inter, system-ui, sans-serif; color: var(--ink); background: var(--paper); display: flex; flex-direction: column; }\r\n  header {\r\n    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;\r\n    padding: 12px 20px; background: linear-gradient(90deg, var(--sea-deep), var(--sea)); color: #fff;\r\n  }\r\n  header h1 { font: 600 20px Fraunces, Georgia, serif; margin: 0; }\r\n  header .spacer { flex: 1; }\r\n  header a { color: #fff; font-size: 13px; font-weight: 600; }\r\n  .tabs { display: flex; gap: 6px; }\r\n  .tab {\r\n    border: 1px solid rgba(255,255,255,.4); background: transparent; color: #fff; cursor: pointer;\r\n    border-radius: 999px; padding: 6px 13px; font: 600 13px Inter, sans-serif;\r\n  }\r\n  .tab.on { background: #fff; color: var(--sea-deep); }\r\n  .tab .n { opacity: .7; margin-left: 4px; }\r\n\r\n  main { flex: 1; display: flex; min-height: 0; }\r\n  #list { width: 320px; overflow-y: auto; border-right: 1px solid var(--line); background: var(--card); }\r\n  .item { padding: 14px 16px; border-bottom: 1px solid var(--line); cursor: pointer; }\r\n  .item:hover { background: #f5fafb; }\r\n  .item.on { background: #e6f3f5; box-shadow: inset 3px 0 0 var(--sea); }\r\n  .item b { display: block; font-size: 15px; }\r\n  .item .meta { font-size: 12px; color: var(--ink-soft); margin-top: 3px; }\r\n  .item .preview { font-size: 13px; color: var(--ink-soft); margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }\r\n  .empty { padding: 30px 20px; color: var(--ink-soft); text-align: center; }\r\n\r\n  #editor { flex: 1; overflow-y: auto; }\r\n  .wrap { max-width: 760px; margin: 0 auto; padding: 22px 24px 120px; }\r\n  .badge { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; padding: 3px 8px; border-radius: 6px; }\r\n  .b-pending { background: #fff4d6; color: var(--warn); }\r\n  .b-approved { background: #d9f2ee; color: var(--ok); }\r\n  .b-denied { background: #fbe1de; color: var(--no); }\r\n  .b-minor { background: var(--no); color: #fff; }\r\n\r\n  .private { background: #eef2f4; border: 1px dashed #b9c9d2; border-radius: 12px; padding: 12px 14px; margin: 14px 0 20px; font-size: 13px; }\r\n  .private h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--ink-soft); }\r\n  .private div { margin: 2px 0; }\r\n\r\n  h2 { font: 600 24px Fraunces, Georgia, serif; margin: 6px 0 0; }\r\n  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--sea); margin: 26px 0 4px; }\r\n  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 5px; }\r\n  label small { font-weight: 400; color: var(--ink-soft); }\r\n  input, textarea, select {\r\n    width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px;\r\n    font: 14px Inter, sans-serif; color: var(--ink); background: #fff;\r\n  }\r\n  textarea { min-height: 84px; resize: vertical; line-height: 1.5; }\r\n  input:focus, textarea:focus, select:focus { outline: 2px solid #9fd3d8; border-color: var(--sea); }\r\n  .row { display: flex; gap: 12px; }\r\n  .row > * { flex: 1; }\r\n  .placeRow { display: flex; gap: 8px; }\r\n  .placeRow input { flex: 1; }\r\n  #pickMap { height: 240px; border-radius: 10px; border: 1px solid var(--line); margin-top: 8px; background: #7fa5d2; }\r\n  .hint { font-size: 12px; color: var(--ink-soft); margin-top: 5px; }\r\n  .changed { font-size: 11px; color: var(--warn); font-weight: 600; margin-left: 6px; }\r\n  .reset { font-size: 11px; color: var(--sea); cursor: pointer; margin-left: 6px; text-decoration: underline; }\r\n\r\n  .photo { display: flex; gap: 14px; align-items: flex-start; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 12px; margin-top: 8px; }\r\n  .photo img { width: 140px; height: 105px; object-fit: cover; border-radius: 8px; background: #eee; }\r\n  .photo .info { flex: 1; font-size: 13px; }\r\n  .check { display: flex; gap: 8px; align-items: flex-start; font-weight: 500; font-size: 13px; margin-top: 10px; }\r\n  .check input { width: auto; margin-top: 2px; }\r\n\r\n  .bar {\r\n    position: sticky; bottom: 0; background: rgba(255,255,255,.96); backdrop-filter: blur(6px);\r\n    border-top: 1px solid var(--line); padding: 12px 24px; display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;\r\n  }\r\n  .btn { border: 0; border-radius: 999px; cursor: pointer; font: 600 14px Inter, sans-serif; padding: 10px 18px; }\r\n  .btn:disabled { opacity: .5; cursor: wait; }\r\n  .approve { background: var(--ok); color: #fff; }\r\n  .save { background: var(--sea-deep); color: #fff; }\r\n  .deny { background: #fff; color: var(--no); border: 1px solid #f0c4be; }\r\n  .ghost { background: #fff; color: var(--ink-soft); border: 1px solid var(--line); }\r\n  .bar .spacer { flex: 1; }\r\n\r\n  #toast {\r\n    position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%) translateY(20px); opacity: 0;\r\n    background: var(--ink); color: #fff; padding: 12px 18px; border-radius: 12px; font-size: 14px;\r\n    transition: .25s; pointer-events: none; z-index: 5000; max-width: 90vw;\r\n  }\r\n  #toast.on { opacity: 1; transform: translateX(-50%); pointer-events: auto; }\r\n  #toast a { color: #ffd166; }\r\n  #toast.err { background: var(--no); }\r\n\r\n  @media (max-width: 760px) {\r\n    main { flex-direction: column; }\r\n    #list { width: 100%; max-height: 35vh; border-right: 0; border-bottom: 1px solid var(--line); }\r\n    .row { flex-direction: column; gap: 0; }\r\n    .wrap { padding: 16px 16px 120px; }\r\n  }\r\n</style>\r\n</head>\r\n<body>\r\n<header>\r\n  <h1>🌊 Review stories</h1>\r\n  <div class=\"tabs\" id=\"tabs\"></div>\r\n  <div class=\"spacer\"></div>\r\n  <a id=\"siteLink\" target=\"_blank\" rel=\"noopener\">Open map preview ↗</a>\r\n</header>\r\n<main>\r\n  <div id=\"list\"></div>\r\n  <div id=\"editor\"><div class=\"empty\">Loading responses…</div></div>\r\n</main>\r\n<div id=\"toast\"></div>\r\n\r\n<script>\r\n// Show any script error on the page instead of hanging on \"Loading…\".\r\nwindow.onerror = (msg, src, line) => {\r\n  document.getElementById(\"editor\").innerHTML =\r\n    '<div class=\"empty\">Something broke: ' + String(msg).replace(/[<>&]/g, \"\") + \" (line \" + line + \")</div>\";\r\n};\r\n</script>\r\n<script src=\"https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js\"></script>\r\n<script>\r\n// Note: avoid a regex ending in a slash — Google's page processing treats the double slash as a comment.\r\nconst TOPICS = [\"Coral & reefs\", \"Plastic & cleanups\", \"Fisheries\", \"Mangroves & coasts\",\r\n  \"Marine wildlife\", \"Climate & ocean\", \"Education & culture\", \"Other\"];\r\nconst TOPIC_WORDS = [\r\n  [\"Coral & reefs\", /coral|reef|bleach/], [\"Plastic & cleanups\", /plastic|trash|litter|waste|pollut|debris|sewage|runoff/],\r\n  [\"Fisheries\", /fish|bycatch|trawl/], [\"Mangroves & coasts\", /mangrove|coast|erosion|sea.?level|wetland|seagrass|develop/],\r\n  [\"Marine wildlife\", /wildlife|species|turtle|whale|shark|dolphin|bird|habitat/], [\"Climate & ocean\", /climate|warming|acidif|temperature|storm|heat/],\r\n];\r\nconst STORY_FIELDS = [\r\n  [\"about\", \"About me\", \"Tell me about yourself\"],\r\n  [\"relationship\", \"Our community and the ocean\", \"Their community's relationship with the ocean\"],\r\n  [\"issue\", \"An issue we see\", \"One ocean issue they see\"],\r\n  [\"doing\", \"What we're doing\", \"What their community is doing\"],\r\n  [\"wish\", \"What I wish the world understood\", \"What they wish people understood\"],\r\n];\r\n\r\n// ---- Server calls (with a demo mode when opened outside Google) ------------\r\nconst server = (fn, ...args) => new Promise((resolve, reject) => {\r\n  if (window.google && google.script) {\r\n    google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args);\r\n  } else {\r\n    setTimeout(() => { try { resolve(DEMO[fn](...args)); } catch (e) { reject(e); } }, 300);\r\n  }\r\n});\r\n\r\nconst $ = s => document.querySelector(s);\r\nconst esc = s => String(s == null ? \"\" : s).replace(/[&<>\"']/g, c => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[c]));\r\nconst guessTopic = t => { for (const c of (t || \"\").split(\",\")) { const h = TOPIC_WORDS.find(([, re]) => re.test(c.toLowerCase())); if (h) return h[0]; } return \"Other\"; };\r\n\r\nlet items = [], view = \"pending\", selected = null, site = \"\", pickMap, pickMarker;\r\n\r\nfunction toast(html, isErr) {\r\n  const t = $(\"#toast\");\r\n  t.innerHTML = html; t.className = \"on\" + (isErr ? \" err\" : \"\");\r\n  clearTimeout(t.timer); t.timer = setTimeout(() => t.className = \"\", isErr ? 7000 : 6000);\r\n}\r\n\r\nasync function load(keepKey) {\r\n  const slow = setTimeout(() => {\r\n    if (!items.length) $(\"#editor\").innerHTML = '<div class=\"empty\">Still loading… If this stays stuck, reload the page.</div>';\r\n  }, 20000);\r\n  try {\r\n    const res = await server(\"listResponses\");\r\n    clearTimeout(slow);\r\n    items = res.items; site = res.site;\r\n    $(\"#siteLink\").href = site + \"?dev\";\r\n    renderTabs();\r\n    const still = items.find(i => i.key === keepKey && i.status === view);\r\n    select(still ? still.key : (items.find(i => i.status === view) || {}).key);\r\n  } catch (e) {\r\n    clearTimeout(slow);\r\n    $(\"#editor\").innerHTML = `<div class=\"empty\">Couldn't load responses: ${esc(e.message)}</div>`;\r\n  }\r\n}\r\n\r\nfunction renderTabs() {\r\n  const n = s => items.filter(i => i.status === s).length;\r\n  $(\"#tabs\").innerHTML = [[\"pending\", \"To review\"], [\"approved\", \"On the map\"], [\"denied\", \"Denied\"]]\r\n    .map(([s, l]) => `<button class=\"tab${view === s ? \" on\" : \"\"}\" data-s=\"${s}\">${l}<span class=\"n\">${n(s)}</span></button>`).join(\"\");\r\n  const list = items.filter(i => i.status === view);\r\n  $(\"#list\").innerHTML = list.map(i => `\r\n    <div class=\"item${i.key === selected ? \" on\" : \"\"}\" data-k=\"${esc(i.key)}\">\r\n      <b>${esc(i.current.name || \"(no name)\")} ${i.private.under18.toLowerCase().startsWith(\"y\") ? '<span class=\"badge b-minor\">Under 18</span>' : \"\"}</b>\r\n      <div class=\"meta\">${esc(i.current.place || \"No location yet\")} · ${esc(i.key.split(\" \")[0])}</div>\r\n      <div class=\"preview\">${esc(i.current.about || i.current.relationship)}</div>\r\n    </div>`).join(\"\") || `<div class=\"empty\">Nothing here.</div>`;\r\n}\r\n\r\n$(\"#tabs\").onclick = e => {\r\n  const b = e.target.closest(\".tab\"); if (!b) return;\r\n  view = b.dataset.s; renderTabs();\r\n  select((items.find(i => i.status === view) || {}).key);\r\n};\r\n$(\"#list\").onclick = e => { const it = e.target.closest(\".item\"); if (it) select(it.dataset.k); };\r\n\r\nfunction select(key) {\r\n  selected = key;\r\n  pickMarker = null;\r\n  renderTabs();\r\n  const it = items.find(i => i.key === key);\r\n  if (!it) { $(\"#editor\").innerHTML = `<div class=\"empty\">${view === \"pending\" ? \"All caught up — no stories waiting. 🎉\" : \"Nothing here.\"}</div>`; pickMap = null; return; }\r\n  const c = it.current, p = it.private;\r\n  const minor = p.under18.toLowerCase().startsWith(\"y\");\r\n\r\n  $(\"#editor\").innerHTML = `\r\n  <div class=\"wrap\">\r\n    <span class=\"badge b-${it.status}\">${it.status === \"pending\" ? \"To review\" : it.status === \"approved\" ? \"On the map\" : \"Denied\"}</span>\r\n    ${minor ? '<span class=\"badge b-minor\">Under 18</span>' : \"\"}\r\n    <h2>${esc(c.name || \"(no name)\")}</h2>\r\n\r\n    <div class=\"private\">\r\n      <h4>🔒 Private — never shown on the site</h4>\r\n      <div><b>Full name:</b> ${esc(p.fullName || \"—\")}</div>\r\n      <div><b>Email:</b> ${p.emails.map(esc).join(\", \") || \"—\"}</div>\r\n      <div><b>Pronouns:</b> ${esc(p.pronouns || \"—\")}</div>\r\n      <div><b>Under 18:</b> ${esc(p.under18 || \"—\")}${minor ? \" — check any photo shows no one identifiable without guardian permission.\" : \"\"}</div>\r\n      <div><b>Submitted:</b> ${esc(it.key)}</div>\r\n    </div>\r\n\r\n    <h3>On the map</h3>\r\n    <div class=\"row\">\r\n      <div><label>Display name</label><input id=\"f-name\" value=\"${esc(c.name)}\"></div>\r\n      <div><label>Title <small>(optional)</small></label><input id=\"f-title\" value=\"${esc(c.title)}\" placeholder=\"\"></div>\r\n    </div>\r\n\r\n    <label>Map location <small>— type a place and press Find, then click the map to fine-tune</small></label>\r\n    <div class=\"placeRow\">\r\n      <input id=\"f-place\" value=\"${esc(c.place)}\" placeholder=\"City, Country\">\r\n      <button class=\"btn ghost\" id=\"findBtn\" type=\"button\">Find</button>\r\n    </div>\r\n    <div id=\"pickMap\"></div>\r\n    <div class=\"hint\" id=\"pinHint\">${c.lat !== \"\" && c.lat != null ? \"Pin set.\" : \"No pin yet.\"}</div>\r\n\r\n    <label>Topic <small>(colour of the pin)</small></label>\r\n    <select id=\"f-topic\">${TOPICS.map(t => `<option${t === (c.topic || guessTopic(c.issues)) ? \" selected\" : \"\"}>${esc(t)}</option>`).join(\"\")}</select>\r\n\r\n    <h3>Their story</h3>\r\n    ${STORY_FIELDS.map(([k, label, q]) => `\r\n      <label>${label} <small>— ${q}</small>\r\n        ${c[k] !== it.original[k] ? `<span class=\"changed\">edited</span><span class=\"reset\" data-reset=\"${k}\">undo</span>` : \"\"}\r\n      </label>\r\n      <textarea id=\"f-${k}\">${esc(c[k])}</textarea>`).join(\"\")}\r\n    <label>Biggest issues here</label>\r\n    <input id=\"f-issues\" value=\"${esc(c.issues)}\">\r\n\r\n    <h3>Photo</h3>\r\n    <div id=\"photos\">${it.fileIds.length ? \"\" : '<div class=\"hint\">No file attached.</div>'}</div>\r\n  </div>\r\n  <div class=\"bar\">\r\n    ${it.status !== \"denied\" ? '<button class=\"btn deny\" data-act=\"deny\">Deny</button>' : '<button class=\"btn ghost\" data-act=\"pending\">Move back to review</button>'}\r\n    ${it.status === \"approved\" ? '<button class=\"btn ghost\" data-act=\"pending\">Take off map</button>' : \"\"}\r\n    <span class=\"spacer\"></span>\r\n    ${it.status === \"approved\"\r\n      ? '<button class=\"btn save\" data-act=\"save\">Save changes</button>'\r\n      : '<button class=\"btn approve\" data-act=\"approve\">✓ Approve &amp; put on map</button>'}\r\n  </div>`;\r\n\r\n  // Title placeholder follows name + place.\r\n  const updateTitle = () => { $(\"#f-title\").placeholder = `${$(\"#f-name\").value || \"Name\"} · ${($(\"#f-place\").value.split(\",\")[0] || \"Place\").trim()}`; };\r\n  $(\"#f-name\").oninput = updateTitle; $(\"#f-place\").addEventListener(\"input\", updateTitle); updateTitle();\r\n\r\n  // Map picker\r\n  let pos = c.lat !== \"\" && c.lat != null ? { lat: +c.lat, lng: +c.lng } : null;\r\n  pickMap = L.map(\"pickMap\", { worldCopyJump: true }).setView(pos ? [pos.lat, pos.lng] : [15, 10], pos ? 6 : 1);\r\n  L.tileLayer(\"https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}\", { maxNativeZoom: 13, maxZoom: 16, attribution: \"Esri\" }).addTo(pickMap);\r\n  L.tileLayer(\"https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}\", { maxNativeZoom: 13, maxZoom: 16 }).addTo(pickMap);\r\n  const setPin = (ll, zoom) => {\r\n    pos = { lat: +(+ll.lat).toFixed(4), lng: +(+ll.lng).toFixed(4) };\r\n    if (pickMarker && pickMap.hasLayer(pickMarker)) pickMarker.setLatLng(ll); else pickMarker = L.marker(ll).addTo(pickMap);\r\n    if (zoom) pickMap.setView(ll, zoom);\r\n  };\r\n  if (pos) setPin(pos);\r\n  pickMap.on(\"click\", e => { const w = e.latlng.wrap(); setPin(w); $(\"#pinHint\").textContent = \"Pin moved by hand.\"; });\r\n  $(\"#pickMap\").getPos = () => pos;\r\n\r\n  const find = async () => {\r\n    const place = $(\"#f-place\").value.trim(); if (!place) return;\r\n    $(\"#pinHint\").textContent = \"Looking it up…\";\r\n    try {\r\n      const hit = await server(\"locate\", place);\r\n      if (!hit) { $(\"#pinHint\").textContent = `Couldn't find \"${place}\". Try \"City, Country\", or click the map.`; return; }\r\n      setPin(hit, 7);\r\n      $(\"#pinHint\").textContent = `Found: ${hit.label}. Click the map to move the pin if it's not quite right.`;\r\n    } catch (e) { $(\"#pinHint\").textContent = \"Lookup failed: \" + e.message; }\r\n  };\r\n  $(\"#findBtn\").onclick = find;\r\n  $(\"#f-place\").onkeydown = e => { if (e.key === \"Enter\") { e.preventDefault(); find(); } };\r\n  if (!pos && c.place) find();\r\n\r\n  // Undo edits\r\n  $(\"#editor\").querySelectorAll(\"[data-reset]\").forEach(el => el.onclick = () => {\r\n    const k = el.dataset.reset; $(\"#f-\" + k).value = it.original[k]; el.previousElementSibling.remove(); el.remove();\r\n  });\r\n\r\n  // Photos\r\n  it.fileIds.forEach(async (id, n) => {\r\n    const box = document.createElement(\"div\"); box.className = \"photo\";\r\n    box.innerHTML = `<img alt=\"\"><div class=\"info\">Loading file…</div>`;\r\n    $(\"#photos\").appendChild(box);\r\n    try {\r\n      const f = await server(\"filePreview\", id);\r\n      if (f.image) box.querySelector(\"img\").src = f.image; else box.querySelector(\"img\").remove();\r\n      const isImg = f.type.startsWith(\"image\" + \"/\");\r\n      box.querySelector(\".info\").innerHTML = `\r\n        <b>${esc(f.name)}</b> <a href=\"${esc(f.url)}\" target=\"_blank\" rel=\"noopener\">open ↗</a>\r\n        ${n === 0 && isImg ? `\r\n          <label class=\"check\"><input type=\"checkbox\" id=\"f-photo\" ${c.showPhoto ? \"checked\" : \"\"} ${it.consent ? \"\" : \"disabled\"}>\r\n          <span>Show this photo with the story${it.consent ? \" <small>(makes the file viewable by anyone with the link)</small>\" : \" — <b>they didn't tick the media permission box</b>\"}</span></label>`\r\n        : `<div class=\"hint\">${isImg ? \"Only the first photo is shown on the map.\" : \"Not an image, so it won't show on the map.\"}</div>`}`;\r\n    } catch (e) {\r\n      box.querySelector(\".info\").textContent = \"Couldn't load this file: \" + e.message;\r\n    }\r\n  });\r\n\r\n  $(\"#editor\").querySelector(\".bar\").onclick = e => { const b = e.target.closest(\"[data-act]\"); if (b) act(it, b.dataset.act); };\r\n}\r\n\r\nasync function act(it, action) {\r\n  const story = {\r\n    name: $(\"#f-name\").value.trim(),\r\n    title: $(\"#f-title\").value.trim(),\r\n    place: $(\"#f-place\").value.trim(),\r\n    topic: $(\"#f-topic\").value,\r\n    issues: $(\"#f-issues\").value.trim(),\r\n    showPhoto: !!($(\"#f-photo\") && $(\"#f-photo\").checked),\r\n  };\r\n  STORY_FIELDS.forEach(([k]) => story[k] = $(\"#f-\" + k).value.trim());\r\n  const pos = $(\"#pickMap\").getPos();\r\n  story.lat = pos ? pos.lat : \"\"; story.lng = pos ? pos.lng : \"\";\r\n\r\n  if ((action === \"approve\" || action === \"save\") && (!story.place || !pos)) { toast(\"Set a map location and pin first.\", true); return; }\r\n  if (action === \"deny\" && !confirm(`Deny ${story.name || \"this story\"}? You can move it back later.`)) return;\r\n\r\n  document.querySelectorAll(\".bar .btn\").forEach(b => b.disabled = true);\r\n  try {\r\n    await server(\"saveResponse\", it.key, action, story);\r\n    const msg = {\r\n      approve: `✓ On the map! <a href=\"${site}?dev\" target=\"_blank\">See it in the preview</a> (give Google a minute or two). The public site updates within the hour.`,\r\n      save: `Saved. <a href=\"${site}?dev\" target=\"_blank\">Check the preview</a> in a minute or two.`,\r\n      deny: \"Denied. It's in the Denied tab if you change your mind.\",\r\n      pending: \"Moved back to review and taken off the map.\",\r\n    }[action];\r\n    toast(msg);\r\n    await load(action === \"save\" ? it.key : null);\r\n  } catch (e) {\r\n    toast(\"Didn't save: \" + esc(e.message), true);\r\n    document.querySelectorAll(\".bar .btn\").forEach(b => b.disabled = false);\r\n  }\r\n}\r\n\r\n// ---- Demo data, used only when this page is opened outside Google ---------\r\nconst DEMO = (() => {\r\n  const items = [\r\n    { key: \"9/27/2026 9:21:32\", status: \"pending\", consent: true, fileIds: [\"demo1\"],\r\n      private: { fullName: \"Alex Example\", emails: [\"alex@example.com\"], pronouns: \"they/them\", under18: \"No\" },\r\n      original: { name: \"Alex\", place: \"Valparaiso, Chile\", about: \"I grew up on the coast and learned to swim before I could ride a bike.\", relationship: \"Most families here fish or work at the port.\", issue: \"Plastic washes up after every storm.\", doing: \"A weekly beach cleanup run by the school.\", wish: \"We are small but we care a lot.\", issues: \"Plastic pollution, Overfishing\" } },\r\n    { key: \"9/26/2026 14:02:10\", status: \"pending\", consent: false, fileIds: [],\r\n      private: { fullName: \"Sam Sample\", emails: [\"sam@example.com\"], pronouns: \"\", under18: \"Yes\" },\r\n      original: { name: \"Sam\", place: \"\", about: \"Student who loves reefs.\", relationship: \"Tourism and fishing.\", issue: \"Coral bleaching.\", doing: \"Reef monitoring club.\", wish: \"Reefs are our livelihood.\", issues: \"Coral reef damage\" } },\r\n  ];\r\n  items.forEach(i => i.current = Object.assign({ title: \"\", lat: \"\", lng: \"\", topic: \"\", showPhoto: false }, i.original));\r\n  return {\r\n    listResponses: () => ({ items: JSON.parse(JSON.stringify(items)), site: \"https://jacobalicious.github.io/sailkind-global-voices/\" }),\r\n    locate: p => /chile/i.test(p) ? { lat: -33.0472, lng: -71.6127, label: \"Valparaíso, Chile\" } : null,\r\n    filePreview: () => ({ name: \"beach.jpg\", type: \"image/jpeg\", url: \"#\", image: \"\" }),\r\n    saveResponse: (key, action, story) => {\r\n      const it = items.find(i => i.key === key);\r\n      it.status = action === \"save\" ? it.status : action === \"approve\" ? \"approved\" : action;\r\n      if (it.status === \"approved\") it.current = story;\r\n      return { status: it.status };\r\n    },\r\n  };\r\n})();\r\n\r\nload();\r\n</script>\r\n</body>\r\n</html>\r\n";
