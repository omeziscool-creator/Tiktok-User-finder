const THEME_KEY = "serofix-theme";
const FAVORITES_KEY = "serofix-favorites";
const RECENT_KEY = "serofix-recent";
const USES_LOCAL_API_BRIDGE =
  !["127.0.0.1:3000", "localhost:3000"].includes(window.location.host);
const API_BASE = USES_LOCAL_API_BRIDGE ? "http://127.0.0.1:3000" : "";

const form = document.querySelector("#lookup-form");
const input = document.querySelector("#username");
const lookupButton = document.querySelector("#lookup-button");
const urlForm = document.querySelector("#url-form");
const urlInput = document.querySelector("#profile-url-input");
const urlButton = document.querySelector("#url-button");
const statusMessage = document.querySelector("#lookup-status");
const urlStatus = document.querySelector("#url-status");
const responsePreview = document.querySelector("#response-preview");
const downloadResponseButton = document.querySelector("#download-response");
const copyButton = document.querySelector("#copy-response");
const pasteButton = document.querySelector("#paste-button");
const openRecentButton = document.querySelector("#open-recent-button");
const endpointCode = document.querySelector("#endpoint-code");
const profileImage = document.querySelector("#profile-image");
const profileAvatar = document.querySelector("#profile-avatar");
const favoriteToggle = document.querySelector("#favorite-toggle");
const viewProfileLink = document.querySelector("#view-profile-link");
const downloadAvatarLink = document.querySelector("#download-avatar-link");
const profileUrlDisplay = document.querySelector("#profile-url-display");
const bioLinkDisplay = document.querySelector("#bio-link-display");
const favoritesList = document.querySelector("#favorites-list");
const recentList = document.querySelector("#recent-list");
const toolConsole = document.querySelector("#tool-console");
const devBadge = document.querySelector("#dev-badge");
const imageModal = document.querySelector("#image-modal");
const imageModalContent = document.querySelector("#image-modal-content");
const imageModalClose = document.querySelector("#image-modal-close");
const infoModal = document.querySelector("#info-modal");
const infoModalTitle = document.querySelector("#info-modal-title");
const infoModalContent = document.querySelector("#info-modal-content");
const infoModalClose = document.querySelector("#info-modal-close");

const profileFields = {
  name: document.querySelector("#profile-name"),
  handle: document.querySelector("#profile-handle"),
  username: document.querySelector("#profile-username"),
  userId: document.querySelector("#profile-user-id"),
  country: document.querySelector("#profile-country"),
  accountType: document.querySelector("#profile-account-type"),
  language: document.querySelector("#profile-language"),
  private: document.querySelector("#profile-private"),
  created: document.querySelector("#profile-created"),
  nicknameEdited: document.querySelector("#profile-nickname-edited"),
  usernameChanged: document.querySelector("#profile-username-changed"),
  stories: document.querySelector("#profile-stories"),
  lastSearched: document.querySelector("#profile-last-searched"),
  bio: document.querySelector("#profile-bio"),
  followers: document.querySelector("#stat-followers"),
  following: document.querySelector("#stat-following"),
  likes: document.querySelector("#stat-likes"),
  videos: document.querySelector("#stat-videos"),
  verified: document.querySelector("#verified-badge")
};

let currentProfile = null;
let collectionCache = {
  reposts: null,
  stories: null,
  videos: null
};

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function maybeProxyMediaUrl(url) {
  if (!url) {
    return "";
  }

  if (url.startsWith(`${API_BASE || "http://127.0.0.1:3000"}/api/media?`)) {
    return url;
  }

  try {
    const parsed = new URL(url, window.location.href);
    if (
      /^https?:$/i.test(parsed.protocol) &&
      /tiktokcdn|tiktok\.com$|ibytedtos|byteoversea|muscdn/i.test(parsed.hostname)
    ) {
      return apiUrl(`/api/media?url=${encodeURIComponent(url)}`);
    }
  } catch (error) {
    return url;
  }

  return url;
}

function resetCollectionCache() {
  collectionCache = {
    reposts: null,
    stories: null,
    videos: null
  };
}

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch (error) {
    return [];
  }
}

function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function textOrFallback(value, fallback = "Not public") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return value;
}

function formatCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Not public";
  }

  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatDateTime(value, fallback = "N/A") {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date).replace(",", "");
}

