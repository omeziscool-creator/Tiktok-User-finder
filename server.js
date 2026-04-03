const http = require("http");
const fs = require("fs");
const path = require("path");
const { fetchRenderedCollections } = require("./browser-feed");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const APP_ORIGIN = process.env.PUBLIC_ORIGIN || `http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`;
const DEV_HANDLES = new Set(["serofix", "lunathecoder_"]);
const TIKTOK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const REMOTE_MEDIA_HOST_PATTERNS = [
  /\.tiktok\.com$/i,
  /tiktokcdn/i,
  /ibytedtos/i,
  /byteoversea/i,
  /muscdn/i
];

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function sanitizeFilename(name, fallback = "download.bin") {
  const candidate = String(name || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return candidate || fallback;
}

function parseCount(value) {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
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

function firstUrl(...values) {
  for (const value of values.flat(Infinity)) {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      return value;
    }
  }

  return null;
}

function isProxyableRemoteMedia(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return false;
    }

    return REMOTE_MEDIA_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
  } catch (error) {
    return false;
  }
}

function buildMediaProxyUrl(rawUrl, options = {}) {
  if (!isProxyableRemoteMedia(rawUrl)) {
    return null;
  }

  const params = new URLSearchParams({
    url: rawUrl
  });

  if (options.download) {
    params.set("download", "1");
  }

  if (options.filename) {
    params.set("filename", sanitizeFilename(options.filename));
  }

  return `${APP_ORIGIN}/api/media?${params.toString()}`;
}

function buildVideoPageUrl(handle, itemId) {
  if (!handle || !itemId) {
    return null;
  }

  return `https://www.tiktok.com/@${handle}/video/${itemId}`;
}

function normalizeUsername(input) {
  const clean = String(input || "")
    .trim()
    .replace(/^@+/, "");

  if (!clean || !/^[A-Za-z0-9._-]{1,40}$/.test(clean)) {
    return "";
  }

  return clean;
}

function extractJsonScript(html, id) {
  const marker = `<script id="${id}" type="application/json">`;
  const start = html.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const contentStart = start + marker.length;
  const contentEnd = html.indexOf("</script>", contentStart);

  if (contentEnd === -1) {
    return null;
  }

  return html.slice(contentStart, contentEnd);
}

function findFirstMatch(node, matcher, visited = new WeakSet()) {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (visited.has(node)) {
    return null;
  }

  visited.add(node);

  if (matcher(node)) {
    return node;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const match = findFirstMatch(item, matcher, visited);
      if (match) {
        return match;
      }
    }

    return null;
  }

  for (const value of Object.values(node)) {
    const match = findFirstMatch(value, matcher, visited);
    if (match) {
      return match;
    }
  }

  return null;
}

