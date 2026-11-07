// SailKind review API — runs inside the form's Google Sheet (Extensions → Apps Script).
// sailkind.com/admin (admin.html) signs in here, then lists form responses, edits them,
// approves or denies them, and writes approved stories to the "Public" tab, which the
// website reads. The original responses are never changed except for the "Review status" column.
//
// The script runs as whoever deployed it and anyone on the internet can reach it, so
// every request goes through doPost, and only login works without a session. Everything
// else stays private with a trailing underscore, which Google won't let a browser call.

const RESPONSES_SHEET = "Form Responses 1";
const PUBLIC_SHEET = "Public";
const SITE = "https://sailkind.com/";

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
  city:         h => h.startsWith("city") || h.startsWith("town") || h.includes("what city"),
  country:      h => h.startsWith("country") || h.includes("what country"),
  status:       h => h.startsWith("review status"),
};

// ---- Requests from the page ---------------------------------------------------

// Old bookmarks of the Google link land here.
function doGet() {
  return ContentService.createTextOutput("The review page has moved to " + SITE + "admin");
}

// The page's calls that need a session.
const API = {
  listResponses: listResponses_,
  saveResponse: saveResponse_,
  locate: locate_,
  filePreview: filePreview_,
};

// Body: JSON { fn, token, args } or { fn: "login", username, password }. It's sent as
// text/plain so the browser skips the CORS preflight, which Apps Script can't answer.
// Replies: { ok: true, result } or { ok: false, error, signedOut }.
function doPost(e) {
  let reply;
  try {
    const req = JSON.parse(e.postData.contents);
    reply = { ok: true, result: dispatch_(req) };
  } catch (err) {
    reply = { ok: false, error: err.message, signedOut: !!err.signedOut };
  }
  return ContentService.createTextOutput(JSON.stringify(reply)).setMimeType(ContentService.MimeType.JSON);
}

function dispatch_(req) {
  if (req.fn === "login") return login_(req.username, req.password);
  requireSession_(req.token);
  if (req.fn === "logout") return logout_(req.token);
  if (!Object.prototype.hasOwnProperty.call(API, req.fn)) throw new Error("Unknown request.");
  return API[req.fn].apply(null, req.args || []);
}

// ---- Sign-in ------------------------------------------------------------------
// Each reviewer is one Script Property, "login_<username>" = "<salt>:<hash>".
// admin/set-login.mjs makes the value, so the password itself is never stored.

const HASH_ROUNDS = 1000;            // keep in step with admin/set-login.mjs
const SESSION_SECONDS = 6 * 60 * 60; // the longest CacheService keeps anything
const MAX_FAILURES = 10;             // wrong passwords allowed per username…
const LOCKOUT_SECONDS = 15 * 60;     // …within this long

function hashPassword_(password, salt) {
  let h = password;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    const bytes = Utilities.computeHmacSha256Signature(h, salt, Utilities.Charset.UTF_8);
    h = bytes.map(b => (b & 255).toString(16).padStart(2, "0")).join("");
  }
  return h;
}

function login_(username, password) {
  const user = String(username || "").trim().toLowerCase().slice(0, 64);
  const lock = LockService.getScriptLock();  // one attempt at a time, so the count below can't be raced
  lock.waitLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    const failKey = "fails:" + user;
    const fails = Number(cache.get(failKey)) || 0;
    if (fails >= MAX_FAILURES) throw new Error("Too many wrong tries. Wait 15 minutes and try again.");

    // Unknown usernames do the same work, so they take as long as known ones.
    const stored = PropertiesService.getScriptProperties().getProperty("login_" + user) || "none:none";
    const parts = stored.split(":");
    if (hashPassword_(String(password || ""), parts[0]) !== parts[1]) {
      cache.put(failKey, String(fails + 1), LOCKOUT_SECONDS);
      throw new Error("Wrong username or password.");
    }
    cache.remove(failKey);
    const token = Utilities.getUuid() + Utilities.getUuid();
    cache.put("session:" + token, user, SESSION_SECONDS);
    return { token, user };
  } finally {
    lock.releaseLock();
  }
}