function openInfoModal(title, message) {
  infoModalTitle.textContent = title;
  infoModalContent.innerHTML = "";
  infoModalContent.textContent = message;
  infoModal.hidden = false;
}

function openInfoModalNode(title, node) {
  infoModalTitle.textContent = title;
  infoModalContent.innerHTML = "";
  infoModalContent.replaceChildren(node);
  infoModal.hidden = false;
}

function closeInfoModal() {
  infoModal.hidden = true;
}

function openImageModal(src, alt) {
  if (!src) {
    return;
  }

  imageModalContent.src = src;
  imageModalContent.alt = alt || "Expanded profile image";
  imageModal.hidden = false;
}

function closeImageModal() {
  imageModal.hidden = true;
  imageModalContent.src = "";
}

function showToolResult(title, message) {
  setToolConsole(`${title}\n${message}`);
  openInfoModal(title, message);
}

function hasActiveProfile(title) {
  if (currentProfile) {
    return true;
  }

  showToolResult(title, "Run a lookup first.");
  return false;
}

function downloadTextFile(filename, content, contentType) {
  const blob = new Blob([content], { type: contentType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function avatarText(name) {
  return (name || "TT")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "TT";
}

function formatFullCount(value, fallback = "Not public") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return new Intl.NumberFormat("en").format(value);
}

function formatShortDate(value, fallback = "Unknown time") {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function sortCollectionItems(items, sort = "newest") {
  const sorted = [...items];

  sorted.sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    const leftViews = left.stats?.views || 0;
    const rightViews = right.stats?.views || 0;

    if (sort === "oldest") {
      return leftTime - rightTime;
    }

    if (sort === "most-viewed") {
      return rightViews - leftViews || rightTime - leftTime;
    }

    return rightTime - leftTime;
  });

  return sorted;
}

function storyStatusText(profile) {
  if (typeof profile.storyStatus === "number" && profile.storyStatus > 0) {
    return "Public story signal detected";
  }

  return "No public story signal";
}

function setStatus(message, type = "neutral") {
  statusMessage.textContent = message;
  statusMessage.classList.remove("success", "error");

  if (type !== "neutral") {
    statusMessage.classList.add(type);
  }
}

function setUrlStatus(message, type = "neutral") {
  urlStatus.textContent = message;
  urlStatus.classList.remove("success", "error");

  if (type !== "neutral") {
    urlStatus.classList.add(type);
  }
}

function setLoading(isLoading) {
  lookupButton.disabled = isLoading;
  lookupButton.textContent = isLoading ? "Looking up..." : "Lookup account";
}

function setUrlLoading(isLoading) {
  urlButton.disabled = isLoading;
  urlButton.textContent = isLoading ? "Resolving..." : "Resolve URL";
}

function setToolConsole(message) {
  toolConsole.textContent = message;
}

function triggerDownload(url, filename) {
  if (!url) {
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function queueDownloads(items) {
  const downloadables = items.filter((item) => item.downloadUrl);
  if (!downloadables.length) {
    setStatus("No downloadable media was exposed for this list.", "error");
    return;
  }

  downloadables.forEach((item, index) => {
    window.setTimeout(() => {
      triggerDownload(item.downloadUrl, item.downloadFilename || "");
    }, index * 350);
  });

  setStatus(`Started ${downloadables.length} download${downloadables.length === 1 ? "" : "s"}.`, "success");
}

function createCollectionCard(item) {
  const card = document.createElement("article");
  card.className = "tool-feed-card";

  const previewUrl = maybeProxyMediaUrl(item.previewUrl || item.previewOriginalUrl);
  let previewElement;

  if (previewUrl) {
    previewElement = document.createElement("img");
    previewElement.className = "tool-feed-thumb";
    previewElement.src = previewUrl;
    previewElement.alt = item.authorName || item.authorHandle || "TikTok media";
    previewElement.addEventListener("click", () => {
      openImageModal(previewUrl, previewElement.alt);
    });
  } else {
    previewElement = document.createElement("div");
    previewElement.className = "tool-feed-thumb-fallback";
    previewElement.textContent = avatarText(item.authorName || item.authorHandle || "TT");
  }

  const body = document.createElement("div");
  body.className = "tool-feed-body";

  const title = document.createElement("h4");
  title.textContent = item.authorHandle
    ? `@${item.authorHandle}`
    : item.authorName || item.id || "TikTok item";

  const meta = document.createElement("div");
  meta.className = "tool-feed-meta";

  const created = document.createElement("span");
  created.textContent = formatShortDate(item.createdAt);
  meta.appendChild(created);

  if (typeof item.stats?.views === "number") {
    const views = document.createElement("span");
    views.textContent = `${formatFullCount(item.stats.views)} views`;
    meta.appendChild(views);
  }

  if (typeof item.stats?.likes === "number") {
    const likes = document.createElement("span");
    likes.textContent = `${formatFullCount(item.stats.likes)} likes`;
    meta.appendChild(likes);
  }

  if (typeof item.mediaCount === "number" && item.mediaCount > 1) {
    const mediaCount = document.createElement("span");
    mediaCount.textContent = `${item.mediaCount} files`;
    meta.appendChild(mediaCount);
  }

  const description = document.createElement("p");
  description.className = "tool-feed-desc";
  description.textContent = item.description || "No public caption provided.";

  const actions = document.createElement("div");
  actions.className = "tool-feed-item-actions";

  if (item.itemUrl) {
    const openLink = document.createElement("a");
    openLink.className = "button button-light compact";
    openLink.href = item.itemUrl;
    openLink.target = "_blank";
    openLink.rel = "noreferrer";
    openLink.textContent = "Open";
    actions.appendChild(openLink);
  }

  if (item.downloadUrl) {
    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "button button-dark compact";
    downloadButton.textContent = "Download";
    downloadButton.addEventListener("click", () => {
      triggerDownload(item.downloadUrl, item.downloadFilename || "");
    });
    actions.appendChild(downloadButton);
  }

  body.append(title, meta, description, actions);
  card.append(previewElement, body);
  return card;
}

function renderCollectionModal(kind, sort = "newest") {
  const payload = collectionCache[kind];
  if (!payload) {
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "tool-feed-shell";

  const summary = document.createElement("div");
  summary.className = "tool-feed-summary";

  const countText = typeof payload.count === "number"
    ? `${formatFullCount(payload.count, "0")} item${payload.count === 1 ? "" : "s"}`
    : "No items";

  summary.textContent = payload.message
    ? `${countText}. ${payload.message}`
    : `${countText}.`;

  const topActions = document.createElement("div");
  topActions.className = "tool-feed-actions";

  if (payload.items?.some((item) => item.downloadUrl)) {
    const downloadAllButton = document.createElement("button");
    downloadAllButton.type = "button";
    downloadAllButton.className = "button button-light compact";
    downloadAllButton.textContent = "Download All";
    downloadAllButton.addEventListener("click", () => {
      queueDownloads(payload.items);
    });
    topActions.appendChild(downloadAllButton);
  }

  if (kind === "videos") {
    const sortBar = document.createElement("div");
    sortBar.className = "tool-sortbar";

    [
      ["newest", "Newest"],
      ["oldest", "Oldest"],
      ["most-viewed", "Most Viewed"]
    ].forEach(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `button compact ${value === sort ? "button-dark" : "button-light"}`;
      button.textContent = label;
      button.addEventListener("click", () => {
        renderCollectionModal(kind, value);
      });
      sortBar.appendChild(button);
    });

    wrapper.append(sortBar);
  }

  wrapper.append(summary);

  if (topActions.childNodes.length) {
    wrapper.append(topActions);
  }

  const list = document.createElement("div");
  list.className = "tool-feed-list";

  const sortedItems = sortCollectionItems(payload.items || [], sort);
  if (!sortedItems.length) {
    const empty = document.createElement("div");
    empty.className = "tool-feed-empty";
    empty.textContent = payload.message || "No public items were exposed for this feed.";
    list.appendChild(empty);
  } else {
    sortedItems.forEach((item) => {
      list.appendChild(createCollectionCard(item));
    });
  }

  wrapper.append(list);
  openInfoModalNode(payload.title, wrapper);
}

async function loadCollection(kind, title, endpoint, statusLabel) {
  if (!hasActiveProfile(title)) {
    return;
  }

  setToolConsole(`${title}\nLoading ${statusLabel}...`);
  openInfoModal(title, `Loading ${statusLabel}...`);

  try {
    const payload = await fetchJson(`${endpoint}?username=${encodeURIComponent(currentProfile.handle)}`);
    collectionCache[kind] = {
      ...payload,
      title
    };
    renderCollectionModal(kind);
    setToolConsole(`${title}\n${payload.message || `Loaded ${payload.count || 0} item(s).`}`);
  } catch (error) {
    showToolResult(title, error.message);
  }
}

function createSavedItem(item, kind) {
  const wrapper = document.createElement("div");
  wrapper.className = "saved-item";
  wrapper.dataset.handle = item.handle;
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute("aria-label", `Load @${item.handle}`);

  const avatar = item.profilePicture
    ? document.createElement("img")
    : document.createElement("div");

  avatar.className = item.profilePicture
    ? "saved-item-avatar"
    : "saved-item-avatar saved-item-fallback";

  if (item.profilePicture) {
    avatar.src = maybeProxyMediaUrl(item.profilePicture);
    avatar.alt = `${item.username || item.handle} avatar`;
  } else {
    avatar.textContent = avatarText(item.username || item.handle);
  }

  const copy = document.createElement("div");
  copy.className = "saved-item-copy";

  const title = document.createElement("strong");
  title.textContent = item.username || item.handle;

  const subtitle = document.createElement("span");
  subtitle.textContent = `@${item.handle}`;

  const searched = document.createElement("span");
  searched.textContent = `Last searched: ${formatDateTime(item.lastSearchedAt, "Never")}`;

  copy.append(title, subtitle, searched);

  const actions = document.createElement("div");
  actions.className = "saved-item-actions";

  const loadButton = document.createElement("button");
  loadButton.type = "button";
  loadButton.className = "button button-light compact";
  loadButton.textContent = "Load";
  loadButton.dataset.handle = item.handle;
  loadButton.dataset.action = "load";

  const openLink = document.createElement("a");
  openLink.className = "button button-light compact";
  openLink.textContent = "TikTok";
  openLink.href = item.profileUrl || `https://www.tiktok.com/@${item.handle}`;
  openLink.target = "_blank";
  openLink.rel = "noreferrer";

  actions.append(loadButton, openLink);

  if (kind === "favorites") {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "button button-light compact";
    removeButton.textContent = "Remove";
    removeButton.dataset.handle = item.handle;
    removeButton.dataset.action = "remove-favorite";
    actions.append(removeButton);
  }

  wrapper.append(avatar, copy, actions);
  return wrapper;
}

function renderSavedList(container, items, emptyMessage, kind) {
  container.innerHTML = "";

  if (!items.length) {
    container.className = "saved-list empty-state";
    container.textContent = emptyMessage;
    return;
  }

  container.className = "saved-list";
  items.forEach((item) => {
    container.appendChild(createSavedItem(item, kind));
  });
}

function syncSavedLists() {
  renderSavedList(
    favoritesList,
    readStore(FAVORITES_KEY),
    "No favorites yet.",
    "favorites"
  );
  renderSavedList(
    recentList,
    readStore(RECENT_KEY),
    "No recent lookups yet.",
    "recent"
  );
}

function saveRecent(profile) {
  const recent = readStore(RECENT_KEY).filter((item) => item.handle !== profile.handle);
  recent.unshift({
    handle: profile.handle,
    username: profile.username,
    profilePicture: profile.profilePicture,
    verified: profile.verified,
    profileUrl: profile.profileUrl,
    lastSearchedAt: profile.lastSearchedAt
  });

  writeStore(RECENT_KEY, recent.slice(0, 8));
  syncSavedLists();
}

function isFavorite(handle) {
  return readStore(FAVORITES_KEY).some((item) => item.handle === handle);
}

function updateFavoriteButton() {
  if (!currentProfile) {
    favoriteToggle.textContent = "Add Favorite";
    return;
  }

  favoriteToggle.textContent = isFavorite(currentProfile.handle)
    ? "Remove Favorite"
    : "Add Favorite";
}

function toggleFavorite() {
  if (!currentProfile) {
    return;
  }

  const favorites = readStore(FAVORITES_KEY);
  const exists = favorites.some((item) => item.handle === currentProfile.handle);

  if (exists) {
    writeStore(
      FAVORITES_KEY,
      favorites.filter((item) => item.handle !== currentProfile.handle)
    );
    setStatus(`Removed @${currentProfile.handle} from favorites.`, "success");
  } else {
    favorites.unshift({
      handle: currentProfile.handle,
      username: currentProfile.username,
      profilePicture: currentProfile.profilePicture,
      verified: currentProfile.verified,
      profileUrl: currentProfile.profileUrl,
      lastSearchedAt: currentProfile.lastSearchedAt
    });
    writeStore(
      FAVORITES_KEY,
      favorites.filter(
        (item, index, list) =>
          list.findIndex((candidate) => candidate.handle === item.handle) === index
      ).slice(0, 20)
    );
    setStatus(`Saved @${currentProfile.handle} to favorites.`, "success");
  }

  updateFavoriteButton();
  syncSavedLists();
}

async function fetchJson(path) {
  try {
    const response = await fetch(apiUrl(path));
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    return payload;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("The server returned an invalid response.");
    }

    if (error.message === "Failed to fetch" || error instanceof TypeError) {
      if (USES_LOCAL_API_BRIDGE) {
        throw new Error("Could not reach http://127.0.0.1:3000. Start the app with node server.js and keep it running.");
      }

      throw new Error("Could not reach the local server.");
    }

    throw error;
  }
}

function renderProfile(profile) {
  currentProfile = {
    ...profile,
    lastSearchedAt: profile.lastSearchedAt || new Date().toISOString()
  };
  resetCollectionCache();

  profileFields.name.textContent = textOrFallback(currentProfile.username, "Unknown account");
  profileFields.handle.textContent = `@${currentProfile.handle || "unknown"}`;
  profileFields.username.textContent = textOrFallback(currentProfile.username, "N/A");
  profileFields.userId.textContent = textOrFallback(currentProfile.userId, "N/A");
  profileFields.country.textContent = textOrFallback(
    currentProfile.country || currentProfile.rawRegion,
    "Unavailable from public TikTok data"
  );
  profileFields.accountType.textContent = textOrFallback(currentProfile.accountType, "Not public");
  profileFields.language.textContent = textOrFallback(currentProfile.language, "Not public");
  profileFields.private.textContent = currentProfile.private ? "Yes" : "No";
  profileFields.created.textContent = formatDateTime(currentProfile.createdAt, "Not public");
  profileFields.nicknameEdited.textContent = formatDateTime(currentProfile.nicknameEditedAt, "Not public");
  profileFields.usernameChanged.textContent = formatDateTime(
    currentProfile.usernameChangedAt,
    "Unavailable from public TikTok data"
  );
  profileFields.stories.textContent = storyStatusText(currentProfile);
  profileFields.lastSearched.textContent = formatDateTime(currentProfile.lastSearchedAt, "Just now");
  profileFields.bio.textContent = textOrFallback(currentProfile.bio, "No public bio.");

  profileFields.followers.textContent = formatCount(currentProfile.followers);
  profileFields.following.textContent = formatCount(currentProfile.following);
  profileFields.likes.textContent = formatCount(currentProfile.likes);
  profileFields.videos.textContent = formatCount(currentProfile.videos);
  profileFields.verified.hidden = !currentProfile.verified;
  devBadge.hidden = !currentProfile.isDev;

  profileAvatar.textContent = avatarText(currentProfile.username || currentProfile.handle);

  if (currentProfile.profilePicture) {
    profileImage.src = maybeProxyMediaUrl(currentProfile.profilePicture);
    profileImage.alt = `${currentProfile.username || currentProfile.handle} profile picture`;
    profileImage.title = "Open full image";
    profileImage.setAttribute("aria-label", `Open ${currentProfile.username || currentProfile.handle} profile image`);
    profileImage.hidden = false;
    profileAvatar.hidden = true;
  } else {
    profileImage.hidden = true;
    profileImage.title = "";
    profileImage.removeAttribute("aria-label");
    profileAvatar.hidden = false;
  }

  viewProfileLink.href = currentProfile.profileUrl || `https://www.tiktok.com/@${currentProfile.handle}`;
  profileUrlDisplay.href = viewProfileLink.href;
  profileUrlDisplay.textContent = `Open @${currentProfile.handle} on TikTok`;

  if (currentProfile.bioLink) {
    bioLinkDisplay.href = currentProfile.bioLink;
    bioLinkDisplay.textContent = "Open bio link";
    bioLinkDisplay.hidden = false;
  } else {
    bioLinkDisplay.href = "#";
    bioLinkDisplay.textContent = "Open bio link";
    bioLinkDisplay.hidden = true;
  }

  if (currentProfile.avatarDownloadEnabled && currentProfile.profilePicture) {
    downloadAvatarLink.href = apiUrl(`/api/avatar?username=${encodeURIComponent(currentProfile.handle)}`);
    downloadAvatarLink.setAttribute("download", `${currentProfile.handle}-avatar.jpg`);
    downloadAvatarLink.hidden = false;
  } else {
    downloadAvatarLink.href = "#";
    downloadAvatarLink.hidden = true;
  }

  responsePreview.textContent = JSON.stringify(currentProfile, null, 2);
  downloadResponseButton.disabled = false;
  endpointCode.textContent = `GET ${apiUrl(`/api/profile?username=${currentProfile.handle}`)}
GET ${apiUrl(`/api/resolve-url?url=https://www.tiktok.com/@${currentProfile.handle}`)}
GET ${apiUrl(`/api/avatar?username=${currentProfile.handle}`)}
GET ${apiUrl(`/api/stories?username=${currentProfile.handle}`)}
GET ${apiUrl(`/api/reposts?username=${currentProfile.handle}`)}
GET ${apiUrl(`/api/videos?username=${currentProfile.handle}`)}`;

  updateFavoriteButton();
  saveRecent(currentProfile);
  renderAnalysis(currentProfile);
}

function renderError(message) {
  currentProfile = null;
  resetCollectionCache();
  profileImage.src = "";
  profileImage.hidden = true;
  profileImage.title = "";
  profileImage.removeAttribute("aria-label");
  profileAvatar.hidden = false;
  profileAvatar.textContent = "TT";

  profileFields.name.textContent = "Lookup failed";
  profileFields.handle.textContent = "@unknown";
  profileFields.username.textContent = "-";
  profileFields.userId.textContent = "-";
  profileFields.country.textContent = "-";
  profileFields.accountType.textContent = "-";
  profileFields.language.textContent = "-";
  profileFields.private.textContent = "-";
  profileFields.created.textContent = "-";
  profileFields.nicknameEdited.textContent = "-";
  profileFields.usernameChanged.textContent = "-";
  profileFields.stories.textContent = "-";
  profileFields.lastSearched.textContent = "-";
  profileFields.bio.textContent = message;
  profileFields.followers.textContent = "-";
  profileFields.following.textContent = "-";
  profileFields.likes.textContent = "-";
  profileFields.videos.textContent = "-";
  profileFields.verified.hidden = true;
  devBadge.hidden = true;

  viewProfileLink.href = "https://www.tiktok.com";
  profileUrlDisplay.href = "https://www.tiktok.com";
  profileUrlDisplay.textContent = "Open profile page";
  bioLinkDisplay.href = "#";
  bioLinkDisplay.textContent = "Open bio link";
  bioLinkDisplay.hidden = true;
  downloadAvatarLink.href = "#";
  downloadAvatarLink.hidden = true;
  downloadResponseButton.disabled = true;
  favoriteToggle.textContent = "Add Favorite";
  responsePreview.textContent = JSON.stringify({ error: message }, null, 2);
  setToolConsole(message);
}

async function lookupProfile(username) {
  const cleanUsername = String(username || "").trim().replace(/^@+/, "");

  if (!cleanUsername) {
    setStatus("Enter a TikTok handle to search.", "error");
    return;
  }

  setLoading(true);
  setStatus(`Looking up @${cleanUsername}...`);

  try {
    const payload = await fetchJson(`/api/profile?username=${encodeURIComponent(cleanUsername)}`);
    payload.lastSearchedAt = new Date().toISOString();
    renderProfile(payload);
    setStatus(`Loaded @${payload.handle} from the public TikTok profile page.`, "success");
  } catch (error) {
    renderError(error.message);
    setStatus(error.message, "error");
  } finally {
    setLoading(false);
  }
}

async function resolveUrl(value) {
  const inputValue = String(value || "").trim();

  if (!inputValue) {
    setUrlStatus("Paste a TikTok URL first.", "error");
    return;
  }

  setUrlLoading(true);
  setUrlStatus("Resolving TikTok URL...");

  try {
    const payload = await fetchJson(`/api/resolve-url?url=${encodeURIComponent(inputValue)}`);

    if (!payload.handle) {
      throw new Error("Could not extract a TikTok handle from that URL.");
    }

    input.value = payload.handle;
    setUrlStatus(`Resolved ${payload.resolvedUrl} to @${payload.handle}.`, "success");
    await lookupProfile(payload.handle);
  } catch (error) {
    setUrlStatus(error.message, "error");
  } finally {
    setUrlLoading(false);
  }
}

function renderAnalysis(profile) {
  const lines = [
    `User Lookup: @${profile.handle}`,
    `User ID: ${textOrFallback(profile.userId, "N/A")}`,
    `Private: ${profile.private ? "Yes" : "No"}`,
    `Created: ${formatDateTime(profile.createdAt, "Unavailable from public TikTok data")}`,
    `Nickname Edited At: ${formatDateTime(profile.nicknameEditedAt, "Unavailable from public TikTok data")}`,
    `Username Changed At: ${formatDateTime(profile.usernameChangedAt, "Unavailable from public TikTok data")}`,
    `Last Searched: ${formatDateTime(profile.lastSearchedAt, "Just now")}`,
    `Videos: ${formatCount(profile.videos)}`,
    `View Stories: ${storyStatusText(profile)}. The Stories button now checks the rendered public story feed TikTok requests in the browser session.`,
    "View Videos: The button attempts to load the rendered public video feed. If TikTok withholds it from the local browser session, the modal now says so clearly instead of failing silently.",
    `Show Following: ${
      profile.followingVisibility === 1
        ? "Profile may expose following visibility on TikTok, but the full list is not included in this public payload or as a downloadable JSON export."
        : "Following list is not exposed in this public payload."
    }`,
    "Show Followers: Follower lists are not included in the public profile payload used by this build, so there is no real JSON export to generate.",
    "Reposts Viewer: The button now checks the rendered public repost feed TikTok requests in the browser session.",
    `Download Avatar: ${
      profile.avatarDownloadEnabled && profile.profilePicture
        ? "Available"
        : profile.isDev
          ? "Disabled for this profile"
          : "No public avatar URL found"
    }`,
    `Full Analysis: Country=${textOrFallback(profile.country || profile.rawRegion, "Unavailable from public TikTok data")}, Account Type=${textOrFallback(profile.accountType, "Not public")}, Language=${textOrFallback(profile.language, "Not public")}`,
    `Source: ${profile.source}`,
    profile.isDev ? "Profile Tag: DEV" : "Profile Tag: None"
  ];

  setToolConsole(lines.join("\n"));
}

function applyTheme(theme) {
  const nextTheme = ["light", "amber", "dark"].includes(theme) ? theme : "amber";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(THEME_KEY, nextTheme);

  document.querySelectorAll(".theme-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.theme === nextTheme);
  });
}

function handleSavedListClick(event, storeKey) {
  if (event.target.closest("a[href]")) {
    return;
  }

  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    const itemTarget = event.target.closest(".saved-item[data-handle]");
    if (!itemTarget?.dataset.handle) {
      return;
    }

    input.value = itemTarget.dataset.handle;
    lookupProfile(itemTarget.dataset.handle);
    return;
  }

  const { action, handle } = actionTarget.dataset;
  if (!handle) {
    return;
  }

  if (action === "load") {
    input.value = handle;
    lookupProfile(handle);
    return;
  }

  if (action === "remove-favorite" && storeKey === FAVORITES_KEY) {
    writeStore(
      FAVORITES_KEY,
      readStore(FAVORITES_KEY).filter((item) => item.handle !== handle)
    );
    syncSavedLists();
    updateFavoriteButton();
  }
}

function handleSavedListKeydown(event) {
  const itemTarget = event.target.closest(".saved-item[data-handle]");
  if (!itemTarget?.dataset.handle) {
    return;
  }

  if (event.target !== itemTarget) {
    return;
  }

  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  input.value = itemTarget.dataset.handle;
  lookupProfile(itemTarget.dataset.handle);
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  lookupProfile(input.value);
});

urlForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  resolveUrl(urlInput.value);
});

document.querySelectorAll(".preset").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.username || "";
    lookupProfile(input.value);
  });
});

document.querySelectorAll(".theme-option").forEach((button) => {
  button.addEventListener("click", () => {
    applyTheme(button.dataset.theme || "amber");
  });
});

favoriteToggle?.addEventListener("click", () => {
  toggleFavorite();
});

document.querySelector("#clear-favorites")?.addEventListener("click", () => {
  writeStore(FAVORITES_KEY, []);
  syncSavedLists();
  updateFavoriteButton();
});

document.querySelector("#clear-recent")?.addEventListener("click", () => {
  writeStore(RECENT_KEY, []);
  syncSavedLists();
});

favoritesList?.addEventListener("click", (event) => {
  handleSavedListClick(event, FAVORITES_KEY);
});

recentList?.addEventListener("click", (event) => {
  handleSavedListClick(event, RECENT_KEY);
});

favoritesList?.addEventListener("keydown", handleSavedListKeydown);
recentList?.addEventListener("keydown", handleSavedListKeydown);

pasteButton?.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    input.value = text.trim();
    setStatus("Pasted from clipboard.", "success");
  } catch (error) {
    setStatus("Clipboard paste was blocked by the browser.", "error");
  }
});

openRecentButton?.addEventListener("click", () => {
  document.querySelector("#favorites")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelector("#view-stories-button")?.addEventListener("click", async () => {
  await loadCollection("stories", "View Stories", "/api/stories", "public stories");
});

document.querySelector("#view-videos-button")?.addEventListener("click", async () => {
  await loadCollection("videos", "View Videos", "/api/videos", "public videos");
});

document.querySelector("#show-following-button")?.addEventListener("click", () => {
  if (!hasActiveProfile("Show Following")) {
    return;
  }

  showToolResult(
    "Show Following",
    `Following count: ${formatCount(currentProfile.following)}.\n${
      currentProfile.followingVisibility === 1
        ? "TikTok may show a following visibility signal for this account, but the current public payload still does not include the actual list or a downloadable JSON export."
        : "The current public payload does not include the actual following list or a downloadable JSON export."
    }`
  );
});

document.querySelector("#show-followers-button")?.addEventListener("click", () => {
  if (!hasActiveProfile("Show Followers")) {
    return;
  }

  showToolResult(
    "Show Followers",
    `Follower count: ${formatCount(currentProfile.followers)}.\nThe current public payload does not include the actual follower list or a downloadable JSON export.`
  );
});

document.querySelector("#reposts-button")?.addEventListener("click", async () => {
  await loadCollection("reposts", "Reposts Viewer", "/api/reposts", "public reposts");
});

document.querySelector("#analysis-button")?.addEventListener("click", () => {
  if (!hasActiveProfile("Full Analysis")) {
    return;
  }

  renderAnalysis(currentProfile);
  document.querySelector("#analysis")?.scrollIntoView({ behavior: "smooth", block: "start" });
  openInfoModal("Full Analysis", toolConsole.textContent);
});

copyButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(responsePreview.textContent);
    copyButton.textContent = "Copied";
  } catch (error) {
    copyButton.textContent = "Copy failed";
  }

  window.setTimeout(() => {
    copyButton.textContent = "Copy JSON";
  }, 1200);
});

downloadResponseButton?.addEventListener("click", () => {
  if (!hasActiveProfile("Download JSON")) {
    return;
  }

  downloadTextFile(
    `${currentProfile.handle}-profile.json`,
    JSON.stringify(currentProfile, null, 2),
    "application/json"
  );
  setStatus(`Downloaded @${currentProfile.handle} profile JSON.`, "success");
});

profileImage?.addEventListener("error", () => {
  profileImage.src = "";
  profileImage.title = "";
  profileImage.removeAttribute("aria-label");
  profileImage.hidden = true;
  profileAvatar.hidden = false;
});

profileImage?.addEventListener("click", () => {
  if (profileImage.hidden || !profileImage.src) {
    return;
  }

  openImageModal(profileImage.src, profileImage.alt);
});

profileImage?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();

  if (profileImage.hidden || !profileImage.src) {
    return;
  }

  openImageModal(profileImage.src, profileImage.alt);
});

imageModalClose?.addEventListener("click", closeImageModal);
infoModalClose?.addEventListener("click", closeInfoModal);

imageModal?.addEventListener("click", (event) => {
  if (event.target === imageModal) {
    closeImageModal();
  }
});

infoModal?.addEventListener("click", (event) => {
  if (event.target === infoModal) {
    closeInfoModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (!imageModal.hidden) {
    closeImageModal();
  }

  if (!infoModal.hidden) {
    closeInfoModal();
  }
});

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("visible"));
}

applyTheme(localStorage.getItem(THEME_KEY) || "amber");
syncSavedLists();
downloadResponseButton.disabled = true;
setToolConsole("Run a lookup to populate the analysis panel.");

if (USES_LOCAL_API_BRIDGE) {
  setStatus("Local API bridge enabled. The frontend will use http://127.0.0.1:3000 for API requests.", "success");
}

lookupProfile("khaby.lame");
