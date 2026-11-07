# SailKind Global Voices

A world map of ocean conservation stories at https://sailkind.com. People submit a Google Form, a reviewer approves or denies each response at `/admin`, and approved stories appear as pins. There is no bundler, framework or test suite; the site is plain HTML and JS.

## Layout

- `index.html` is the whole public site, and `form.js` turns the sheet's "Public" tab into stories.
- `stories.json` is rewritten by the `import-form` GitHub Action every 15 minutes. Don't hand-edit it, and expect bot commits on `main`, so pull before pushing.
- `admin.html` is the review page. It is static and public on purpose: no data or secrets ship in it, and everything comes from the API after sign-in.
- `admin/Code.gs` is the review API, an Apps Script bound to the form's Google Sheet. `admin/set-login.mjs` makes sign-ins.
- `feed/Code.gs` is a separate Apps Script that serves the Public tab as CSV, so the map updates within about 10 seconds without Google's 5-minute publish delay.

## Hosting

- The site runs on Tower behind a Cloudflare Tunnel. Tower pulls `main` every 5 minutes and serves only an allowlist of files, so a new public file must also be added there. Tower's config is not in this repo.
- Apps Script changes do not go live by pushing to git. They need `admin/deploy.ps1` or `feed/deploy.ps1`, run by the user in their own terminal.
- Both deployments keep the same `/exec` URL. `admin.html` hard-codes the admin one and `form.js` the feed one.

## Review API rules

- `admin/Code.gs` runs as the deployer and is open to anonymous callers, so `doPost` is the only door. Only `login` works without a session.
- Keep every helper's trailing underscore. It stops browsers calling the function directly. New page actions go in the `API` map.
- `doGet` must never return HtmlService output: a served page could call non-underscore functions as the deployer.
- The page sends `Content-Type: text/plain` on purpose. Apps Script can't answer a CORS preflight.
- `HASH_ROUNDS` must match in `admin/Code.gs` and `admin/set-login.mjs`.
- The script runs as the deployer, so that account needs access to the form's "(File responses)" Drive folder or photo previews and sharing fail.

## Conventions

- Form answers are untrusted and the page holds a session, so everything rendered in `admin.html` goes through `esc()`.
- The website finds Public-tab columns by header text. `PUBLIC_HEADERS` in `admin/Code.gs` and the matchers in `form.js` must agree.
- Response rows are keyed by their timestamp, not row number.
- `Code.gs` never edits a response except its "Review status" column.

## Running and testing

- Serve the repo root with any static server to view the site.
- `admin.html` needs the API. To test it locally, run `admin/Code.gs` in Node's `vm` against stubbed Google services and point `API_URL` at that.
- `node admin/set-login.mjs` prompts for a login and prints a Script Property to paste into the Apps Script project.
- After an API deploy, check the real thing: sign in at `/admin`, confirm stories and photo previews load, and confirm a wrong password is refused.
- Take verification screenshots at scale 0.5.
