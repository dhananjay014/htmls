# Field-guide validation tools

Run these commands from the repository root before publishing:

```sh
node scripts/check-guides.mjs
ruby scripts/audit-raw-math.rb
node scripts/visual-audit.mjs
```

`check-guides.mjs` validates duplicate IDs, navigation-to-panel mappings (including grouped `data-panels` views), local assets, local PDFs, and basic content counts. Add a new guide to its `pages` list when the library grows.

`audit-raw-math.rb` detects TeX-like notation left outside `\(...\)` or `\[...\]`. It requires Ruby and Nokogiri. In HTML-embedded TeX, prefer `&lt;` or `\lt` instead of a literal `<` so HTML parsers do not mistake a subscript for markup.

`visual-audit.mjs` automatically discovers top-level guides that use `assets/guide.js`. It opens every grouped navigation view in headless Chrome, waits for Mermaid and MathJax, checks desktop and 390px mobile overflow, smoke-tests interactive controls, and saves representative screenshots.

Defaults on macOS:

- Chrome: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- screenshots: `/private/tmp/html-field-guide-audit`
- Chrome DevTools port: `9337`

Override them when needed:

```sh
CHROME_PATH=/path/to/chrome SCREENSHOT_DIR=/path/to/output CDP_PORT=9444 node scripts/visual-audit.mjs
```

For a fast targeted rerun after a small fix:

```sh
GUIDE_FILTER='RL - PPO' TAB_FILTER=reason node scripts/visual-audit.mjs
```

`TAB_FILTER` can match either a sidebar view key such as `build`/`reason` or an individual chapter ID such as `ppo-worked`; matching a chapter audits its containing view.

Because the guides load MathJax from a CDN, the visual audit needs network access. Mermaid is vendored under `assets/` and works offline.
