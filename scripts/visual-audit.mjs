import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outputDir = process.env.SCREENSHOT_DIR || "/private/tmp/html-field-guide-audit";
const port = Number(process.env.CDP_PORT || 9337);
const profileDir = `/private/tmp/html-field-guide-chrome-${process.pid}`;
const guideFilter = process.env.GUIDE_FILTER || "";
const tabFilter = process.env.TAB_FILTER || "";
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

const preferredShots = new Map([
  ["ML - Feature Interactions", "deepfm"],
  ["ML - HSTU", "attention"],
  ["ML - Semantic IDs", "rqvae"],
  ["ML - Multimodal MMoE", "shazeer"],
  ["ML - OneRec", "ipa"],
  ["ML - Self Attention and Multi-Head Attention", "mha-worked"],
  ["ML - Activation Functions and SwiGLU", "worked"],
  ["RL - PPO and GRPO", "grpo"]
]);

function tabDefinitionsFromHtml(html) {
  return [...html.matchAll(/<button\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /\bclass="[^"]*\btab-btn\b[^"]*"/.test(tag))
    .map((tag) => {
      const key = tag.match(/\bdata-tab="([^"]+)"/)?.[1];
      const grouped = tag.match(/\bdata-panels="([^"]+)"/)?.[1];
      return key ? { key, panels: (grouped || key).split(",").map((panel) => panel.trim()).filter(Boolean) } : null;
    })
    .filter(Boolean);
}

const guides = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const page = join(root, entry.name, "index.html");
    try {
      const html = readFileSync(page, "utf8");
      if (!html.includes("../assets/guide.js") && entry.name !== "ML - Feature Interactions") return null;
      const tabs = tabDefinitionsFromHtml(html);
      if (!tabs.length) return null;
      return { dir: entry.name, page, tabs, shot: preferredShots.get(entry.name) || tabs[Math.floor(tabs.length / 2)].panels[0] };
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .filter((guide) => !guideFilter || guide.dir.includes(guideFilter))
  .map((guide) => {
    if (!tabFilter) return guide;
    const tabs = guide.tabs.filter((tab) => tab.key.includes(tabFilter) || tab.panels.some((panel) => panel.includes(tabFilter)));
    const shotIsCovered = tabs.some((tab) => tab.key === guide.shot || tab.panels.includes(guide.shot));
    return { ...guide, tabs, shot: shotIsCovered ? guide.shot : tabs[0]?.panels[0] };
  })
  .filter((guide) => guide.tabs.length)
  .sort((left, right) => left.dir.localeCompare(right.dir));

if (!guides.length) throw new Error("No shared-shell guides were found");
mkdirSync(outputDir, { recursive: true });

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        this.events.push(message);
      }
    };
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function connect() {
  let target;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      target = targets.find((entry) => entry.type === "page");
      if (target) break;
    } catch {}
    await delay(125);
  }
  if (!target) throw new Error("Chrome DevTools endpoint did not become ready");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.onopen = resolveOpen;
    socket.onerror = reject;
  });
  return new CDP(socket);
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Runtime evaluation failed");
  return response.result.value;
}

async function navigate(cdp, url, wait = 4000) {
  await cdp.send("Page.navigate", { url });
  await delay(wait);
}

