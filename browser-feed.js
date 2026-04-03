const fs = require("fs");
const puppeteer = require("puppeteer-core");

const BROWSER_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

let browserPromise = null;

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function findBrowserExecutable() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function safeJsonParse(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

async function getBrowser() {
  if (browserPromise) {
    return browserPromise;
  }

  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new Error("Chrome or Edge is required for rendered TikTok lookups.");
  }

  browserPromise = puppeteer.launch({
    headless: "new",
    executablePath,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-default-browser-check",
      "--no-first-run",
      "--no-sandbox",
      "--window-size=1280,900"
    ]
  }).catch((error) => {
    browserPromise = null;
    throw error;
  });

  const browser = await browserPromise;
  browser.on("disconnected", () => {
    browserPromise = null;
  });

  return browser;
}

async function withPage(task, userAgent) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9"
    });
    return await task(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function fetchRenderedCollections(profileUrl, userAgent) {
  const captures = {
    posts: null,
    reposts: null,
    stories: null
  };

  await withPage(async (page) => {
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (["font", "image", "media", "stylesheet"].includes(request.resourceType())) {
        request.abort();
        return;
      }

      request.continue().catch(() => {});
    });

    page.on("response", (response) => {
      const url = response.url();

      if (
        !url.includes("/api/post/item_list/") &&
        !url.includes("/api/repost/item_list/") &&
        !url.includes("/api/story/item_list/")
      ) {
        return;
      }

      response.text()
        .then((text) => {
          const parsed = safeJsonParse(text);
          if (!parsed) {
            return;
          }

          if (url.includes("/api/post/item_list/") && !captures.posts) {
            captures.posts = parsed;
          }

          if (url.includes("/api/repost/item_list/") && !captures.reposts) {
            captures.reposts = parsed;
          }

          if (url.includes("/api/story/item_list/") && !captures.stories) {
            captures.stories = parsed;
          }
        })
        .catch(() => {});
    });

    const nextUrl = new URL(profileUrl);
    nextUrl.searchParams.set("lang", "en");

    await page.goto(nextUrl.toString(), {
      timeout: 45000,
      waitUntil: "domcontentloaded"
    });

    await delay(9000);
  }, userAgent);

  return captures;
}

module.exports = {
  fetchRenderedCollections
};