function parseTikTokPayload(html) {
  const universalPayload = extractJsonScript(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  if (!universalPayload) {
    throw createHttpError(502, "Could not find the TikTok profile payload in the page.");
  }

  let parsed;
  try {
    parsed = JSON.parse(universalPayload);
  } catch (error) {
    throw createHttpError(502, "TikTok returned a profile payload that could not be parsed.");
  }

  const directMatch = parsed?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
  if (directMatch?.userInfo?.user?.uniqueId) {
    return directMatch;
  }

  const deepMatch = findFirstMatch(parsed, (candidate) => {
    return Boolean(candidate?.userInfo?.user?.uniqueId && candidate?.userInfo?.stats);
  });

  if (!deepMatch) {
    throw createHttpError(502, "Could not find a usable user-detail block in the TikTok payload.");
  }

  return deepMatch;
}

function pickCountryCode(user = {}) {
  const value = user.region || user.country || user.countryCode || null;

  if (typeof value === "string" && value.length >= 2 && value.length <= 3) {
    return value.toUpperCase();
  }

  return null;
}

function pickBioLink(user = {}) {
  if (typeof user.bioLink?.link === "string" && user.bioLink.link.trim()) {
    return user.bioLink.link.trim();
  }

  if (Array.isArray(user.bioLink?.links) && typeof user.bioLink.links[0]?.link === "string") {
    return user.bioLink.links[0].link.trim();
  }

  if (typeof user.profileBioLink === "string" && user.profileBioLink.trim()) {
    return user.profileBioLink.trim();
  }

  return null;
}

function countryNameFromCode(code) {
  if (!code) {
    return null;
  }

  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch (error) {
    return code;
  }
}

function formatUnixTimestamp(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function inferAccountType(user = {}) {
  if (typeof user.accountType === "string" && user.accountType.trim()) {
    return user.accountType.trim();
  }

  if (typeof user.categoryType === "string" && user.categoryType.trim()) {
    return user.categoryType.trim();
  }

  if (user.ttSeller) {
    return "Seller";
  }

  if (user.commerceUserInfo?.commerceUser) {
    return "Business";
  }

  if (user.isOrganization) {
    return "Organization";
  }

  return null;
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function pickLikes(stats = {}) {
  return (
    positiveNumber(stats.heart) ??
    positiveNumber(stats.heartCount) ??
    positiveNumber(stats.likesCount) ??
    null
  );
}

function extractMediaUrls(node, urls = new Set(), visited = new WeakSet()) {
  if (!node) {
    return urls;
  }

  if (typeof node === "string") {
    if (/^https?:\/\//i.test(node) && isProxyableRemoteMedia(node)) {
      urls.add(node);
    }

    return urls;
  }

  if (typeof node !== "object") {
    return urls;
  }

  if (visited.has(node)) {
    return urls;
  }

  visited.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      extractMediaUrls(item, urls, visited);
    }

    return urls;
  }

  for (const value of Object.values(node)) {
    extractMediaUrls(value, urls, visited);
  }

  return urls;
}

function pickPreviewUrl(item = {}) {
  return firstUrl(
    item.video?.cover,
    item.video?.dynamicCover,
    item.video?.originCover,
    item.video?.coverTsp,
    item.video?.coverThumb,
    item.imagePost?.cover,
    item.images?.[0]?.urlList,
    item.author?.avatarMedium,
    item.author?.avatarThumb,
    [...extractMediaUrls(item)]
  );
}

function pickDownloadUrl(item = {}) {
  return firstUrl(
    item.video?.downloadAddr,
    item.video?.downloadAddrV2,
    item.video?.playAddr,
    item.video?.playAddrH264,
    item.video?.PlayAddrStruct?.UrlList,
    item.video?.bitrateInfo?.flatMap((entry) => entry?.PlayAddr?.UrlList || []),
    [...extractMediaUrls(item)]
  );
}

function normalizeVideoLikeItem(item = {}) {
  const author = item.author || {};
  const previewOriginal = pickPreviewUrl(item);
  const downloadOriginal = pickDownloadUrl(item);
  const authorHandle = author.uniqueId || null;
  const authorName = author.nickname || authorHandle || "TikTok user";
  const itemId = item.id || null;

  return {
    id: itemId,
    authorHandle,
    authorName,
    createdAt: formatUnixTimestamp(item.createTime),
    description: item.desc || item.contents?.[0]?.desc || "",
    previewUrl: buildMediaProxyUrl(previewOriginal),
    previewOriginalUrl: previewOriginal,
    downloadFilename: sanitizeFilename(`${authorHandle || "tiktok"}-${itemId || "media"}.mp4`),
    downloadUrl: buildMediaProxyUrl(downloadOriginal, {
      download: true,
      filename: `${authorHandle || "tiktok"}-${itemId || "media"}.mp4`
    }),
    downloadOriginalUrl: downloadOriginal,
    itemUrl: buildVideoPageUrl(authorHandle, itemId),
    stats: {
      views: parseCount(item.stats?.playCount) ?? parseCount(item.statsV2?.playCount),
      likes: parseCount(item.stats?.diggCount) ?? parseCount(item.statsV2?.diggCount),
      comments: parseCount(item.stats?.commentCount) ?? parseCount(item.statsV2?.commentCount),
      shares: parseCount(item.stats?.shareCount) ?? parseCount(item.statsV2?.shareCount)
    }
  };
}

function normalizeStoryItem(item = {}, index = 0) {
  const author = item.author || item.user || {};
  const mediaUrls = [...extractMediaUrls(item)];
  const primaryMedia = firstUrl(
    item.video?.playAddr,
    item.video?.downloadAddr,
    mediaUrls
  );
  const previewOriginal = firstUrl(
    item.cover,
    item.poster,
    item.video?.cover,
    mediaUrls
  );

  return {
    id: item.id || item.storyId || `${author.uniqueId || "story"}-${index}`,
    authorHandle: author.uniqueId || null,
    authorName: author.nickname || author.uniqueId || "TikTok user",
    createdAt: formatUnixTimestamp(item.createTime || item.create_time),
    description: item.desc || item.title || "",
    previewUrl: buildMediaProxyUrl(previewOriginal || primaryMedia),
    previewOriginalUrl: previewOriginal || primaryMedia,
    downloadFilename: sanitizeFilename(`${author.uniqueId || "story"}-${item.id || index}.bin`),
    downloadUrl: buildMediaProxyUrl(primaryMedia, {
      download: true,
      filename: `${author.uniqueId || "story"}-${item.id || index}.bin`
    }),
    downloadOriginalUrl: primaryMedia,
    mediaCount: mediaUrls.length
  };
}

function sortCollectionItems(items = [], sort = "newest") {
  const sorted = [...items];

  sorted.sort((left, right) => {
    const leftCreated = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightCreated = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    const leftViews = left.stats?.views || 0;
    const rightViews = right.stats?.views || 0;

    if (sort === "oldest") {
      return leftCreated - rightCreated;
    }

    if (sort === "most-viewed") {
      return rightViews - leftViews || rightCreated - leftCreated;
    }

    return rightCreated - leftCreated;
  });

  return sorted;
}

async function fetchTikTokProfile(username) {
  const handle = normalizeUsername(username);
  if (!handle) {
    throw createHttpError(400, "Please provide a valid TikTok handle.");
  }

  const response = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}?lang=en`, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": TIKTOK_USER_AGENT
    }
  });

  if (!response.ok) {
    throw createHttpError(response.status === 404 ? 404 : 502, `TikTok returned ${response.status}.`);
  }

  const html = await response.text();
  const detail = parseTikTokPayload(html);

  if (detail?.statusCode && detail.statusCode !== 0) {
    throw createHttpError(404, detail.statusMsg || "TikTok account not found.");
  }

  const user = detail?.userInfo?.user;
  const stats = detail?.userInfo?.stats;

  if (!user?.uniqueId) {
    throw createHttpError(404, "TikTok account not found.");
  }

  const countryCode = pickCountryCode(user);
  const handleLower = user.uniqueId.toLowerCase();
  const isDev = DEV_HANDLES.has(handleLower);
  const profilePictureOriginal = user.avatarLarger || user.avatarMedium || user.avatarThumb || null;

  return {
    handle: user.uniqueId,
    username: user.nickname || user.uniqueId,
    userId: user.id || null,
    secUid: user.secUid || null,
    followers: positiveNumber(stats?.followerCount),
    following: positiveNumber(stats?.followingCount),
    likes: pickLikes(stats),
    videos: positiveNumber(stats?.videoCount),
    country: countryNameFromCode(countryCode),
    countryCode,
    rawRegion: user.region || null,
    accountType: inferAccountType(user),
    language: user.language || null,
    bio: user.signature || null,
    bioLink: pickBioLink(user),
    profilePicture: buildMediaProxyUrl(profilePictureOriginal) || profilePictureOriginal,
    profilePictureOriginal,
    verified: Boolean(user.verified),
    private: Boolean(user.privateAccount || user.secret),
    createdAt: formatUnixTimestamp(user.createTime),
    nicknameEditedAt: formatUnixTimestamp(user.nickNameModifyTime),
    usernameChangedAt: formatUnixTimestamp(user.uniqueIdModifyTime),
    storyStatus: positiveNumber(user.UserStoryStatus),
    followingVisibility: positiveNumber(user.followingVisibility),
    profileUrl: `https://www.tiktok.com/@${user.uniqueId}`,
    isDev,
    avatarDownloadEnabled: !isDev,
    source: "public TikTok profile page",
    fetchedAt: new Date().toISOString()
  };
}

