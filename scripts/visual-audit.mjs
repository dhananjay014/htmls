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
  ["ML - HSTU", "attention"],
  ["ML - Semantic IDs", "rqvae"],
  ["ML - Multimodal MMoE", "taxonomy"],
  ["ML - OneRec", "ipa"],
  ["RL - PPO and GRPO", "grpo"]
]);

const guides = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const page = join(root, entry.name, "index.html");
    try {
      const html = readFileSync(page, "utf8");
      if (!html.includes("../assets/guide.js")) return null;
      const tabs = [...html.matchAll(/class="[^"]*\btab-btn\b[^"]*"[^>]*data-tab="([^"]+)"/g)].map((match) => match[1]);
      if (!tabs.length) return null;
      return { dir: entry.name, page, tabs, shot: preferredShots.get(entry.name) || tabs[Math.floor(tabs.length / 2)] };
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .filter((guide) => !guideFilter || guide.dir.includes(guideFilter))
  .map((guide) => {
    if (!tabFilter) return guide;
    const tabs = guide.tabs.filter((tab) => tab.includes(tabFilter));
    return { ...guide, tabs, shot: tabs[0] };
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
    const active = document.querySelector('.tab.active');
    if (!active) return { fatal: 'No active panel' };
    const visible = (element) => element.getClientRects().length > 0;
    const protectedByScroller = (element) => {
      for (let node = element; node && node !== active.parentElement; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowX;
        if (overflow === 'auto' || overflow === 'scroll') return true;
      }
      return false;
    };
    const uncontainedOverflow = [...active.querySelectorAll('*')]
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
    const mermaids = [...active.querySelectorAll('.mermaid')];
    const math = [...active.querySelectorAll('.math')];
    return {
      id: active.id,
      title: document.title,
      activeCount: document.querySelectorAll('.tab.active').length,
      selectedButton: document.querySelector('.tab-btn.active')?.dataset.tab || null,
      mermaidExpected: mermaids.length,
      mermaidRendered: mermaids.filter((element) => element.dataset.processed === 'true' && element.querySelector('svg')).length,
      mermaidErrors: mermaids.filter((element) => /syntax error|parse error/i.test(element.textContent)).length,
      mathExpected: math.length,
      mathRendered: math.filter((element) => element.querySelector('mjx-container')).length,
      rootOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      uncontainedOverflow,
      viewport: [innerWidth, innerHeight]
    };
  })()`);
}

async function smokeInteractions(cdp) {
  return evaluate(cdp, `(() => {
    const active = document.querySelector('.tab.active');
    active.querySelectorAll('input[type="range"]').forEach((input) => {
      input.value = input.max;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    active.querySelectorAll('[data-choice-group]').forEach((group) => {
      const choices = group.querySelectorAll('[data-choice]');
      if (choices[1]) choices[1].click();
    });
    const attention = active.querySelectorAll('[data-attention-mode]');
    if (attention[1]) attention[1].click();
    const answerButton = active.querySelector('[data-answer]');
    if (answerButton) answerButton.click();
    return {
      ranges: active.querySelectorAll('input[type="range"]').length,
      activeChoices: active.querySelectorAll('[data-choice].active').length,
      revealedAnswers: active.querySelectorAll('.answer.show').length
    };
  })()`);
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
    await navigate(cdp, guideUrl(guide, guide.tabs[0]));
    const eventBaseline = cdp.events.length;

    for (const tab of guide.tabs) {
      await activate(cdp, tab);
      const report = await collectMetrics(cdp);
      const bad = report.fatal ||
        report.activeCount !== 1 ||
        report.id !== tab ||
        report.selectedButton !== tab ||
        report.mermaidRendered !== report.mermaidExpected ||
        report.mermaidErrors ||
        (report.mathExpected && report.mathRendered !== report.mathExpected) ||
        report.rootOverflow > 2 ||
        report.uncontainedOverflow.length;
      if (bad) failed = true;
      console.log(`${bad ? "FAIL" : "PASS"} desktop ${guide.dir}#${tab}`, JSON.stringify(report));
      await smokeInteractions(cdp);
      if (tab === guide.shot) await screenshot(cdp, `${slugify(guide.dir)}-${tab}-desktop`);
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
      await activate(cdp, tab);
      const report = await collectMetrics(cdp);
      const bad = report.fatal ||
        report.activeCount !== 1 ||
        report.id !== tab ||
        report.selectedButton !== tab ||
        report.rootOverflow > 2 ||
        report.uncontainedOverflow.length;
      if (bad) failed = true;
      console.log(`${bad ? "FAIL" : "PASS"} mobile ${guide.dir}#${tab}`, JSON.stringify({
        id: report.id,
        rootOverflow: report.rootOverflow,
        uncontainedOverflow: report.uncontainedOverflow,
        viewport: report.viewport
      }));
      if (tab === guide.shot) await screenshot(cdp, `${slugify(guide.dir)}-${tab}-mobile`);
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
