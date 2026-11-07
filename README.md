# SailKind Global Voices

A world map of ocean conservation stories. Click a pin to read a community's story; use **Share your story** to add one.

## How it works

- `index.html` — the whole website (map + story panel).
- `stories.json` — every published story. The pins come from here.
- `robots.txt`, `sitemap.xml` — help search engines find https://sailkind.com.
- Someone clicks **Share your story** → the Google Form opens in a new tab.

## Hosting

The site runs on Tower (a home server) behind a Cloudflare Tunnel. Tower pulls `main` every 5 minutes and serves only `index.html`, `form.js`, `stories.json`, `robots.txt` and `sitemap.xml`, so a change here goes live within about 5 minutes. A new public file must also be added to the list on Tower.
