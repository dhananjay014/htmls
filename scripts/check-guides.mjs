import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = [
  "index.html",
  "ML - HSTU/index.html",
  "ML - Semantic IDs/index.html",
  "ML - Multimodal MMoE/index.html",
  "ML - OneRec/index.html",
  "RL - PPO and GRPO/index.html"
];

let failed = false;
for (const page of pages) {
  const absolutePage = resolve(root, page);
  const html = readFileSync(absolutePage, "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const tabDefinitions = [...html.matchAll(/<button\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /\bclass="[^"]*\btab-btn\b[^"]*"/.test(tag))
    .map((tag) => {
      const key = tag.match(/\bdata-tab="([^"]+)"/)?.[1];
      const grouped = tag.match(/\bdata-panels="([^"]+)"/)?.[1];
      return key ? { key, panels: (grouped || key).split(",").map((panel) => panel.trim()).filter(Boolean) } : null;
    })
    .filter(Boolean);
  const tabKeys = tabDefinitions.map((tab) => tab.key);
  const duplicateTabKeys = [...new Set(tabKeys.filter((key, index) => tabKeys.indexOf(key) !== index))];
  const tabTargets = tabDefinitions.flatMap((tab) => tab.panels);
  const panels = [...html.matchAll(/class="[^"]*\btab\b[^"]*"[^>]*id="([^"]+)"/g)].map((match) => match[1]);
  const missingTargets = tabTargets.filter((target) => !ids.includes(target));
  const orphanPanels = panels.filter((panel) => !tabTargets.includes(panel));
  const badLinks = [];

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = match[1];
    if (/^(?:https?:|#|data:|mailto:)/.test(raw)) continue;
    const clean = decodeURIComponent(raw.split("#")[0].split("?")[0]);
    if (!clean) continue;
    if (!existsSync(resolve(dirname(absolutePage), clean))) badLinks.push(raw);
  }

  const report = {
    tabs: tabDefinitions.length,
    panels: panels.length,
    mermaid: (html.match(/class="mermaid"/g) || []).length,
    mathBlocks: (html.match(/class="math"/g) || []).length,
    quizzes: (html.match(/class="[^"]*quiz[^"]*"/g) || []).length
  };
  console.log(`${page}: ${JSON.stringify(report)}`);

  if (duplicateIds.length || duplicateTabKeys.length || missingTargets.length || orphanPanels.length || badLinks.length) {
    failed = true;
    console.error(JSON.stringify({ duplicateIds, duplicateTabKeys, missingTargets, orphanPanels, badLinks }, null, 2));
  }
}

process.exit(failed ? 1 : 0);
