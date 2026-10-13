// SailKind public feed — hands the website the sheet's "Public" tab, as CSV.
// Google's "Publish to web" copy of the tab only refreshes every ~5 minutes; this
// reads the sheet itself, so a story saved on the review page shows up right away.
// (openById needs the full "spreadsheets" permission, though this only reads.)
// It only ever reads the Public tab (approved stories, safe columns), which is
// already published anyway — never the form responses.
// Upload with feed/deploy.ps1.

const SHEET_ID = "1mjo8dTvW8ysBmBbtYNlWS5hrF-1qQ-4wTp9Q4kvrRoM";
const PUBLIC_SHEET = "Public";

function doGet() {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(PUBLIC_SHEET);
  const rows = sh ? sh.getDataRange().getDisplayValues() : [];
  const csv = rows.map(r => r.map(cell).join(",")).join("\r\n");
  return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.CSV);
}

function cell(v) {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