async function resolveTikTokUrl(rawUrl) {
  const input = String(rawUrl || "").trim();

  if (!input) {
    throw createHttpError(400, "Please provide a TikTok URL.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(input);
  } catch (error) {
    throw createHttpError(400, "Please provide a valid URL.");
  }

  const allowedHosts = new Set([
    "tiktok.com",
    "www.tiktok.com",
    "m.tiktok.com",
    "vm.tiktok.com",
    "vt.tiktok.com"
  ]);

  if (!allowedHosts.has(parsedUrl.hostname.toLowerCase())) {
    throw createHttpError(400, "Only TikTok URLs are supported.");
  }

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": TIKTOK_USER_AGENT
    }
  });

  if (!response.ok) {
    throw createHttpError(502, `TikTok URL resolve failed with ${response.status}.`);
  }

  const finalUrl = new URL(response.url);
  const match = finalUrl.pathname.match(/@([A-Za-z0-9._-]{1,40})/);
  const handle = match?.[1] || null;

  return {
    inputUrl: parsedUrl.toString(),
    resolvedUrl: response.url,
    handle,
    profileUrl: handle ? `https://www.tiktok.com/@${handle}` : null
  };
}

async function fetchTikTokRenderedData(username) {
  const profile = await fetchTikTokProfile(username);
  const rendered = await fetchRenderedCollections(profile.profileUrl, TIKTOK_USER_AGENT);

  const rawStories = rendered.stories || {};
  const rawReposts = rendered.reposts || {};
  const rawVideos = rendered.posts || {};

  const stories = Array.isArray(rawStories.itemList)
    ? rawStories.itemList.map((item, index) => normalizeStoryItem(item, index))
    : [];

  const reposts = Array.isArray(rawReposts.itemList)
    ? rawReposts.itemList.map((item) => normalizeVideoLikeItem(item))
    : [];

  const videos = Array.isArray(rawVideos.itemList)
    ? rawVideos.itemList.map((item) => normalizeVideoLikeItem(item))
    : [];

  return {
    profile,
    stories: {
      available: stories.length > 0,
      count: stories.length,
      totalCount: parseCount(rawStories.TotalCount),
      items: stories,
      message: stories.length
        ? "Public stories were captured from a rendered browser session."
        : "No downloadable public stories were exposed in the rendered TikTok session.",
      source: "rendered browser session"
    },
    reposts: {
      available: reposts.length > 0,
      count: reposts.length,
      hasMore: Boolean(rawReposts.hasMore),
      items: sortCollectionItems(reposts, "newest"),
      message: reposts.length
        ? "Public reposts were captured from a rendered browser session."
        : "No public repost items were exposed in the rendered TikTok session.",
      source: "rendered browser session"
    },
    videos: {
      available: videos.length > 0,
      count: videos.length,
      items: sortCollectionItems(videos, "newest"),
      message: videos.length
        ? "Public profile videos were captured from a rendered browser session."
        : "TikTok did not expose the public profile video grid to the local rendered browser session.",
      source: "rendered browser session"
    }
  };
}