// Sessions slide: each call restarts the 6 hours.
function requireSession_(token) {
  const cache = CacheService.getScriptCache();
  const key = "session:" + String(token || "").slice(0, 100);
  const user = cache.get(key);
  if (!user) {
    const err = new Error("Please sign in again.");
    err.signedOut = true;
    throw err;
  }
  cache.put(key, user, SESSION_SECONDS);
}

function logout_(token) {
  CacheService.getScriptCache().remove("session:" + token);
  return {};
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

// Every Drive file id in a cell (the form puts several uploads in one cell, comma-separated).
function driveIds_(text) {
  return (String(text || "").match(/[?&]id=[\w-]+|\/d\/[\w-]+/g) || []).map(driveId_);
}

// The Public tab's "File to attach" holds links to the photos on the map, then
// "hidden: <id> <id>" for any a reviewer unticked. The website only picks up the links.
// Plain "hidden" is how older rows marked every photo unticked.
function hiddenIds_(cell) {
  const v = String(cell || "").trim();
  if (v === "hidden") return null;  // all of them
  const m = /hidden:([\w\s-]*)$/.exec(v);
  return m ? m[1].trim().split(/\s+/).filter(Boolean) : [];
}

// ---- What the page can do once signed in ----------------------------------

function listResponses_() {
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
    const city = g(r, "city"), country = g(r, "country");
    const fileIds = driveIds_(g(r, "file"));
    const original = {
      name: g(r, "name") || g(r, "first"),
      // Whatever they typed as a map location, else the city and country answers.
      place: g(r, "place") || [city, country].filter(Boolean).join(", "),
      about: g(r, "about"), relationship: g(r, "relationship"), issue: g(r, "issue"),
      doing: g(r, "doing"), wish: g(r, "wish"), issues: g(r, "issues"),
    };
    // What's on the map now (if approved), otherwise the original answers.
    const current = p ? {
      name: p["Name you prefer to be called"], title: p["Title"], place: p["Map location"],
      lat: p["Latitude"], lng: p["Longitude"], topic: p["Topic"],
      about: p["Tell me about yourself"], relationship: p["Relationship with the ocean"],
      issue: p["One ocean issue"], doing: p["What is your community doing"],
      wish: p["Wish people understood"], issues: p["Top 3 issues"],
      // Photos start ticked unless a reviewer unticked them, so stories approved
      // before photos worked pick theirs up when re-approved.
      hiddenPhotos: hiddenIds_(p["File to attach"]) || fileIds,
    } : Object.assign({ title: "", lat: "", lng: "", topic: "", hiddenPhotos: [] }, original);

    return {
      key,
      status: readStatus_(g(r, "status")),
      private: {
        fullName: [g(r, "first"), g(r, "last")].filter(Boolean).join(" "),
        emails: [...new Set(col.emails.map(i => (r[i] || "").trim()).filter(Boolean))],
        pronouns: g(r, "pronouns"),
        under18: g(r, "under18"),
      },
      consent: !!g(r, "consent"),
      said: { city: city, country: country },   // what they answered, for checking the pin against
      fileIds,
      current,
      original,
    };
  });
  return { items: items.reverse(), site: SITE };  // newest first
}

// What each button writes into the "Review status" column. The tabs on the page are
// named after these, so the wording has to match on both sides.
const ACTION_STATUS = { approve: "approved", deny: "denied", pending: "pending" };

// Reads the column back, forgiving older rows that were written as "deny"/"approve".
function readStatus_(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return ACTION_STATUS[v] || v || "pending";
}