async function activate(cdp, tab) {
  const found = await evaluate(cdp, `(() => {
    const button = document.querySelector('.tab-btn[data-tab="${tab}"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!found) throw new Error(`Missing browser tab control: ${tab}`);
  await delay(650);
}

async function collectMetrics(cdp) {
  return evaluate(cdp, `(() => {
    const active = [...document.querySelectorAll('.tab.active')];
    if (!active.length) return { fatal: 'No active panel' };
    const visible = (element) => element.getClientRects().length > 0;
    const protectedByScroller = (element) => {
      const panel = element.closest('.tab.active');
      for (let node = element; node && panel && node !== panel.parentElement; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowX;
        if (overflow === 'auto' || overflow === 'scroll') return true;
      }
      return false;
    };
    const activeElements = active.flatMap((panel) => [...panel.querySelectorAll('*')]);
    const uncontainedOverflow = activeElements
      .filter(visible)
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 4)
      .filter((element) => !protectedByScroller(element))
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        cls: element.className?.baseVal || element.className || '',
        client: element.clientWidth,
        scroll: element.scrollWidth
      }));
    const mermaids = active.flatMap((panel) => [...panel.querySelectorAll('.mermaid')]);
    const math = active.flatMap((panel) => [...panel.querySelectorAll('.math')]);
    const rawMath = [];
    active.forEach((panel) => {
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        const source = node.nodeValue || '';
        const slash = String.fromCharCode(92);
        if (!parent || parent.closest('script,style,pre,.mermaid,mjx-container')) continue;
        if (source.includes(slash + '(') || source.includes(slash + '[')) {
          rawMath.push({
            tag: parent.tagName,
            cls: parent.className?.baseVal || parent.className || '',
            text: source.trim().slice(0, 100)
          });
        }
      }
    });
    return {
      id: active[0].id,
      ids: active.map((panel) => panel.id),
      title: document.title,
      activeCount: active.length,
      selectedButton: document.querySelector('.tab-btn.active')?.dataset.tab || null,
      mermaidExpected: mermaids.length,
      mermaidRendered: mermaids.filter((element) => element.dataset.processed === 'true' && element.querySelector('svg')).length,
      mermaidErrors: mermaids.filter((element) => /syntax error|parse error/i.test(element.textContent)).length,
      mathExpected: math.length,
      mathRendered: math.filter((element) => element.querySelector('mjx-container')).length,
      rawMath: rawMath.slice(0, 8),
      rootOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      uncontainedOverflow,
      viewport: [innerWidth, innerHeight]
    };
  })()`);
}

async function smokeInteractions(cdp) {
  return evaluate(cdp, `(() => {
    const active = [...document.querySelectorAll('.tab.active')];
    const all = (selector) => active.flatMap((panel) => [...panel.querySelectorAll(selector)]);
    all('input[type="range"]').forEach((input) => {
      input.value = input.max;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    all('[data-choice-group]').forEach((group) => {
      const choices = group.querySelectorAll('[data-choice]');
      if (choices[1]) choices[1].click();
    });
    const attention = all('[data-attention-mode]');
    if (attention[1]) attention[1].click();
    const answerButton = all('[data-answer]')[0];
    if (answerButton) answerButton.click();
    return {
      ranges: all('input[type="range"]').length,
      activeChoices: all('[data-choice].active').length,
      revealedAnswers: all('.answer.show').length
    };
  })()`);
}

async function revealPanel(cdp, panel, expectedTab) {
  const found = await evaluate(cdp, `Boolean(document.getElementById(${JSON.stringify(panel)}))`);
  if (!found) throw new Error(`Missing deep-link panel: ${panel}`);
  await evaluate(cdp, `location.hash = ${JSON.stringify(`#${panel}`)}`);
  await delay(750);
  const alignment = await evaluate(cdp, `(() => {
    const target = document.getElementById(${JSON.stringify(panel)});
    return {
      hash: location.hash,
      selectedButton: document.querySelector(".tab-btn.active")?.dataset.tab || null,
      top: Math.round(target.getBoundingClientRect().top)
    };
  })()`);
  if (alignment.hash !== `#${panel}` || alignment.selectedButton !== expectedTab || alignment.top < 35 || alignment.top > 75) {
    throw new Error(`Broken deep link ${panel}: ${JSON.stringify(alignment)}`);
  }
}

