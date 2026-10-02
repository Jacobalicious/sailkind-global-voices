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
  city:         h => h.startsWith("city") || h.startsWith("town") || h.includes("what city"),
  country:      h => h.startsWith("country") || h.includes("what country"),
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
    const city = g(r, "city"), country = g(r, "country");
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
      wish: p["Wish people understood"], issues: p["Top 3 issues"], showPhoto: !!p["File to attach"],
    } : Object.assign({ title: "", lat: "", lng: "", topic: "", showPhoto: false }, original);

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
      fileIds: (g(r, "file").match(/[?&]id=[\w-]+|\/d\/[\w-]+/g) || []).map(driveId_),
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
function locate(place, expectCountry) {
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
