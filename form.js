// Turns the published "Public" tab of the Google Form responses sheet into map stories.
// Shared by the website (dev preview) and the GitHub Action that updates stories.json.

// The published CSV link of the sheet's "Public" tab (approved rows, safe columns only).
export const FORM_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTTdOA4JZ-_N3hj4IyahX-HUZANzbqd120A0SHK6CwmQWtXgi76WBWYwv_98EHI7WCFUdEpkbOzbMmo/pub?gid=584150587&single=true&output=csv";

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim()));
}

// Columns are found by words in the question, not position, so reordering the form is fine.
const COLUMNS = {
  timestamp:    h => h.startsWith("timestamp"),
  name:         h => h.includes("prefer to be called"),
  about:        h => h.includes("about yourself"),
  relationship: h => h.includes("relationship with the ocean"),
  issue:        h => h.includes("one ocean issue"),
  doing:        h => h.includes("what is your community doing"),
  wish:         h => h.includes("wish people"),
  issues:       h => h.includes("top 3"),
  consent:      h => h.includes("by checking the box"),
  file:         h => h.includes("file to attach"),
  place:        h => h.startsWith("map location"),
  city:         h => h.startsWith("city") || h.startsWith("town") || h.includes("what city"),
  country:      h => h.startsWith("country") || h.includes("what country"),
  approved:     h => h.startsWith("approved"),
  // Set by the review page (admin/): overrides for the automatic guesses.
  title:        h => h === "title",
  topic:        h => h === "topic",
  lat:          h => h === "latitude",
  lng:          h => h === "longitude",
};

const TOPIC_WORDS = [
  ["Coral & reefs",       /coral|reef|bleach/],
  ["Plastic & cleanups",  /plastic|trash|litter|waste|pollut|debris|sewage|runoff/],
  ["Fisheries",           /fish|bycatch|trawl/],
  ["Mangroves & coasts",  /mangrove|coast|erosion|sea.?level|wetland|seagrass|develop/],
  ["Marine wildlife",     /wildlife|species|turtle|whale|shark|dolphin|bird|habitat/],
  ["Climate & ocean",     /climate|warming|acidif|temperature|storm|heat/],
];

function topicFrom(text) {
  for (const choice of (text || "").split(",")) {
    const hit = TOPIC_WORDS.find(([, re]) => re.test(choice.toLowerCase()));
    if (hit) return hit[0];
  }
  return "Other";
}

// Form uploads are Google Drive links; turn the first into a direct image URL.
// (Only shows if that file is shared as "Anyone with the link".)
function photoFrom(text) {
  const m = /[?&]id=([\w-]+)|\/d\/([\w-]+)/.exec(text || "");
  return m ? `https://drive.google.com/thumbnail?id=${m[1] || m[2]}&sz=w1600` : "";
}

// Stable id from the response's timestamp.
function idFrom(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return "form-" + h.toString(36);
}

// Country names people type that don't match what a map service calls the place.
// Keys and values have no spaces or punctuation (see normCountry).
const COUNTRY_ALIASES = {
  usa: "unitedstates", us: "unitedstates", unitedstatesofamerica: "unitedstates", america: "unitedstates",
  uk: "unitedkingdom", greatbritain: "unitedkingdom", britain: "unitedkingdom", england: "unitedkingdom",
  scotland: "unitedkingdom", wales: "unitedkingdom", northernireland: "unitedkingdom",
  uae: "unitedarabemirates", holland: "netherlands", ivorycoast: "cotedivoire",
  burma: "myanmar", czechia: "czechrepublic", swaziland: "eswatini", russianfederation: "russia",
  republicofkorea: "southkorea", unitedrepublicoftanzania: "tanzania", republicofireland: "ireland",
  peoplesrepublicofchina: "china", cabobverde: "capeverde",
};

// Boils a country name down to bare letters, so "Côte d'Ivoire", "Cote d Ivoire"
// and "COTE DIVOIRE" all end up the same.
export function normCountry(s) {
  const k = String(s || "").toLowerCase()
    // NFD splits accents off their letters; dropping everything but a-z then removes them.
    .normalize("NFD").replace(/[^a-z ]+/g, " ").replace(/\bthe\b/g, " ").replace(/ +/g, "");
  return COUNTRY_ALIASES[k] || k;
}