async function screenshot(cdp, name) {
  const response = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  writeFileSync(join(outputDir, `${name}.png`), Buffer.from(response.data, "base64"));
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function guideUrl(guide, tab) {
  return `${pathToFileURL(guide.page).href}#${tab}`;
}

const chrome = spawn(chromePath, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--allow-file-access-from-files",
  `--remote-debugging-port=${port}`,
  "--remote-debugging-address=127.0.0.1",
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--disable-default-apps",
  "--window-size=1440,1400",
  "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] });

let chromeErrors = "";
chrome.stderr.on("data", (chunk) => { chromeErrors += chunk.toString(); });

let failed = false;
try {
  const cdp = await connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false });

  await navigate(cdp, pathToFileURL(join(root, "index.html")).href, 1500);
  const landingDesktop = await evaluate(cdp, `({
    cards: document.querySelectorAll('.guide-card').length,
    rootOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    title: document.title
  })`);
  await screenshot(cdp, "landing-desktop");
  console.log("LANDING desktop", JSON.stringify(landingDesktop));

  for (const guide of guides) {
    await navigate(cdp, guideUrl(guide, guide.tabs[0].key));
    const eventBaseline = cdp.events.length;

    for (const tab of guide.tabs) {
      await activate(cdp, tab.key);
      const report = await collectMetrics(cdp);
      const panelsMatch = report.ids?.length === tab.panels.length && report.ids.every((id, index) => id === tab.panels[index]);
      const bad = report.fatal ||
        report.activeCount !== tab.panels.length ||
        !panelsMatch ||
        report.selectedButton !== tab.key ||
        report.mermaidRendered !== report.mermaidExpected ||
        report.mermaidErrors ||
        (report.mathExpected && report.mathRendered !== report.mathExpected) ||
        report.rawMath.length ||
        report.rootOverflow > 2 ||
        report.uncontainedOverflow.length;
      if (bad) failed = true;
      console.log(`${bad ? "FAIL" : "PASS"} desktop ${guide.dir}#${tab.key}`, JSON.stringify(report));
      await smokeInteractions(cdp);
      if (tab.key === guide.shot || tab.panels.includes(guide.shot)) {
        await revealPanel(cdp, guide.shot, tab.key);
        await screenshot(cdp, `${slugify(guide.dir)}-${guide.shot}-desktop`);
      }
    }

    const browserErrors = cdp.events.slice(eventBaseline).filter((event) =>
      event.method === "Runtime.exceptionThrown" ||
      (event.method === "Log.entryAdded" && event.params?.entry?.level === "error") ||
      (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error")
    );
    if (browserErrors.length) {
      failed = true;
      console.log("BROWSER_ERRORS", guide.dir, JSON.stringify(browserErrors));
    }

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    for (const tab of guide.tabs) {
      await activate(cdp, tab.key);
      const report = await collectMetrics(cdp);
      const panelsMatch = report.ids?.length === tab.panels.length && report.ids.every((id, index) => id === tab.panels[index]);
      const bad = report.fatal ||
        report.activeCount !== tab.panels.length ||
        !panelsMatch ||
        report.selectedButton !== tab.key ||
        report.rawMath.length ||
        report.rootOverflow > 2 ||
        report.uncontainedOverflow.length;
      if (bad) failed = true;
      console.log(`${bad ? "FAIL" : "PASS"} mobile ${guide.dir}#${tab.key}`, JSON.stringify({
        ids: report.ids,
        rawMath: report.rawMath,
        rootOverflow: report.rootOverflow,
        uncontainedOverflow: report.uncontainedOverflow,
        viewport: report.viewport
      }));
      if (tab.key === guide.shot || tab.panels.includes(guide.shot)) {
        await revealPanel(cdp, guide.shot, tab.key);
        await screenshot(cdp, `${slugify(guide.dir)}-${guide.shot}-mobile`);
      }
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false });
  }

  await navigate(cdp, pathToFileURL(join(root, "index.html")).href, 1000);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const landingMobile = await evaluate(cdp, `({
    cards: document.querySelectorAll('.guide-card').length,
    rootOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    title: document.title
  })`);
  if (landingMobile.cards < guides.length || landingMobile.rootOverflow > 2) failed = true;
  await screenshot(cdp, "landing-mobile");
  console.log("LANDING mobile", JSON.stringify(landingMobile));
  cdp.socket.close();
} catch (error) {
  failed = true;
  console.error(error.stack || error.message);
} finally {
  chrome.kill("SIGTERM");
  await delay(300);
  rmSync(profileDir, { recursive: true, force: true });
}

if (/SyntaxError|Uncaught|ERR_FILE_NOT_FOUND/.test(chromeErrors)) {
  console.error(chromeErrors);
  failed = true;
}

console.log(`Screenshots: ${outputDir}`);
process.exit(failed ? 1 : 0);