async function streamRemoteMedia(response, rawUrl, options = {}) {
  if (!isProxyableRemoteMedia(rawUrl)) {
    throw createHttpError(400, "That media URL is not allowed.");
  }

  const remoteResponse = await fetch(rawUrl, {
    headers: {
      "user-agent": TIKTOK_USER_AGENT
    }
  });

  if (!remoteResponse.ok) {
    throw createHttpError(502, `Could not fetch remote media (${remoteResponse.status}).`);
  }

  const payload = Buffer.from(await remoteResponse.arrayBuffer());
  const contentType = remoteResponse.headers.get("content-type") || "application/octet-stream";

  setCorsHeaders(response);

  const headers = {
    "cache-control": "no-store",
    "content-type": contentType
  };

  if (options.download) {
    headers["content-disposition"] = `attachment; filename="${sanitizeFilename(options.filename, "download.bin")}"`;
  }

  response.writeHead(200, headers);
  response.end(payload);
}

async function streamAvatar(response, username) {
  const profile = await fetchTikTokProfile(username);

  if (!profile.avatarDownloadEnabled) {
    throw createHttpError(403, "Avatar download is disabled for this profile.");
  }

  const profilePictureOriginal = profile.profilePictureOriginal || profile.profilePicture;

  if (!profilePictureOriginal) {
    throw createHttpError(404, "No public avatar found for that account.");
  }

  const avatarResponse = await fetch(profilePictureOriginal, {
    headers: {
      "user-agent": TIKTOK_USER_AGENT
    }
  });

  if (!avatarResponse.ok) {
    throw createHttpError(502, "Could not download the avatar image.");
  }

  const avatarBuffer = Buffer.from(await avatarResponse.arrayBuffer());
  const contentType = avatarResponse.headers.get("content-type") || "image/jpeg";
  const extension = contentType.includes("png") ? "png" : "jpg";

  setCorsHeaders(response);
  response.writeHead(200, {
    "content-type": contentType,
    "content-disposition": `attachment; filename="${profile.handle}-avatar.${extension}"`,
    "cache-control": "no-store"
  });
  response.end(avatarBuffer);
}

