# HTML Field Guides — project memory

This repository publishes the machine-learning field guides on GitHub Pages. The root `index.html` is the guide library; each guide lives in its own directory with an `index.html` and local paper PDFs.

## Reusable quality checks

Keep the validation tools in `scripts/` and run them from the repository root before publishing new or changed guides:

- `node scripts/check-guides.mjs` checks tab/panel mappings, duplicate IDs, local links, and expected guide structure.
- `ruby scripts/audit-raw-math.rb` finds TeX-like notation accidentally left outside MathJax delimiters. It requires the `nokogiri` gem.
- `node scripts/visual-audit.mjs` opens every guide tab in headless Chrome at desktop and mobile sizes, verifies Mermaid and MathJax rendering, checks overflow, smoke-tests controls, and writes representative screenshots to `/private/tmp/html-field-guide-audit` by default.

See `scripts/README.md` for options and exact commands. These files are intended to remain in the repository so later Codex sessions can reuse the same validation workflow.

## Guide conventions

- Shared presentation and interaction code lives in `assets/guide.css`, `assets/guide.js`, and `assets/mermaid.min.js`.
- Explanations should start from intuition, then give exact math, tensor/data flow, worked examples, evidence, caveats, revision notes, and local primary-paper links.
- Every Mermaid figure needs a caption and consistent semantic color roles.
- Verify every tab at both desktop and mobile widths before publishing.
- Preserve local PDFs so each guide remains useful offline; external arXiv links are companions, not replacements.
