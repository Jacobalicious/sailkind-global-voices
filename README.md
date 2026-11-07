# SailKind Global Voices

A world map of ocean conservation stories. Click a pin to read a community's story; use **Share your story** to add one.

## How it works

- `index.html` — the whole website (map + story panel).
- `stories.json` — every published story. The pins come from here.
- `admin.html` — the review page at https://sailkind.com/admin, where you sign in and approve or deny stories. It holds no story data; it talks to `admin/Code.gs`.
- `robots.txt`, `sitemap.xml` — help search engines find https://sailkind.com.
- Someone clicks **Share your story** → the Google Form opens in a new tab.

## Hosting

The site runs on Tower (a home server) behind a Cloudflare Tunnel. Tower pulls `main` every 5 minutes and serves only `index.html`, `admin.html`, `form.js`, `stories.json`, `robots.txt` and `sitemap.xml`, so a change here goes live within about 5 minutes. A new public file must also be added to the list on Tower.

## Review page sign-in

Sign-ins live in the form sheet's Apps Script project, as Script Properties. To add a reviewer or change a password, run this and paste the two lines it prints into Project Settings > Script Properties:

```bash
node admin/set-login.mjs
```

Changing or deleting a property takes effect on the next sign-in, with no deploy. `admin/deploy.ps1` uploads changes to `admin/Code.gs`; changes to `admin.html` go live with the normal pull on Tower.