// True when two country names mean the same country. Unknown on either side counts
// as a match, so a blank answer never holds a story back.
export function sameCountry(a, b) {
  const x = normCountry(a), y = normCountry(b);
  return !x || !y || x === y;
}

// OpenStreetMap's free place-name lookup. Their rules: at most one request a second.
// When the form gave city and country as separate answers we search on those fields
// directly, which is far less likely to land on a same-named town in another country
// than searching one line of free text.
export async function geocode(place, { city = "", country = "" } = {}) {
  const tries = [];
  if (city && country) tries.push({ city, country });
  if (place) tries.push({ q: place });
  if (!tries.length && country) tries.push({ country });

  for (const fields of tries) {
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&"
      + new URLSearchParams(fields);
    const res = await fetch(url, { headers: typeof window === "undefined"
      ? { "User-Agent": "sailkind-global-voices (github.com/Jacobalicious/sailkind-global-voices)" } : {} });
    await new Promise(r => setTimeout(r, 1100));
    const [hit] = res.ok ? await res.json() : [];
    if (hit) return {
      lat: +(+hit.lat).toFixed(4),
      lng: +(+hit.lon).toFixed(4),
      country: (hit.address && hit.address.country) || "",
      label: hit.display_name || "",
    };
  }
  return null;
}

// known: earlier form stories by id, so unchanged places aren't looked up again.
export async function formStories(csvText, { known = {}, lookup = geocode } = {}) {
  const [header = [], ...rows] = parseCsv(csvText);
  if (!rows.length) return { stories: [], problems: [] };  // nothing approved yet
  const col = {};
  header.forEach((h, i) => {
    const key = Object.keys(COLUMNS).find(k => COLUMNS[k](h.trim().toLowerCase()));
    if (key && !(key in col)) col[key] = i;
  });
  for (const needed of ["timestamp", "place", "approved"]) {
    if (!(needed in col)) throw new Error(`Couldn't find the "${needed}" column in the sheet.`);
  }

  const stories = [], problems = [];
  for (const r of rows) {
    const get = k => (col[k] === undefined ? "" : (r[col[k]] || "").trim());
    if (get("approved").toLowerCase() !== "yes") continue;

    const id = idFrom(get("timestamp"));
    const name = get("name") || "A SailKind voice";
    // The reviewer's "Map location" wins; otherwise build one from the city and
    // country answers on the form.
    const city = get("city"), said = get("country");
    const place = get("place") || [city, said].filter(Boolean).join(", ");
    if (!place) { problems.push(`${name}: no city, country or map location filled in`); continue; }

    const lat = parseFloat(get("lat")), lng = parseFloat(get("lng"));
    const pos = isFinite(lat) && isFinite(lng) ? { lat, lng }
      : known[id]?.place === place ? { lat: known[id].lat, lng: known[id].lng }
      : await lookup(place, { city, country: said });
    if (!pos) { problems.push(`${name}: couldn't find "${place}" on the map. Try "City, Country".`); continue; }
    // A pin in the wrong country is worse than no pin: hold the story back and say so.
    if (said && pos.country && !sameCountry(said, pos.country)) {
      problems.push(`${name}: "${place}" came back in ${pos.country}, but they said ${said}. `
        + `Set the pin by hand on the review page.`);
      continue;
    }

    const d = new Date(get("timestamp"));
    const sections = [
      ["About me", get("about")],
      ["Our community and the ocean", get("relationship")],
      ["An issue we see", get("issue")],
      ["What we're doing", get("doing")],
      ["What I wish the world understood", get("wish")],
      ["Biggest issues here", get("issues")],
    ].filter(([, v]) => v);

    stories.push({
      id,
      title: get("title") || `${name} · ${city || place.split(",")[0].trim()}`,
      name,
      community: "",
      place,
      city: city || place.split(",")[0].trim(),
      country: said || pos.country || place.split(",").pop().trim(),
      ...pos,
      topic: get("topic") || topicFrom(get("issues")),
      date: isNaN(d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      story: sections.map(([h, v]) => `## ${h}\n${v}`).join("\n\n"),
      photo: get("consent") ? photoFrom(get("file")) : "",  // media only with the permission box ticked
      link: "",
    });
  }
  return { stories: stories.reverse(), problems };  // newest first
}