// action: "approve" | "save" | "deny" | "pending"
function saveResponse_(key, action, story) {
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

    const status = action === "save" ? readStatus_(row[col.status]) : ACTION_STATUS[action];
    if (!status) throw new Error("Don't know what to do with: " + action);
    sh.getRange(rowNum, col.status + 1).setValue(status);

    const ps = publicSheet_();
    const existing = publicRows_(ps)[key];

    if (status !== "approved") {
      if (existing) ps.deleteRow(existing.row);
      return { status };
    }
    if (!story.place || story.lat === "" || story.lng === "") throw new Error("Pick a map location first.");

    const consent = col.consent !== undefined ? row[col.consent] : "";
    // Attaching a photo means they want it shown, so the form's permission box isn't required.
    // The reviewer still sees each one and can untick "Show this photo".
    const fileIds = driveIds_(col.file !== undefined ? row[col.file] : "");
    const wanted = story.photos || [];
    const shown = fileIds.filter(id => wanted.indexOf(id) >= 0);
    const hidden = fileIds.filter(id => wanted.indexOf(id) < 0);
    shown.forEach(id => {
      try {
        driveFile_(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (e) {
        throw new Error("Couldn't share a photo: " + e.message);
      }
    });
    const fileCell = shown.map(id => "https://drive.google.com/open?id=" + id)
      .concat(hidden.length ? ["hidden: " + hidden.join(" ")] : []).join(", ");

    const values = [
      key, story.name, story.title, story.place, String(story.lat), String(story.lng), story.topic,
      story.about, story.relationship, story.issue, story.doing, story.wish, story.issues,
      consent, fileCell, "yes",
    ].map(v => String(v == null ? "" : v));

    const target = existing ? existing.row : ps.getLastRow() + 1;
    ps.getRange(target, 1, 1, values.length).setNumberFormat("@").setValues([values]);
    return { status };
  } finally {
    lock.releaseLock();
  }
}

// Country names people type that don't match what a map service calls the place.
// Keys and values have no spaces or punctuation (see normCountry_).
const COUNTRY_ALIASES = {
  usa: "unitedstates", us: "unitedstates", unitedstatesofamerica: "unitedstates", america: "unitedstates",
  uk: "unitedkingdom", greatbritain: "unitedkingdom", britain: "unitedkingdom", england: "unitedkingdom",
  scotland: "unitedkingdom", wales: "unitedkingdom", northernireland: "unitedkingdom",
  uae: "unitedarabemirates", holland: "netherlands", ivorycoast: "cotedivoire",
  burma: "myanmar", czechia: "czechrepublic", swaziland: "eswatini", russianfederation: "russia",
  republicofkorea: "southkorea", unitedrepublicoftanzania: "tanzania", republicofireland: "ireland",
  peoplesrepublicofchina: "china",
};

function normCountry_(s) {
  const k = String(s || "").toLowerCase()
    .normalize("NFD").replace(/[^a-z ]+/g, " ").replace(/\bthe\b/g, " ").replace(/ +/g, "");
  return COUNTRY_ALIASES[k] || k;
}

// Unknown on either side counts as a match, so a blank answer never raises a warning.
function sameCountry_(a, b) {
  const x = normCountry_(a), y = normCountry_(b);
  return !x || !y || x === y;
}

// Place name -> coordinates, using Google's geocoder. When we know which country they
// said they're in, the answer is checked against it so a same-named town somewhere
// else doesn't quietly become their pin.
function locate_(place, expectCountry) {
  const res = Maps.newGeocoder().geocode(place);
  const hit = res.results && res.results[0];
  if (!hit) return null;
  let country = "";
  (hit.address_components || []).forEach(function (c) {
    if (c.types.indexOf("country") >= 0) country = c.long_name;
  });
  return {
    lat: +hit.geometry.location.lat.toFixed(4),
    lng: +hit.geometry.location.lng.toFixed(4),
    label: hit.formatted_address,
    country: country,
    countryOk: sameCountry_(expectCountry, country),
  };
}

// Form uploads live in the form owner's Drive, in a folder called
// "<form name> (File responses)". The account that deployed this script needs access to
// that folder, because the script runs as it. This turns Google's cryptic error into what to do.
function driveFile_(fileId) {
  try {
    return DriveApp.getFileById(fileId);
  } catch (e) {
    const who = Session.getEffectiveUser().getEmail() || "the account that deployed the review script";
    throw new Error(`${who} can't open this file. Ask whoever owns the Google Form to open their Drive, `
      + `find the folder ending in "(File responses)", and share it with ${who} as an Editor.`);
  }
}

// A small preview of an uploaded file (the Drive link opens the full thing).
function filePreview_(fileId) {
  const f = driveFile_(fileId);
  const thumb = f.getThumbnail();
  return {
    name: f.getName(),
    type: f.getMimeType(),
    url: f.getUrl(),
    image: thumb ? "data:image/png;base64," + Utilities.base64Encode(thumb.getBytes()) : "",
  };
}
