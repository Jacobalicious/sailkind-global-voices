# SailKind Global Voices

A world map of ocean conservation stories. Click a pin to read a community's story; use **Share your story** to add one.

## How it works

- `index.html` — the whole website (map + story panel + share form).
- `stories.json` — every published story. The pins come from here.
- Someone clicks **Share your story** → fills in the form → it opens a pre-filled GitHub issue for them to post.
- A moderator reads the issue and adds the **approved** label → a GitHub Action copies it into `stories.json`, redeploys the site, comments with the link and closes the issue.
- To reject a story, just close the issue.

The seven stories in `stories.json` marked `"sample": true` are placeholders — delete them once real stories arrive.
