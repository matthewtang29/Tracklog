# Tracklog: portfolio polish handoff (Nov 11, 2026)

This pass builds on PR #1 (`launch-hardening`: CSP, 404, privacy/terms, Open Graph, icons, sitemap, sticky mobile upload button). The branch `portfolio-polish` is stacked on it, so **merge PR #1 first**, then this one.

## What changed, and what depends on it

### 1. Library.xml can't crash the app (malformed files)
- **What:** new `js/plist.js`, a streaming parser for Apple's plist XML that replaces `DOMParser`. It refuses tags in the wrong place, mismatched or unclosed tags, files that end early, nesting deeper than 64 levels, and embedded DTDs (entity tricks). Each problem gets a plain-English message plus "export it again" steps.
- `js/worker.js` type-checks every field: names must be text, counts must be numbers, dates must look like dates, and playlists must be lists. A damaged song is skipped and counted ("1 damaged entry skipped") instead of failing the file.
- The database is built in one transaction. If anything fails, it rolls back and closes, and **the library you were looking at stays on screen**. The new library is only swapped in once it has fully loaded.
- Dicts are created without a prototype, so a `__proto__` key in a file is just a key.
- **Depends on it:** `js/main.js` upload flow and the sample library both go through the worker now. The SQL files and schema are unchanged.
- **Tested:** truncated file, a dict where a name should be, text play counts, Playlists as a dict, a bad export date, 20,000-deep nesting, HTML instead of a plist, an embedded DTD, an empty file, and a `__proto__` key. Each one either loads what it can or shows a clear error. None leave a blank message.

### 2. Huge files don't freeze the page
- **What:** reading, building and querying all moved into a Web Worker (`js/worker.js`). The page's side is `js/database.js` (`Library.build()` and `library.query()`). The file is read in chunks with a progress box ("Reading Library.xml… 40%", then "Building the database…").
- A 158 MB, 250,000-song test file used to freeze the tab for 73 seconds. Now it loads in about 44 seconds, and the page keeps animating the whole time (longest frame was 33 ms).
- SQL console queries are stopped after 10 seconds (the worker is restarted from a saved copy of the database), and results are capped at 200 rows in transfer.
- **Depends on it:** every query is now async, so `renderAll()` and `runUserQuery()` in `main.js` `await` results. If you add a card, follow the README steps; the pattern is unchanged.

### 3. sql.js and the Inter font are self-hosted
- **What:** `vendor/sql.js/` (1.12.0, the same file as the CDN; its SHA-384 matches the npm package) and `vendor/inter/` (variable font, latin + latin-ext). Licences are included.
- The CSP is now `script-src 'self'`, `style-src 'self'`, `font-src 'self'`. jsDelivr and Google Fonts are gone from every page.
- **Depends on it:** the CSP meta tags in `index.html`, `privacy.html`, `terms.html` and `404.html`, and the `@font-face` rules at the top of `css/styles.css`. The SRI hash from PR #1 is gone because the script is no longer loaded from another site.

### 4. Upload works with a keyboard
- **What:** the four upload "buttons" were `<label>`s for a hidden input, which Tab skips. They're real `<button data-upload>`s now and open the file picker. Tested: Tab reaches it and Enter opens the picker.
- **Depends on it:** `main.js` wires every `[data-upload]` button. Buttons with `data-upload-label` change to "Upload a different file" after you load your own library.

### 5. Privacy: ask before sending song names to Apple
- **What:** when you upload your own library, no cover lookups happen until you choose **Find covers** in the sidebar. **No thanks** turns covers off. The sample library never searches because it ships its own cover links. Tested: 0 requests to iTunes before saying yes.
- A new **Clear saved covers & settings** button removes everything Tracklog keeps in `localStorage`.
- The copy is now accurate. The intro says the file is "never uploaded" and is gone when you reload. `privacy.html` explains that the saved cover cache is keyed by song title and artist, so it does reveal some of your songs to anyone using that browser. It also explains the ask-first rule and the self-hosted font and engine.
- **Depends on it:** `artwork.js` exports `artChoice()`, `setArtChoice()` and `clearSavedData()`. `render.js` passes `lookup` through to `attachArtwork()`. The old `setArtEnabled()` is gone.

### 6. Cover lookups: JSONP removed, queue bug fixed
- **What:** removed the JSONP fallback, which ran a script from Apple with full page access. Lookups use `fetch` only (no cookies, no referrer). Fixed a race where loading a new library mid-lookup could leave two lookup loops running, doubling the request rate and triggering more of Apple's blocks.
- **Depends on it:** `itunes.apple.com` is now only in `connect-src`, not `script-src`.

### 7. Design: one accent, on the primary action only
- **What:** sage (`--accent`) is now used only on the Upload button (and the 404 page's "Go to Tracklog"). Everything else is neutral:
  - links: grey with underline
  - nav highlight and focus ring: white
  - chart bars: grey, with the top or peak bar in light grey
  - chips, the logo and the dialog step numbers: neutral
- "Run query" and "Find covers" use a neutral `.btn.quiet`. Placeholder covers are one flat grey instead of a random hue per song. The mobile upload bar is solid instead of a frosted blur. The error colour (`--bad`) stays because it carries meaning.
- No text is smaller than 12px anymore (117 elements were before). Panel headers wrap on narrow phones, and the 360px layout has no horizontal scroll.
- **Depends on it:** only `css/styles.css` tokens at the top and `render.js` (the random-hue code was removed).

### 8. README
- Rewritten as a portfolio piece: one-line pitch, live link, a demo GIF placeholder (shows `img/og-image.png` until you record one), features, tech stack, why I built it, how it works, how to run it on Mac and Windows, and project structure.

## What's left (needs you)

1. **Merge PR #1, then this PR.** GitHub Pages deploys from `main`.
2. **Record the demo GIF.** Take about 10 seconds: upload, dashboard fills in, run a query. Save it as `docs/demo.gif` and change the image line near the top of the README.
3. **Refresh `img/og-image.png`.** It was made before this design pass and may still show sage bars. Re-screenshot the dashboard at 1200×630.
4. **Check on your real library.** You should see 697 items, ~20,114 plays, ~1,266 hours, top artist Daniel Caesar. Also check it on Safari and on your Windows PC (Chrome or Edge). Tests here ran in headless Chromium only.
5. **Optional next features** from the earlier handoff: weekly snapshot diffs for play history and streaks, CSV or database download, and time-of-day stats once Apple's privacy export arrives.

## Rule for future work

Commits are authored and committed as `Matthew Tang <mtang2929@gmail.com>`, with no Claude co-author trailer.