function resolveFilePath(urlPathname) {
  const requestedPath = urlPathname === "/" ? "index.html" : decodeURIComponent(urlPathname.slice(1));
  const safePath = path.normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(ROOT, safePath);
}

async function serveStatic(response, pathname) {
  const filePath = resolveFilePath(pathname);

  if (!filePath.startsWith(ROOT)) {
    throw createHttpError(403, "Forbidden.");
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || "application/octet-stream";
  const content = await fs.promises.readFile(filePath);

  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  response.end(content);
}

function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    try {
      if (request.method === "OPTIONS") {
        setCorsHeaders(response);
        response.writeHead(204);
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/profile") {
        const payload = await fetchTikTokProfile(url.searchParams.get("username"));
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/resolve-url") {
        const payload = await resolveTikTokUrl(url.searchParams.get("url"));
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/stories") {
        const payload = await fetchTikTokRenderedData(url.searchParams.get("username"));
        sendJson(response, 200, payload.stories);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/reposts") {
        const payload = await fetchTikTokRenderedData(url.searchParams.get("username"));
        sendJson(response, 200, payload.reposts);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/videos") {
        const payload = await fetchTikTokRenderedData(url.searchParams.get("username"));
        sendJson(response, 200, payload.videos);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/avatar") {
        await streamAvatar(response, url.searchParams.get("username"));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/media") {
        await streamRemoteMedia(response, url.searchParams.get("url"), {
          download: url.searchParams.get("download") === "1",
          filename: url.searchParams.get("filename")
        });
        return;
      }

      if (request.method !== "GET") {
        throw createHttpError(405, "Method not allowed.");
      }

      await serveStatic(response, url.pathname);
    } catch (error) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(response, error.status || 500, {
          error: error.message || "Unexpected server error."
        });
        return;
      }

      if (error.code === "ENOENT") {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      response.writeHead(error.status || 500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.message || "Unexpected server error.");
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`serofix-thing running at http://${HOST}:${PORT}`);
  });
}

module.exports = {
  createServer,
  fetchTikTokProfile,
  fetchTikTokRenderedData,
  resolveTikTokUrl
};
