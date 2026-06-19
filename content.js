const DEFAULT_SETTINGS = {
  noteFolder: "Clippings/Bilibili",
  obsidianApiBaseUrl: "http://127.0.0.1:27123",
  obsidianApiKey: "",
  tags: "clippings,bilibili",
  downloadFormat: "srt",
  includeDateInFilename: true,
  includeTimestampInBody: true,
  timestampMode: "media-extended",
  enableDebugLogs: false,
  readerTheme: "light",
  readerFontScale: "m",
  readerLetterSpacing: "normal",
  readerLineHeight: "tight",
  readerChapterVisibility: "show",
  readerTranscriptVisible: true,
  readerLayoutSide: true,
  frontmatterFields: [
    "title",
    "url",
    "bvid",
    "cid",
    "author",
    "upload_date",
    "subtitle_lang",
    "created",
    "tags"
  ],
  fixedFrontmatterProperties: []
};

const BOC_VERSION = "1.0.19";
const CACHE_KEY_PREFIX = "boc_subtitle_cache_";
globalThis.__BOC_CONTENT_SCRIPT_LOADED__ = BOC_VERSION;

// 在合集批量处理中临时覆盖当前 URL，让 markdown 构建链生成正确的每集时间戳链接
let _episodeUrlOverride = "";

const state = {
  currentUrl: location.href,
  fetchRunId: 0,
  bvid: "",
  aid: "",
  cid: "",
  cidSource: "",
  pageIndex: 1,
  pageCount: 0,
  pageTitle: "",
  videoDuration: 0,
  description: "",
  title: "",
  author: "",
  uploadDate: "",
  subtitles: [],
  selectedSubtitleId: "",
  selectedSubtitleUrl: "",
  selectedSubtitleLang: "",
  subtitleBody: [],
  subtitleFetchState: "idle",
  chapters: [],
  markdown: "",
  srt: "",
  txt: "",
  // 阅读视图相关状态
  readingViewOpen: false,
  readingNativePageMode: false,
  readingRootOriginalParent: null,
  readingAutoScroll: true,
  readingTheme: "light",
  readingFontScale: "m",
  readingLetterSpacing: "normal",
  readingLineHeight: "tight",
  readingChapterVisible: true,
  readingTranscriptVisible: true,
  readingLayoutSide: true,
  readingSettingsExpanded: false,
  readingDescriptionExpanded: false,
  readingActiveSubtitleIndex: -1,
  readingActiveChapterIndex: -1,
  readingNextScrollBehavior: "smooth",
  readingSyncTimer: 0,
  currentClipSignature: "",
  readingVideoEl: null,
  readingPlayerHost: null,
  readingMainOriginalParent: null,
  readingMainOriginalNextSibling: null,
  readingPlayerAdjustedNodes: [],
  readingPlayerObserver: null,
  readingPlayerMountTimer: 0,
  readingPlayerRetryTimer: 0,
  readingMiniDismissTimer: 0,
  readingControlsHideTimer: 0,
  readingControlsRecoveryTimer: 0,
  readingControlsRecoveryInFlight: false,
  readingControlsLastRecoverAt: 0,
  readingControlsHoverHost: null,
  readingHeaderHoverHost: null,
  readingHeaderHideTimer: 0,
  readingVideoEventsBound: false,
  readingLayoutBound: false,
  uiEventsBound: false,
  runtimeEventsBound: false,
  urlWatcherStarted: false,
  readingDocumentClickBound: false,
  readingManualScrollPauseUntil: 0,
  readingProgrammaticScrollUntil: 0,
  readingViewReady: false,
  statusText: "准备就绪，点击\"刷新抓取\"开始。",
  messageText: "",
  settings: { ...DEFAULT_SETTINGS },
  // 合集（UGC Season）相关
  seasonId: "",
  seasonTitle: "",
  seasonEpisodes: [],
  seasonProcessed: [],
  seasonStatus: "idle", // "idle" | "downloading" | "done" | "sending" | "sent"
  // 多P视频页面列表
  pages: [],
  multiPageStatus: "idle", // "idle" | "downloading" | "done"
  // 批量下载停止标志
  stopRequested: false,
  // 视频/字幕比例分割
  readingPlayerRatio: 0.65,
  readerWindowWidth: 1600,
  readerFontSize: 14,
  readerLetterSpacing: 0,
  readerLineHeight: 1.5,
  readerSubtitlePercent: 28,
  readingResizerDown: false,
  // 划词高亮
  highlights: [],
  // 标题原始位置（用于退出阅读器时恢复）
  readingTitleOriginalParent: null,
  readingTitleOriginalNextSibling: null
};

function formatLocalDate(value = Date.now()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shouldDebugLog() {
  return Boolean(state.settings?.enableDebugLogs);
}

function logInfo(...args) {
  if (shouldDebugLog()) {
    console.info(...args);
  }
}

function logWarn(...args) {
  if (shouldDebugLog()) {
    console.warn(...args);
  }
}

/* ── 阅读视图 URL 工具函数 ── */

function isReaderMode(url = location.href) {
  try {
    return new URL(url).searchParams.get("boc_reader") === "1";
  } catch {
    return false;
  }
}

function stripReaderModeUrl(url = location.href) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("boc_reader");
    return parsed.toString();
  } catch {
    return url;
  }
}

function replaceReaderModeUrl(nextUrl) {
  const targetUrl = String(nextUrl || "").trim();
  if (!targetUrl || targetUrl === location.href) {
    return;
  }
  try {
    history.replaceState(history.state, "", targetUrl);
  } catch {
    // silent
  }
}

function isWatchlaterPage(url = location.href) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.bilibili.com" && parsed.pathname.startsWith("/list/watchlater");
  } catch {
    return false;
  }
}

/* ── 阅读器规范化函数 ── */

function normalizeReaderTheme(value) {
  return value === "dark" || value === "paper" ? value : "light";
}

function normalizeReaderFontScale(value) {
  return ["xs", "s", "m", "l", "xl"].includes(value) ? value : "m";
}

function normalizeReaderLetterSpacing(value) {
  return ["tighter", "tight", "normal", "relaxed", "loose"].includes(value) ? value : "normal";
}

function normalizeReaderLineHeight(value) {
  return ["compact", "tight", "normal", "relaxed", "loose"].includes(value) ? value : "tight";
}

function normalizeReaderChapterVisibility(value) {
  return value === "hide" || value === "auto" ? value : "show";
}

function normalizeReaderTranscriptVisible(value) {
  return value !== false;
}

function normalizeReaderLayoutSide(value) {
  return value !== false;
}

/* ── 阅读器布局计算 ── */

function getReaderContentMaxPx() {
  return state.readerWindowWidth || 1600;
}

function getReaderPagePaddingPx() {
  return Math.max(16, Math.min(32, window.innerWidth * 0.028));
}

function getReaderMainWidthLimit() {
  return Math.min(getReaderContentMaxPx(), window.innerWidth - getReaderPagePaddingPx() * 2);
}

const ids = {
  root: "boc-root",
  panel: "boc-panel",
  status: "boc-status",
  meta: "boc-meta",
  subtitleSelect: "boc-subtitle-select",
  preview: "boc-preview",
  message: "boc-message",
  copyBtn: "boc-copy-btn",
  downloadBtn: "boc-download-btn",
  sendBtn: "boc-send-btn",
  refreshBtn: "boc-refresh-btn",
  closeBtn: "boc-close-btn",
  settingsBtn: "boc-settings-btn",
  // 合集UI
  seasonBar: "boc-season-bar",
  seasonTitle: "boc-season-title",
  seasonBtn: "boc-season-btn",
  seasonProgress: "boc-season-progress",
  seasonSendBtn: "boc-season-send-btn",
  // 时间戳模式
  timestampModeSelect: "boc-timestamp-mode",
  // 批量下载进度
  batchProgress: "boc-batch-progress",
  batchProgressBar: "boc-batch-progress-bar",
  batchProgressText: "boc-batch-progress-text",
  batchStopBtn: "boc-batch-stop-btn",
  // 阅读视图
  readingView: "boc-reading-view",
  readingPlayerSlot: "boc-reading-player-slot",
  readingStatus: "boc-reading-status",
  readingSaveBtn: "boc-reading-save-btn",
  readingCloseBtn: "boc-reading-close-btn",
  readingRefreshBtn: "boc-reading-refresh-btn",
  readingAutoScroll: "boc-reading-autoscroll",
  readingTranscriptVisible: "boc-reading-transcript-visible",
  readingThemeSelect: "boc-reading-theme-select",
  readingSettingsBtn: "boc-reading-settings-btn",
  readingSettingsPanel: "boc-reading-settings-panel",
  readingFontScaleSelect: "boc-reading-font-scale-select",
  readingLetterSpacingSelect: "boc-reading-letter-spacing-select",
  readingLineHeightSelect: "boc-reading-line-height-select",
  readingContentWidthSelect: "boc-reading-content-width-select",
  readingFontSizeSlider: "boc-reading-font-size-slider",
  readingLetterSpacingSlider: "boc-reading-letter-spacing-slider",
  readingLineHeightSlider: "boc-reading-line-height-slider",
  readingSplitRatioSlider: "boc-reading-split-ratio-slider",
  readingChapterVisibilitySelect: "boc-reading-chapter-visibility-select",
  readingChapterVisible: "boc-reading-chapter-visible",
  readingLayoutSide: "boc-reading-layout-side",
  readingSubtitleSelect: "boc-reading-subtitle-select",
  readingInfoSummary: "boc-reading-info-summary",
  readingInfoDescription: "boc-reading-info-description",
  readingDescriptionBtn: "boc-reading-description-btn",
  readingMeta: "boc-reading-meta",
  readingChapterList: "boc-reading-chapters",
  readingTranscriptList: "boc-reading-transcript",
  readingTranscriptTailSpacer: "boc-reading-tail-spacer"
};

/* ── 播放器管理函数 ── */

function clearNativeReaderFloatingStyles(playerHost = state.readingPlayerHost) {
  if (!state.readingNativePageMode || !playerHost) {
    return;
  }

  const targets = [];
  let current = playerHost;
  let depth = 0;
  while (current && current !== document.body && depth < 8) {
    if (
      current.matches?.(
        ".bpx-player-container, .bpx-docker, .bpx-player-video-area, .bpx-player-primary-area, #bilibili-player, #playerWrap, .player-wrap"
      )
    ) {
      targets.push(current);
    }
    if (current.id === "playerWrap") {
      break;
    }
    current = current.parentElement;
    depth += 1;
  }

  targets.forEach((node) => {
    node.style.removeProperty("position");
    node.style.removeProperty("inset");
    node.style.removeProperty("left");
    node.style.removeProperty("top");
    node.style.removeProperty("right");
    node.style.removeProperty("bottom");
    node.style.removeProperty("transform");
    node.style.removeProperty("width");
    node.style.removeProperty("height");
    node.style.removeProperty("max-width");
    node.style.removeProperty("max-height");
    node.style.removeProperty("margin");
    node.style.removeProperty("z-index");
  });
}

function getReaderPlayerWrapNode(playerHost = state.readingPlayerHost) {
  return (
    playerHost?.closest?.("#playerWrap") ||
    playerHost?.closest?.(".player-wrap") ||
    document.getElementById("playerWrap") ||
    document.querySelector(".player-wrap")
  );
}

function hasNativeReaderPlayerLayoutIssue(playerHost = state.readingPlayerHost) {
  if (!state.readingNativePageMode || !playerHost) {
    return false;
  }

  const playerStyle = window.getComputedStyle(playerHost);
  if (playerStyle.position === "fixed" || playerStyle.position === "sticky") {
    return true;
  }

  const playerRect = playerHost.getBoundingClientRect();
  const wrapNode = getReaderPlayerWrapNode(playerHost);
  if (!wrapNode) {
    return false;
  }

  const wrapRect = wrapNode.getBoundingClientRect();
  return wrapRect.height <= 8 && playerRect.height > 120;
}

function installReaderDebugHelpers() {
  const snapshotReader = (label = "manual") => createReaderDebugSnapshot(label);
  globalThis.__BOC_READER_DEBUG_SNAPSHOT__ = snapshotReader;
  globalThis.__BOC_DEBUG__ = {
    ...(globalThis.__BOC_DEBUG__ || {}),
    snapshotReader
  };
}

/* ── 阅读视图核心函数（来自 v1.0.18-chrome） ── */

function cleanupReaderFloatingArtifacts(playerHost = state.readingPlayerHost) {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  }
  dismissReaderMiniPlayer(playerHost);
  const runtimeHost = findReaderPlayerHost(getRuntimeVideoElement());
  if (runtimeHost && runtimeHost !== playerHost) {
    dismissReaderMiniPlayer(runtimeHost);
  }
}

async function enterReaderMode() {
  const readingView = byId(ids.readingView);
  state.readingViewOpen = true;
  state.readingNativePageMode = true;
  document.body.setAttribute("data-boc-reading-active", "1");
  hydrateReaderStateFromSettings(state.settings);
  state.readingLayoutSide = true; // 章节始终在右侧
  applyReadingViewPresentation();
  alignReaderViewportToPlayer();
  await sleep(0);
  openReaderViewShell(readingView);
  applyReaderPageFocus();
  renderReadingView();

  const earlyPlayerHost = findReaderPlayerHost(getRuntimeVideoElement());
  if (earlyPlayerHost) {
    earlyPlayerHost.setAttribute("data-boc-reader-fading", "1");
  }

  await sleep(0);

  const mounted = await ensureReaderPlayerMounted({ retries: 50, delayMs: 150, forceLayout: true });
  const mountedPlayerHost = state.readingPlayerHost || earlyPlayerHost;
  if (mountedPlayerHost) {
    mountedPlayerHost.removeAttribute("data-boc-reader-fading");
  }
  if (!mounted) {
    renderReadingStatus("正在等待视频播放器就绪...");
    scheduleReaderPlayerRetry();
    return;
  }

  finishEnterReaderMode();
}

function scheduleReaderPlayerRetry() {
  if (state.readingPlayerRetryTimer) {
    window.clearTimeout(state.readingPlayerRetryTimer);
    state.readingPlayerRetryTimer = 0;
  }
  const tryMount = async () => {
    state.readingPlayerRetryTimer = 0;
    if (!state.readingViewOpen || !isReaderMode()) return;
    const mounted = await ensureReaderPlayerMounted({ retries: 10, delayMs: 200, forceLayout: true });
    const retryHost = state.readingPlayerHost;
    if (retryHost) {
      retryHost.removeAttribute("data-boc-reader-fading");
    }
    if (mounted) {
      finishEnterReaderMode();
    } else if (state.readingViewOpen) {
      state.readingPlayerRetryTimer = window.setTimeout(tryMount, 500);
    }
  };
  state.readingPlayerRetryTimer = window.setTimeout(tryMount, 500);
}

function finishEnterReaderMode() {
  if (!state.readingViewOpen || !isReaderMode()) return;

  alignReaderViewportToPlayer();
  moveReadingMainInline();
  scheduleReaderMiniPlayerDismiss();
  maybeRefreshReaderSubtitleInBackground();
  syncReaderModeAfterMount();
  settleReaderModePresentation();
  bindReaderHeaderActionsHover();
}

function openReaderViewShell(readingView = byId(ids.readingView)) {
  if (!readingView) {
    return;
  }
  readingView.classList.add("open", "reader-page");
  readingView.setAttribute("aria-hidden", "false");
  setReadingViewReady(false);
  renderReadingStatus("正在准备播放器和字幕...");
}

function maybeRefreshReaderSubtitleInBackground() {
  if (state.subtitleBody.length) {
    return;
  }
  waitForVideoMetadata().then(() => {
    refreshClip().catch((error) => {
      if (!isStaleRunError(error)) {
        renderReadingStatus(`字幕加载失败：${getErrorMessage(error)}`);
      }
    });
  });
}

function waitForVideoMetadata(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const video = getRuntimeVideoElement();
      const duration = Number(video?.duration);
      const ready = video && Number.isFinite(duration) && duration > 0;
      if (ready || Date.now() - start >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(check, 150);
    };
    check();
  });
}

function syncReaderModeAfterMount() {
  startReadingViewSync();
  startReaderPlayerObserver();
  layoutReaderPlayerHost();
  syncReadingViewPlayback(true);
  updateReaderFollowState();
}

function settleReaderModePresentation() {
  if (!isReaderPresentationStable()) {
    setReadingViewReady(false);
    renderReadingStatus("正在稳定播放器布局...");
    scheduleReaderPlayerRetry();
    return false;
  }
  setReadingViewReady(true);
  renderReadingStatus("阅读视图已就绪，播放视频时字幕会自动高亮。");
  return true;
}

async function ensureReaderPlayerMounted({ retries = 1, delayMs = 100, forceLayout = false } = {}) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const video = getRuntimeVideoElement();
    const playerHost = findReaderPlayerHost(video);
    if (video && playerHost) {
      const previousHost = state.readingPlayerHost;
      const previousVideo = state.readingVideoEl;
      video.controls = false;
      video.removeAttribute("controls");
      video.disablePictureInPicture = true;
      video.setAttribute("disablepictureinpicture", "");
      video.removeAttribute("autopictureinpicture");
      state.readingPlayerHost = playerHost;
      const miniPlayerClosed = dismissReaderMiniPlayer(playerHost);
      if (miniPlayerClosed) {
        await sleep(120);
      }
      const activeHost = findReaderPlayerHost(video) || playerHost;
      state.readingPlayerHost = activeHost;
      normalizeReaderPlayerContainer(activeHost);
      if (state.readingNativePageMode) {
        clearNativeReaderFloatingStyles(activeHost);
        if (hasNativeReaderPlayerLayoutIssue(activeHost)) {
          normalizeReaderPlayerContainer(activeHost);
          clearNativeReaderFloatingStyles(activeHost);
        }
      }
      if (previousHost && previousHost !== activeHost) {
        setReaderPlayerControlsVisible(false, previousHost);
        cleanupReaderPlayerHostNode(previousHost);
      }
      if (previousVideo !== video) {
        state.readingVideoEventsBound = false;
      }
      activeHost.classList.add("boc-reader-player-host");
      bindReadingViewVideo(video);
      bindReaderPlayerControlsHover(activeHost);
      bindReaderLayout();
      if (
        forceLayout ||
        previousHost !== activeHost ||
        attempt > 0 ||
        miniPlayerClosed ||
        (state.readingNativePageMode && hasNativeReaderPlayerLayoutIssue(activeHost))
      ) {
        layoutReaderPlayerHost();
        if (state.readingNativePageMode && hasNativeReaderPlayerLayoutIssue(activeHost)) {
          normalizeReaderPlayerContainer(activeHost);
          clearNativeReaderFloatingStyles(activeHost);
          layoutReaderPlayerHost();
        }
      }
      if (state.readingNativePageMode && !isWatchlaterPage()) {
        await ensureReaderPlayerControlsRecovered(activeHost, {
          reason: attempt > 0 ? "mount-retry" : "mount"
        });
        queueEnsureReaderPlayerControlsRecovered({
          reason: attempt > 0 ? "post-mount-retry" : "post-mount",
          delayMs: 220,
          minIntervalMs: 240
        });
      }
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
      }
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

function queueEnsureReaderPlayerMounted() {
  if (!state.readingViewOpen || !isReaderMode() || state.readingPlayerMountTimer) {
    return;
  }
  state.readingPlayerMountTimer = window.setTimeout(() => {
    state.readingPlayerMountTimer = 0;
    ensureReaderPlayerMounted({ retries: 12, delayMs: 120, forceLayout: true }).catch((error) => {
      logWarn("[BOC] ensure reader player mounted failed", error);
    });
  }, 60);
}

function findReaderPlayerHost(video) {
  if (!video) {
    return null;
  }

  return (
    video.closest(".bpx-player-container") ||
    video.closest(".bpx-player-video-area") ||
    video.closest("#bilibili-player") ||
    video.parentElement
  );
}

function closeReadingView() {
  cleanupReaderFloatingArtifacts();
  state.readingViewOpen = false;
  state.readingNativePageMode = false;
  state.readingViewReady = false;
  state.readingSettingsExpanded = false;
  state.readingManualScrollPauseUntil = 0;
  state.readingProgrammaticScrollUntil = 0;
  state.readingNextScrollBehavior = "smooth";
  if (state.readingPlayerRetryTimer) {
    window.clearTimeout(state.readingPlayerRetryTimer);
    state.readingPlayerRetryTimer = 0;
  }
  const readingView = byId(ids.readingView);
  readingView.classList.remove("open", "reader-page");
  readingView.setAttribute("aria-hidden", "true");
  readingView.setAttribute("data-boc-reader-ready", "0");
  readingView.removeAttribute("data-boc-reader-follow");
  document.body.removeAttribute("data-boc-reading-active");
  document.documentElement.removeAttribute("data-boc-reader-mode");
  document.body.removeAttribute("data-boc-reader-mode");
  document.documentElement.removeAttribute("data-boc-reader-theme");
  document.documentElement.removeAttribute("data-boc-reader-font-scale");
  document.documentElement.removeAttribute("data-boc-reader-letter-spacing");
  document.documentElement.removeAttribute("data-boc-reader-line-height");
  document.documentElement.removeAttribute("data-boc-reader-content-width");
  document.documentElement.removeAttribute("data-boc-reader-chapter-visibility");
  document.documentElement.removeAttribute("data-boc-reader-has-chapters");
  document.body.removeAttribute("data-boc-reader-theme");
  document.body.removeAttribute("data-boc-reader-font-scale");
  document.body.removeAttribute("data-boc-reader-letter-spacing");
  document.body.removeAttribute("data-boc-reader-line-height");
  document.body.removeAttribute("data-boc-reader-content-width");
  document.body.removeAttribute("data-boc-reader-chapter-visibility");
  document.body.removeAttribute("data-boc-reader-has-chapters");
  restoreReadingMainInline();
  unbindReaderResizer();
  stopReadingViewSync();
  unbindReaderLayout();
  cleanupReaderPlayerHost();
  clearReaderPageFocus();
  const sendingBar = document.querySelector(".bpx-player-sending-bar");
  if (sendingBar) {
    sendingBar.setAttribute("data-boc-reader-hide-sending-bar", "1");
    sendingBar.style.setProperty("display", "none", "important");
    window.setTimeout(() => {
      sendingBar.style.removeProperty("display");
      sendingBar.removeAttribute("data-boc-reader-hide-sending-bar");
    }, 200);
  }
  window.setTimeout(() => cleanupReaderFloatingArtifacts(), 40);
  window.setTimeout(() => cleanupReaderFloatingArtifacts(), 220);
}

function renderReadingView() {
  const titleNode = document.querySelector(".boc-reading-title");
  const metaNode = byId(ids.readingMeta);
  const chapterList = byId(ids.readingChapterList);
  const transcriptList = byId(ids.readingTranscriptList);
  const chapters = normalizeChapters(state.chapters || []);
  const body = Array.isArray(state.subtitleBody) ? state.subtitleBody : [];
  const transcriptItems = getReadingTranscriptItems();
  const withHours = shouldShowHoursInNote(state, body);
  const hasChapters = chapters.length > 0;

  if (titleNode) {
    titleNode.textContent = state.title || "B站字幕阅读";
  }
  if (metaNode) {
    metaNode.textContent = buildReadingMetaLine();
  }

  if (chapters.length === 0) {
    chapterList.innerHTML = '<div class="boc-reading-empty">当前视频没有章节。</div>';
  } else {
    chapterList.innerHTML = chapters
      .map(
        (item, index) => `
          <button
            type="button"
            class="boc-reading-chapter"
            data-index="${index}"
            data-seconds="${Number(item.from || 0) || 0}"
          >
            <span class="boc-reading-chapter-time">${escapeHtml(
              formatCompactTimestamp(item.from, withHours)
            )}</span>
            <span class="boc-reading-chapter-title">${escapeHtml(item.title)}</span>
          </button>
        `
      )
      .join("");
  }

  if (transcriptItems.length === 0) {
    transcriptList.innerHTML = `<div class="boc-reading-empty">${escapeHtml(
      getReadingTranscriptPlaceholderText()
    )}</div>`;
  } else {
    transcriptList.innerHTML = transcriptItems
      .map(
        (item) => `
          <button
            type="button"
            class="boc-reading-item"
            data-index="${item.index}"
            data-seconds="${item.from}"
          >
            <span class="boc-reading-time">${escapeHtml(
              formatCompactTimestamp(item.from, withHours)
            )}</span>
            <span class="boc-reading-text">${escapeHtml(item.content)}</span>
          </button>
        `
      )
      .join("");
    transcriptList.insertAdjacentHTML(
      "beforeend",
      `<div id="${ids.readingTranscriptTailSpacer}" class="boc-reading-tail-spacer" aria-hidden="true"></div>`
    );
  }

  updateReaderChapterPresence(hasChapters);
  renderReadingInfoPanel();
  renderReadingSubtitleSelect();
  renderReaderPanels();
  applyReadingViewPresentation();
  updateReadingTranscriptTailSpacer();
  state.readingActiveSubtitleIndex = -1;
  state.readingActiveChapterIndex = -1;
}

function getReadingTranscriptPlaceholderText() {
  if (state.subtitleFetchState === "loading") {
    return "正在加载字幕...";
  }
  if (state.subtitleFetchState === "error") {
    return "字幕加载失败，请刷新重试。";
  }
  return "当前视频无字幕。";
}

function getReadingTranscriptItems(body = state.subtitleBody) {
  return (Array.isArray(body) ? body : [])
    .map((item, index) => ({
      index,
      from: Number(item?.from || 0) || 0,
      to: Number(item?.to || 0) || 0,
      content: String(item?.content || "").trim()
    }))
    .filter((item) => item.content);
}

function buildReadingMetaLine() {
  const parts = [];
  if (state.author) {
    parts.push(state.author);
  }
  if (state.uploadDate) {
    parts.push(state.uploadDate);
  }
  parts.push("bilibili.com");
  if (Number(state.pageCount) > 1) {
    const pageParts = [`P${Number(state.pageIndex) > 0 ? Number(state.pageIndex) : 1}`];
    if (state.pageTitle) {
      pageParts.push(state.pageTitle);
    }
    parts.push(pageParts.join(" "));
  }
  if (state.selectedSubtitleLang) {
    parts.push(`字幕：${state.selectedSubtitleLang}`);
  }
  return parts.join(" · ");
}

function renderReadingStatus(text) {
  byId(ids.readingStatus).textContent = String(text || "");
}

function setReadingViewReady(ready) {
  state.readingViewReady = Boolean(ready);
  const readingView = document.getElementById(ids.readingView);
  if (!readingView) {
    return;
  }
  readingView.setAttribute("data-boc-reader-ready", state.readingViewReady ? "1" : "0");
  readingView.setAttribute("aria-busy", state.readingViewReady ? "false" : "true");
}

function isReaderPresentationStable(playerHost = state.readingPlayerHost) {
  if (!state.readingViewOpen || !playerHost?.isConnected) {
    return false;
  }
  const rect = playerHost.getBoundingClientRect();
  if (!(rect.width > 240) || !(rect.height > 120)) {
    return false;
  }
  if (!state.readingNativePageMode) {
    return true;
  }
  return !hasNativeReaderPlayerLayoutIssue(playerHost);
}

function createReaderDebugSnapshot(label = "manual") {
  const pickNodeSnapshot = (selector) => {
    const node = document.querySelector(selector);
    if (!node) {
      return null;
    }
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return {
      selector,
      tag: node.tagName,
      id: node.id || "",
      className: typeof node.className === "string" ? node.className : "",
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      },
      style: {
        display: style.display,
        position: style.position,
        width: style.width,
        height: style.height,
        maxWidth: style.maxWidth,
        maxHeight: style.maxHeight,
        top: style.top,
        left: style.left,
        transform: style.transform,
        overflow: style.overflow,
        zIndex: style.zIndex
      },
      attrs: {
        readerKeep: node.getAttribute("data-boc-reader-keep"),
        readerHidden: node.getAttribute("data-boc-reader-hidden"),
        readerReset: node.getAttribute("data-boc-reader-player-reset")
      }
    };
  };

  const playerHost = state.readingPlayerHost || findReaderPlayerHost(getRuntimeVideoElement());
  const wrapNode = getReaderPlayerWrapNode(playerHost);
  const video = state.readingVideoEl || getRuntimeVideoElement();
  const hostChain = [];
  let current = playerHost;
  let depth = 0;
  while (current && depth < 8) {
    const rect = current.getBoundingClientRect();
    const style = window.getComputedStyle(current);
    hostChain.push({
      tag: current.tagName,
      id: current.id || "",
      className: typeof current.className === "string" ? current.className : "",
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      },
      style: {
        position: style.position,
        width: style.width,
        height: style.height,
        top: style.top,
        left: style.left,
        transform: style.transform,
        overflow: style.overflow,
        zIndex: style.zIndex
      },
      readerReset: current.getAttribute("data-boc-reader-player-reset")
    });
    current = current.parentElement;
    depth += 1;
  }

  return {
    label: String(label || "manual"),
    url: cleanVideoUrl(),
    readerMode: document.documentElement.getAttribute("data-boc-reader-mode"),
    readingActive: document.body.getAttribute("data-boc-reading-active"),
    readingViewOpen: state.readingViewOpen,
    readingNativePageMode: state.readingNativePageMode,
    readingViewReady: state.readingViewReady,
    readyStable: isReaderPresentationStable(playerHost),
    hasLayoutIssue: hasNativeReaderPlayerLayoutIssue(playerHost),
    hasRoot: Boolean(document.getElementById(ids.root)),
    hasReadingView: Boolean(document.getElementById(ids.readingView)),
    playerHost: playerHost
      ? {
          tag: playerHost.tagName,
          id: playerHost.id || "",
          className: typeof playerHost.className === "string" ? playerHost.className : ""
        }
      : null,
    wrapNode: wrapNode
      ? {
          tag: wrapNode.tagName,
          id: wrapNode.id || "",
          className: typeof wrapNode.className === "string" ? wrapNode.className : ""
        }
      : null,
    video: video
      ? {
          currentTime: Number(video.currentTime || 0) || 0,
          paused: Boolean(video.paused),
          videoWidth: Number(video.videoWidth || 0) || 0,
          videoHeight: Number(video.videoHeight || 0) || 0
        }
      : null,
    nodes: [
      "#app",
      "#playerWrap",
      ".player-wrap",
      "#bilibili-player",
      ".bpx-player-container",
      ".bpx-player-video-area",
      ".bpx-player-primary-area",
      "#boc-reading-inline-host",
      "#boc-reading-view"
    ]
      .map((selector) => pickNodeSnapshot(selector))
      .filter(Boolean),
    hostChain
  };
}

let _readerResizeHandler = null;

function bindReaderLayout() {
  if (state.readingLayoutBound) {
    return;
  }
  _readerResizeHandler = () => {
    if (!state.readingViewOpen) return;
    // 窗口缩放时重新按比例计算播放器/字幕像素宽度
    applyReaderSplit(state.readingPlayerRatio);
    // layoutReaderPlayerHost 由 applyReaderSplit 自动调用
  };
  window.addEventListener("resize", _readerResizeHandler);
  window.addEventListener("scroll", _readerResizeHandler, { passive: true });
  document.addEventListener("fullscreenchange", _readerResizeHandler);
  document.addEventListener("webkitfullscreenchange", _readerResizeHandler);
  state.readingLayoutBound = true;
}

function unbindReaderLayout() {
  if (!state.readingLayoutBound) {
    return;
  }
  if (_readerResizeHandler) {
    window.removeEventListener("resize", _readerResizeHandler);
    window.removeEventListener("scroll", _readerResizeHandler);
    document.removeEventListener("fullscreenchange", _readerResizeHandler);
    document.removeEventListener("webkitfullscreenchange", _readerResizeHandler);
    _readerResizeHandler = null;
  }
  state.readingLayoutBound = false;
}

function layoutReaderPlayerHost() {
  if (!state.readingViewOpen || !isReaderMode()) {
    return;
  }

  const readingView = byId(ids.readingView);
  const playerHost = state.readingPlayerHost;
  const slot = byId(ids.readingPlayerSlot);
  if (!playerHost) {
    return;
  }

  if (state.readingNativePageMode) {
    const rect = playerHost.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) {
      return;
    }

    const video = state.readingVideoEl;
    let renderedWidth = rect.width;
    let renderedHeight = rect.height;
    if (Number(video?.videoWidth) > 0 && Number(video?.videoHeight) > 0) {
      const aspectRatio = Number(video.videoWidth) / Number(video.videoHeight);
      if (aspectRatio > 0) {
        const hostAspectRatio = rect.width / rect.height;
        if (hostAspectRatio > aspectRatio) {
          renderedHeight = rect.height;
          renderedWidth = rect.height * aspectRatio;
        } else {
          renderedWidth = rect.width;
          renderedHeight = rect.width / aspectRatio;
        }
      }
    }

    const widthLimit = getReaderMainWidthLimit();
    if (renderedWidth > widthLimit) {
      const scale = widthLimit / renderedWidth;
      renderedWidth = widthLimit;
      renderedHeight *= scale;
    }

    clearNativeReaderFloatingStyles(playerHost);
    cleanupReaderPlayerHostNode(playerHost);
    readingView.style.setProperty("--boc-reader-player-rendered-width", `${Math.round(renderedWidth)}px`);
    readingView.style.setProperty("--boc-reader-player-rendered-height", `${Math.round(renderedHeight)}px`);
    // 字幕高度同步为播放器高度
    syncInlineHostHeight(Math.round(renderedHeight));
    updateReadingTranscriptTailSpacer();
    queueEnsureReaderPlayerControlsRecovered({
      reason: "layout-native",
      delayMs: 120
    });
    return;
  }

  if (!slot) {
    return;
  }

  const rect = slot.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) {
    return;
  }

  const video = state.readingVideoEl;
  const aspectRatio =
    Number(video?.videoWidth) > 0 && Number(video?.videoHeight) > 0
      ? Number(video.videoWidth) / Number(video.videoHeight)
      : 16 / 9;
  const targetHeight = rect.height;
  const targetWidth = Math.min(rect.width, targetHeight * aspectRatio);
  const left = rect.left + (rect.width - targetWidth) / 2;

  readingView.style.setProperty("--boc-reader-player-rendered-width", `${Math.round(targetWidth)}px`);
  readingView.style.setProperty("--boc-reader-player-rendered-height", `${Math.round(targetHeight)}px`);
  // 字幕高度同步为播放器高度
  syncInlineHostHeight(Math.round(targetHeight));
  playerHost.style.setProperty("position", "fixed", "important");
  playerHost.style.setProperty("left", `${Math.round(left)}px`, "important");
  playerHost.style.setProperty("top", `${Math.round(rect.top)}px`, "important");
  playerHost.style.setProperty("width", `${Math.round(targetWidth)}px`, "important");
  playerHost.style.setProperty("height", `${Math.round(targetHeight)}px`, "important");
  playerHost.style.setProperty("margin", "0", "important");
  playerHost.style.setProperty("z-index", "2147483647", "important");
  playerHost.style.setProperty("max-width", "none", "important");
  playerHost.style.setProperty("max-height", "none", "important");
  updateReadingTranscriptTailSpacer();
}

function syncInlineHostHeight(heightPx) {
  const inlineHost = document.getElementById("boc-reading-inline-host");
  if (inlineHost) {
    const clamped = Math.max(200, Math.round(heightPx) || 320);
    inlineHost.style.height = `${clamped}px`;
  }
}

/* ── 字号、字间距、行间距、窗口大小（滑块直控） ── */

function applyReaderFontSize(px) {
  const val = Math.max(8, Math.min(28, Number(px) || 14));
  state.readerFontSize = val;
  document.documentElement.style.setProperty("--boc-reader-transcript-font-size", `${val}px`);
  document.body.style.setProperty("--boc-reader-transcript-font-size", `${val}px`);
}

function applyReaderLetterSpacing(val) {
  const n = Math.max(-0.15, Math.min(0.2, Number(val) || 0));
  state.readerLetterSpacing = n;
  document.documentElement.style.setProperty("--boc-reader-letter-spacing", `${n}em`);
  document.body.style.setProperty("--boc-reader-letter-spacing", `${n}em`);
}

function applyReaderLineHeight(val) {
  const n = Math.max(0.8, Math.min(3.0, Number(val) || 1.5));
  state.readerLineHeight = n;
  document.documentElement.style.setProperty("--boc-reader-transcript-line-height", `${n}`);
  document.body.style.setProperty("--boc-reader-transcript-line-height", `${n}`);
}

/* ── 窗口大小（总宽度） ── */

function applyReaderWindowWidth(px) {
  const val = Math.max(1000, Math.min(1740, Number(px) || 1600));
  state.readerWindowWidth = val;
  // 直接在根元素上设置 CSS 变量，实时生效
  document.body.style.setProperty("--boc-reader-content-max", `${val}px`);
  document.documentElement.style.setProperty("--boc-reader-content-max", `${val}px`);
  // 触发重新布局
  if (state.readingViewOpen && !state.readingResizerDown) {
    applyReaderSplit(state.readingPlayerRatio);
  }
}

/* ── 视频/字幕比例分割 ── */

function applyReaderSplit(ratio) {
  const container = document.getElementById("boc-reader-split-box");
  const playerWrap = document.getElementById("playerWrap") || document.querySelector(".player-wrap");
  const inlineHost = document.getElementById("boc-reading-inline-host");
  const resizer = document.getElementById("boc-reader-resizer");
  if (!container || !playerWrap || !inlineHost || !resizer) return;

  const containerWidth = container.clientWidth;
  const resizerWidth = 6;
  const availableWidth = containerWidth - resizerWidth;
  const clampedRatio = Math.max(0.28, Math.min(0.78, Number(ratio) || 0.65));
  const playerPx = Math.round(availableWidth * clampedRatio);
  const transcriptPx = availableWidth - playerPx;

  playerWrap.style.width = `${playerPx}px`;
  playerWrap.style.maxWidth = `${playerPx}px`;
  playerWrap.style.flexShrink = "0";
  playerWrap.style.flexGrow = "0";
  inlineHost.style.width = `${transcriptPx}px`;
  inlineHost.style.maxWidth = `${transcriptPx}px`;
  inlineHost.style.flexShrink = "0";
  inlineHost.style.flexGrow = "0";

  state.readingPlayerRatio = clampedRatio;

  // 只在非拖拽状态下重新计算高度（避免拖拽中频繁重排）
  if (!state.readingResizerDown) {
    layoutReaderPlayerHost();
  }
}

// 拖拽结束后同步一次高度
function scheduleResizerHeightSync() {
  window.setTimeout(() => {
    if (!state.readingViewOpen) return;
    layoutReaderPlayerHost();
  }, 50);
}

// 通用滑块绑定：elementId → stateKey → formatFn → applyFn
function bindReaderSlider(elementId, stateKey, formatFn, applyFn) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const labelId = `${elementId}-label`.replace("boc-reading-", "boc-reading-");
  // 实际 label ID 更简洁：用通用的 boc-reading-slider-label 加 data-for
  let label = document.querySelector(`[data-for="${elementId}"]`);
  if (!label) label = el.parentElement?.querySelector(".boc-reading-slider-label");
  if (!label) label = document.getElementById(`${elementId.replace(/-slider$/, "-label")}`);

  const defaultValue = state[stateKey] ?? Number(el.defaultValue) ?? 0;

  el.addEventListener("input", () => {
    const val = Number(el.value);
    if (label) label.textContent = formatFn(val);
    applyFn(val);
    // 实时保存到 localStorage
    try { localStorage.setItem("boc_" + stateKey, String(val)); } catch {}
  });

  // 恢复保存的值（优先 localStorage，其次 state，最后默认值）
  let saved;
  try { saved = localStorage.getItem("boc_" + stateKey); } catch {}
  saved = saved !== null ? Number(saved) : (state.settings?.[stateKey] ?? state[stateKey] ?? defaultValue);
  el.value = String(saved);
  if (label) label.textContent = formatFn(Number(saved));
}

function bindReaderResizer() {
  const resizer = document.getElementById("boc-reader-resizer");
  if (!resizer || resizer.dataset.bocResizerBound) return;

  function onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    state.readingResizerDown = true;
    resizer.classList.add("is-dragging");
    const container = document.getElementById("boc-reader-split-box");
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    function onMouseMove(ev) {
      if (!state.readingResizerDown) return;
      const ratio = (ev.clientX - containerRect.left) / containerRect.width;
      applyReaderSplit(ratio);
    }

    function onMouseUp() {
      state.readingResizerDown = false;
      resizer.classList.remove("is-dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      scheduleResizerHeightSync();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.setProperty("cursor", "col-resize", "important");
    document.body.style.setProperty("user-select", "none", "important");
  }

  resizer.addEventListener("mousedown", onMouseDown);
  resizer.dataset.bocResizerBound = "1";
}

function unbindReaderResizer() {
  const resizer = document.getElementById("boc-reader-resizer");
  if (resizer) {
    resizer.remove();
  }
  const splitBox = document.getElementById("boc-reader-split-box");
  if (splitBox) {
    // 把 playerWrap 移回 splitBox 的父元素
    const playerWrap = document.getElementById("playerWrap") || document.querySelector(".player-wrap");
    const parent = splitBox.parentElement;
    if (playerWrap && parent) {
      parent.insertBefore(playerWrap, splitBox);
    }
    splitBox.remove();
  }
}

function cleanupReaderPlayerHostNode(playerHost) {
  if (!playerHost) {
    return;
  }
  playerHost.classList.remove("boc-reader-player-host");
  playerHost.style.removeProperty("position");
  playerHost.style.removeProperty("inset");
  playerHost.style.removeProperty("left");
  playerHost.style.removeProperty("top");
  playerHost.style.removeProperty("right");
  playerHost.style.removeProperty("bottom");
  playerHost.style.removeProperty("transform");
  playerHost.style.removeProperty("width");
  playerHost.style.removeProperty("height");
  playerHost.style.removeProperty("margin");
  playerHost.style.removeProperty("z-index");
  playerHost.style.removeProperty("max-width");
  playerHost.style.removeProperty("max-height");
}

function cleanupReaderPlayerHost() {
  restoreReaderPlayerContainer();
  unbindReaderPlayerControlsHover();
  unbindReaderHeaderActionsHover();
  if (state.readingControlsRecoveryTimer) {
    window.clearTimeout(state.readingControlsRecoveryTimer);
    state.readingControlsRecoveryTimer = 0;
  }
  state.readingControlsRecoveryInFlight = false;
  const readingView = byId(ids.readingView);
  readingView?.style.removeProperty("--boc-reader-player-rendered-width");
  readingView?.style.removeProperty("--boc-reader-player-rendered-height");
  const playerHost = state.readingPlayerHost;
  if (!playerHost) {
    return;
  }
  setReaderPlayerControlsVisible(false, playerHost);
  cleanupReaderPlayerHostNode(playerHost);
  state.readingPlayerHost = null;
}

function syncReadingViewPlayback(forceScroll = false) {
  if (!state.readingViewOpen) {
    return;
  }

  if (state.readingNativePageMode) {
    layoutReaderPlayerHost();
  }

  const runtimeVideo = getRuntimeVideoElement();
  const runtimeHost = findReaderPlayerHost(runtimeVideo);
  if (runtimeVideo && runtimeHost) {
    const playerChanged =
      runtimeVideo !== state.readingVideoEl || runtimeHost !== state.readingPlayerHost;
    if (playerChanged) {
      queueEnsureReaderPlayerMounted();
    }
  }

  const video = bindReadingViewVideo(runtimeVideo || state.readingVideoEl);
  if (!video) {
    renderReadingStatus("当前页面没有找到可联动的视频播放器。");
    return;
  }

  const currentTime = Number(video.currentTime || 0) || 0;
  const subtitleIndex = findActiveSubtitleIndex(currentTime);
  const chapterIndex = findActiveChapterIndex(currentTime);
  const subtitleChanged = subtitleIndex !== state.readingActiveSubtitleIndex;
  const chapterChanged = chapterIndex !== state.readingActiveChapterIndex;
  const changed = subtitleChanged || chapterChanged;

  // 始终更新高亮状态，只有在字幕索引变化时才触发滚动
  setActiveReadingItems(subtitleIndex, chapterIndex, forceScroll || subtitleChanged);
  updateReaderFollowState();
  renderReadingStatus(`当前进度 ${formatCompactTimestamp(currentTime, currentTime >= 3600)}`);
}

function findActiveSubtitleIndex(currentTime) {
  const items = Array.isArray(state.subtitleBody) ? state.subtitleBody : [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const from = Number(item?.from || 0) || 0;
    const rawTo = Number(item?.to || 0) || 0;
    const to = rawTo > from ? rawTo : from + 2;
    if (currentTime >= from && currentTime < to) {
      return index;
    }
  }
  return -1;
}

function findActiveChapterIndex(currentTime) {
  const chapters = normalizeChapters(state.chapters || []);
  for (let index = 0; index < chapters.length; index += 1) {
    const item = chapters[index];
    const from = Number(item?.from || 0) || 0;
    const next = chapters[index + 1];
    const explicitTo = Number(item?.to || 0) || 0;
    const fallbackTo = next && Number(next.from) > from ? Number(next.from) : explicitTo;
    const to = fallbackTo > from ? fallbackTo : Number.POSITIVE_INFINITY;
    if (currentTime >= from && currentTime < to) {
      return index;
    }
  }
  return -1;
}

function setActiveReadingItems(subtitleIndex, chapterIndex, shouldScroll = false) {
  const transcriptList = byId(ids.readingTranscriptList);
  const chapterList = byId(ids.readingChapterList);
  const nextTranscript = transcriptList.querySelector(`[data-index="${subtitleIndex}"]`);
  const nextChapter = chapterList.querySelector(`[data-index="${chapterIndex}"]`);
  const currentTranscript = transcriptList.querySelector(".boc-reading-item.is-active");
  const currentChapter = chapterList.querySelector(".boc-reading-chapter.is-active");

  if (currentTranscript && currentTranscript !== nextTranscript) {
    currentTranscript.classList.remove("is-active");
  }
  if (currentChapter && currentChapter !== nextChapter) {
    currentChapter.classList.remove("is-active");
  }
  if (nextTranscript) {
    nextTranscript.classList.add("is-active");
  }
  if (nextChapter) {
    nextChapter.classList.add("is-active");
  }

  if (shouldScroll && state.readingAutoScroll) {
    if (Date.now() < state.readingManualScrollPauseUntil) {
      updateReaderFollowState();
      state.readingActiveSubtitleIndex = subtitleIndex;
      state.readingActiveChapterIndex = chapterIndex;
      return;
    }
    if (nextTranscript) {
      scrollReadingTranscriptItemIntoView(nextTranscript);
    }
    if (nextChapter) {
      scrollReadingRailItemIntoView(nextChapter);
    }
  }

  state.readingActiveSubtitleIndex = subtitleIndex;
  state.readingActiveChapterIndex = chapterIndex;
}

function scrollReadingRailItemIntoView(node) {
  if (!node) {
    return;
  }
  state.readingProgrammaticScrollUntil = Date.now() + 600;
  node.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "nearest"
  });
}

function scrollReadingTranscriptItemIntoView(node) {
  if (!node) {
    return;
  }

  const transcriptList = byId(ids.readingTranscriptList);
  const inlineHost = document.getElementById("boc-reading-inline-host");
  const listRect = transcriptList.getBoundingClientRect();
  const itemRect = node.getBoundingClientRect();
  if (!(listRect.height > 0) || !(itemRect.height > 0)) {
    scrollReadingRailItemIntoView(node);
    return;
  }

  const behavior = state.readingNextScrollBehavior === "auto" ? "auto" : "smooth";
  state.readingProgrammaticScrollUntil = Date.now() + (behavior === "auto" ? 120 : 800);
  state.readingNextScrollBehavior = "smooth";
  if (state.readingNativePageMode && inlineHost && inlineHost.scrollHeight > inlineHost.clientHeight + 8) {
    // 全页模式：字幕在 inlineHost 内滚动，居中显示
    const hostRect = inlineHost.getBoundingClientRect();
    const targetScrollTop =
      inlineHost.scrollTop + (itemRect.top - hostRect.top) - (hostRect.height / 2) + (itemRect.height / 2);
    inlineHost.scrollTo({
      top: Math.max(0, Math.round(targetScrollTop)),
      behavior
    });
    return;
  }
  if (state.readingNativePageMode || transcriptList.scrollHeight <= transcriptList.clientHeight + 8) {
    // 窗口滚动模式：居中显示当前字幕
    const nextTop = window.scrollY + itemRect.top - (window.innerHeight / 2) + (itemRect.height / 2);
    window.scrollTo({
      top: Math.max(0, Math.round(nextTop)),
      behavior
    });
    return;
  }

  // transcriptList 内滚动模式：居中显示
  const targetScrollTop =
    transcriptList.scrollTop + (itemRect.top - listRect.top) - (listRect.height / 2) + (itemRect.height / 2);
  transcriptList.scrollTo({
    top: Math.max(0, Math.round(targetScrollTop)),
    behavior
  });
}

function jumpReadingTarget(seconds) {
  const video = bindReadingViewVideo();
  if (!video) {
    renderReadingStatus("当前页面没有找到可联动的视频播放器。");
    return;
  }

  const nextTime = Math.max(0, Number(seconds || 0) || 0);
  state.readingManualScrollPauseUntil = 0;
  state.readingNextScrollBehavior = "auto";
  updateReaderFollowState();
  video.currentTime = nextTime;
  if (video.paused) {
    video.play().catch(() => {});
  }
  syncReadingViewPlayback(true);
}

function onReadingChapterClick(event) {
  const target = event.target.closest(".boc-reading-chapter");
  if (!target) {
    return;
  }
  jumpReadingTarget(target.dataset.seconds);
}

function onReadingTranscriptClick(event) {
  const target = event.target.closest(".boc-reading-item");
  if (!target) {
    return;
  }
  if (window.getSelection()?.toString().trim()) {
    return;
  }
  jumpReadingTarget(target.dataset.seconds);
}

function noteManualReaderInteraction(durationMs = 3000) {
  if (!state.readingAutoScroll) {
    updateReaderFollowState();
    return;
  }
  state.readingManualScrollPauseUntil = Date.now() + durationMs;
  updateReaderFollowState();
}

function updateReaderFollowState() {
  const readingView = document.getElementById(ids.readingView);
  if (!readingView) {
    return;
  }
  const mode =
    !state.readingAutoScroll ? "off" : Date.now() < state.readingManualScrollPauseUntil ? "manual" : "auto";
  readingView.setAttribute("data-boc-reader-follow", mode);
}

function cleanVideoUrl(href = location.href) {
  try {
    const parsed = new URL(href);
    if (parsed.hostname !== "www.bilibili.com") {
      return href;
    }

    if (parsed.pathname === "/list/watchlater" || parsed.pathname === "/list/watchlater/") {
      const bvid = extractBvid(href);
      if (bvid) {
        return `https://www.bilibili.com/video/${bvid}/`;
      }
      return href;
    }

    const bvid = extractBvid(href);
    if (!bvid) {
      return href;
    }
    const p = parsed.searchParams.get("p");
    const qs = p ? `?p=${encodeURIComponent(p)}` : "";
    return `https://www.bilibili.com/video/${bvid}/${qs}`;
  } catch {
    return href;
  }
}

function computeCurrentClipSignature(url = location.href) {
  const bvid = extractBvid(url);
  const page = extractPageIndex(url);
  return [bvid, page].map((item) => String(item || "").trim()).join("|");
}

function getRuntimeVideoElement() {
  if (state.readingVideoEl?.isConnected) {
    const currentHost = findReaderPlayerHost(state.readingVideoEl);
    const currentRect = state.readingVideoEl.getBoundingClientRect();
    if (
      currentHost?.isConnected &&
      currentRect.width > 120 &&
      currentRect.height > 68 &&
      !isIgnoredReaderVideoCandidate(state.readingVideoEl)
    ) {
      return state.readingVideoEl;
    }
  }

  const candidates = Array.from(document.querySelectorAll("video")).filter(
    (item) => item.isConnected && !isIgnoredReaderVideoCandidate(item)
  );
  if (candidates.length === 0) {
    return null;
  }

  const visible = candidates
    .map((item) => {
      const rect = item.getBoundingClientRect();
      const host = findReaderPlayerHost(item);
      const inPlayer = Boolean(
        host &&
          (host.matches?.("#bilibili-player, .bpx-player-container, .bpx-player-video-area") ||
            host.querySelector?.(".bpx-player-video-area"))
      );
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      const score =
        area +
        (inPlayer ? 1000000 : 0) +
        (!item.paused ? 20000 : 0) +
        Number(item.readyState || 0) * 2000 +
        (item.currentSrc ? 10000 : 0) +
        (item === state.readingVideoEl ? 500 : 0);
      return { item, rect, score };
    })
    .filter(({ rect }) => rect.width > 240 && rect.height > 120)
    .sort((a, b) => b.score - a.score)[0];

  return visible?.item || candidates[0] || null;
}

function isIgnoredReaderVideoCandidate(video) {
  if (!video) {
    return true;
  }
  const host = findReaderPlayerHost(video);
  const blockedSelector = [
    "[data-boc-reader-hidden='1']",
    ".bpx-player-mini-warp",
    ".bpx-player-mini-close",
    ".bpx-player-ending-panel",
    ".bpx-player-ending-related",
    "[class*='mini-player']",
    "[class*='picture-in-picture']",
    "[class*='adcard']",
    ".ad-report",
    "[class*='ad-report']",
    ".video-page-card-small",
    ".video-page-special-card-small",
    ".feed-card",
    ".bili-video-card"
  ].join(", ");
  return Boolean(video.closest(blockedSelector) || host?.closest?.(blockedSelector));
}

function readVideoDescription() {
  const descNode = document.querySelector(
    ".desc-info-text, .video-desc .desc-info-text, .video-info-detail .text, .basic-desc-info"
  );
  return descNode?.textContent?.trim() || "";
}

function applyReaderPageFocus() {
  clearReaderPageFocus();

  const root = byId(ids.root);
  const video = getRuntimeVideoElement();
  const playerHost = findReaderPlayerHost(video);
  const titleNode = findReaderTitleContainer();
  const keepRoots = [root, playerHost, titleNode].filter(Boolean);

  keepRoots.forEach((node) => {
    markReaderKeepSubtree(node);
    markReaderKeepPath(node);
  });

  const keepNodes = Array.from(document.querySelectorAll("[data-boc-reader-keep='1']"));
  keepNodes.forEach((parent) => {
    Array.from(parent.children || []).forEach((child) => {
      if (child.id === ids.root) {
        return;
      }
      if (!child.hasAttribute("data-boc-reader-keep")) {
        child.setAttribute("data-boc-reader-hidden", "1");
      }
    });
  });

  pruneReaderNonKeepBranches(document.body);
  hideReaderNoiseNodes(keepRoots);
}

function clearReaderPageFocus() {
  document.querySelectorAll("[data-boc-reader-keep]").forEach((node) => {
    node.removeAttribute("data-boc-reader-keep");
  });
  document.querySelectorAll("[data-boc-reader-hidden]").forEach((node) => {
    node.removeAttribute("data-boc-reader-hidden");
  });
}

function moveReadingMainInline() {
  if (!isReaderMode()) {
    return;
  }

  const readingMain = document.querySelector(".boc-reading-main");
  if (!readingMain) {
    return;
  }
  if (!state.readingMainOriginalParent) {
    state.readingMainOriginalParent = readingMain.parentElement;
    state.readingMainOriginalNextSibling = readingMain.nextSibling;
  }
  const playerWrap =
    document.getElementById("playerWrap") ||
    state.readingPlayerHost?.closest?.("#playerWrap") ||
    state.readingPlayerHost;
  const hostParent = playerWrap?.parentElement;
  if (!playerWrap || !hostParent) {
    return;
  }

  let inlineHost = document.getElementById("boc-reading-inline-host");
  if (!inlineHost) {
    inlineHost = document.createElement("div");
    inlineHost.id = "boc-reading-inline-host";
  }

  // 创建可拖拽分隔条
  let resizer = document.getElementById("boc-reader-resizer");
  if (!resizer) {
    resizer = document.createElement("div");
    resizer.id = "boc-reader-resizer";
  }

  // 创建专用 flex 容器，确保播放器+分隔条+字幕始终在一行
  let splitBox = document.getElementById("boc-reader-split-box");
  if (!splitBox) {
    splitBox = document.createElement("div");
    splitBox.id = "boc-reader-split-box";
  }

  // 把 splitBox 放到 playerWrap 原本的位置
  if (splitBox.parentElement !== hostParent) {
    playerWrap.insertAdjacentElement("afterend", splitBox);
  }
  // 把 playerWrap 移入 splitBox（如果还没在里面）
  if (playerWrap.parentElement !== splitBox) {
    splitBox.appendChild(playerWrap);
  }
  // 把 resizer 移入 splitBox，跟在 playerWrap 后面
  if (resizer.parentElement !== splitBox || resizer.previousElementSibling !== playerWrap) {
    splitBox.insertBefore(resizer, playerWrap.nextSibling);
  }
  // 把 inlineHost 移入 splitBox，跟在 resizer 后面
  if (inlineHost.parentElement !== splitBox || inlineHost.previousElementSibling !== resizer) {
    splitBox.insertBefore(inlineHost, resizer.nextSibling);
  }

  if (!inlineHost.dataset.bocScrollBound) {
    const handleInlineHostManualScroll = () => {
      if (Date.now() <= state.readingProgrammaticScrollUntil) {
        return;
      }
      noteManualReaderInteraction();
    };
    inlineHost.addEventListener("scroll", handleInlineHostManualScroll);
    inlineHost.addEventListener("wheel", handleInlineHostManualScroll, { passive: true });
    inlineHost.dataset.bocScrollBound = "1";
  }

  // 绑定分隔条拖拽
  bindReaderResizer();

  if (readingMain.parentElement !== inlineHost) {
    inlineHost.appendChild(readingMain);
  }

  // 把标题(h1.video-title)移到字幕区域上方，给视频腾出更多空间
  const titleEl = document.querySelector("h1.video-title");
  if (titleEl && titleEl.parentElement !== inlineHost) {
    if (!state.readingTitleOriginalParent) {
      state.readingTitleOriginalParent = titleEl.parentElement;
      state.readingTitleOriginalNextSibling = titleEl.nextSibling;
    }
    // 移到 inlineHost 最前面（字幕内容之前）
    inlineHost.insertBefore(titleEl, inlineHost.firstChild);
  }

  const leftContainer = document.querySelector(".left-container");
  const bgColor = leftContainer ? getComputedStyle(leftContainer).backgroundColor : "";
  if (state.readingTranscriptVisible) {
    inlineHost.style.border = "";
    inlineHost.style.background = "";
    inlineHost.style.marginTop = "";
    inlineHost.style.boxShadow = "";
    inlineHost.style.borderRadius = "";
  } else {
    inlineHost.style.border = "none";
    inlineHost.style.background = bgColor;
    inlineHost.style.marginTop = "0";
    inlineHost.style.boxShadow = "none";
    inlineHost.style.borderRadius = "0";
  }

  // 应用保存的分割比例
  applyReaderSplit(state.readingPlayerRatio);

  updateReadingTranscriptTailSpacer();
}

function restoreReadingMainInline() {
  const readingMain = document.querySelector(".boc-reading-main");
  const inlineHost = document.getElementById("boc-reading-inline-host");
  if (readingMain && state.readingMainOriginalParent) {
    if (state.readingMainOriginalNextSibling?.parentNode === state.readingMainOriginalParent) {
      state.readingMainOriginalParent.insertBefore(readingMain, state.readingMainOriginalNextSibling);
    } else {
      state.readingMainOriginalParent.appendChild(readingMain);
    }
  }
  // 恢复标题到原始位置
  const titleEl = document.querySelector("h1.video-title");
  if (titleEl && state.readingTitleOriginalParent) {
    if (state.readingTitleOriginalNextSibling?.parentNode === state.readingTitleOriginalParent) {
      state.readingTitleOriginalParent.insertBefore(titleEl, state.readingTitleOriginalNextSibling);
    } else {
      state.readingTitleOriginalParent.appendChild(titleEl);
    }
  }
  state.readingTitleOriginalParent = null;
  state.readingTitleOriginalNextSibling = null;

  inlineHost?.remove();
  state.readingMainOriginalParent = null;
  state.readingMainOriginalNextSibling = null;
}

function pruneReaderNonKeepBranches(node) {
  if (!node?.children?.length) {
    return;
  }

  Array.from(node.children).forEach((child) => {
    if (child.id === ids.root) {
      return;
    }
    const childHasKeep = child.hasAttribute("data-boc-reader-keep");
    const childContainsKeep = Boolean(child.querySelector?.("[data-boc-reader-keep='1']"));
    if (!childHasKeep && !childContainsKeep) {
      child.setAttribute("data-boc-reader-hidden", "1");
      return;
    }
    pruneReaderNonKeepBranches(child);
  });
}

function hideReaderNoiseNodes(keepRoots = []) {
  const keepSet = new Set(keepRoots.filter(Boolean));
  const selectors = [
    ".strip-ad-inner",
    ".inside-wrp",
    ".inside-bg",
    ".hinter-msg",
    ".slide",
    ".cover.b-img",
    ".cover.b-img.sleepy",
    ".b-img.clickable",
    "[class*='activity']",
    "[class*='adcard']"
  ];

  document.querySelectorAll(selectors.join(",")).forEach((node) => {
    if (Array.from(keepSet).some((keepNode) => keepNode === node || node.contains(keepNode))) {
      return;
    }
    if (
      node.closest(
        "#bilibili-player, .bpx-player-container, .bpx-player-video-area, .bpx-player-primary-area, #boc-root, h1.video-title, .video-info-detail, .video-info-meta, .video-data"
      )
    ) {
      return;
    }
    node.setAttribute("data-boc-reader-hidden", "1");
    const card = node.closest("article, li, .card-box, .video-page-card-small, .video-page-special-card-small, .feed-card, .bili-video-card");
    if (card && !card.closest("#bilibili-player, .bpx-player-container, .bpx-player-video-area, .bpx-player-primary-area, #boc-root")) {
      card.setAttribute("data-boc-reader-hidden", "1");
    }
  });
}

function markReaderKeepSubtree(node) {
  if (!node) {
    return;
  }
  node.setAttribute("data-boc-reader-keep", "1");
  node.querySelectorAll("*").forEach((child) => {
    child.setAttribute("data-boc-reader-keep", "1");
  });
}

function markReaderKeepPath(node) {
  let current = node;
  while (current && current !== document.body) {
    current.setAttribute("data-boc-reader-keep", "1");
    current = current.parentElement;
  }
  document.body.setAttribute("data-boc-reader-keep", "1");
}

function findReaderTitleContainer() {
  const title =
    document.querySelector("h1.video-title") ||
    document.querySelector("h1") ||
    document.querySelector("[data-title]");
  if (!title) {
    return null;
  }
  return title;
}

function dismissReaderMiniPlayer(playerHost = state.readingPlayerHost) {
  const explicitClose = Array.from(document.querySelectorAll(".bpx-player-mini-close")).find(isVisibleReaderControl);
  if (explicitClose) {
    explicitClose.click();
    return true;
  }

  if (!playerHost) {
    return false;
  }

  const computed = window.getComputedStyle(playerHost);
  const fixedLike = computed.position === "fixed" || /mini|picture|float|fixed-player/i.test(playerHost.className || "");
  if (!fixedLike) {
    return false;
  }

  const roots = Array.from(
    new Set([
      playerHost,
      playerHost.parentElement,
      playerHost.closest("#playerWrap"),
      playerHost.closest("#bilibili-player")
    ].filter(Boolean))
  );

  const selectors = [
    ".bpx-player-mini-close",
    "[class*='mini'][class*='close']",
    "[class*='close']",
    "button[aria-label*='关闭']",
    "button[title*='关闭']",
    "[role='button'][aria-label*='关闭']",
    "[role='button'][title*='关闭']"
  ];

  for (const root of roots) {
    for (const selector of selectors) {
      const candidates = Array.from(root.querySelectorAll(selector)).filter(isVisibleReaderControl);
      const button = candidates.sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return rectA.width * rectA.height - rectB.width * rectB.height;
      })[0];
      if (button) {
        button.click();
        return true;
      }
    }
  }

  const playerRect = playerHost.getBoundingClientRect();
  for (const root of roots) {
    const fallback = Array.from(root.querySelectorAll("button, [role='button'], [tabindex], div, span"))
      .filter((node) => {
        if (!isVisibleReaderControl(node)) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const nearTopRight =
          rect.width <= 48 &&
          rect.height <= 48 &&
          rect.left >= playerRect.right - 96 &&
          rect.top <= playerRect.top + 96;
        return nearTopRight && (style.cursor === "pointer" || node.hasAttribute("role") || node.hasAttribute("tabindex"));
      })
      .sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return rectA.top + (playerRect.right - rectA.right) - (rectB.top + (playerRect.right - rectB.right));
      })[0];

    if (fallback) {
      fallback.click();
      return true;
    }
  }

  return false;
}

function scheduleReaderMiniPlayerDismiss(maxAttempts = 12, delayMs = 180) {
  if (!state.readingViewOpen) {
    return;
  }
  if (state.readingMiniDismissTimer) {
    window.clearTimeout(state.readingMiniDismissTimer);
    state.readingMiniDismissTimer = 0;
  }

  let attempts = 0;
  const run = () => {
    if (!state.readingViewOpen) {
      state.readingMiniDismissTimer = 0;
      return;
    }

    const closed = dismissReaderMiniPlayer();
    const host = findReaderPlayerHost(getRuntimeVideoElement());
    if (host) {
      state.readingPlayerHost = host;
      normalizeReaderPlayerContainer(host);
      layoutReaderPlayerHost();
    }

    attempts += 1;
    const miniExists = Boolean(document.querySelector(".bpx-player-mini-close, .bpx-player-mini-warp"));
    const hostFixed = Boolean(host && window.getComputedStyle(host).position === "fixed");
    if (attempts < maxAttempts && (miniExists || hostFixed || closed)) {
      state.readingMiniDismissTimer = window.setTimeout(run, delayMs);
      return;
    }
    state.readingMiniDismissTimer = 0;
  };

  state.readingMiniDismissTimer = window.setTimeout(run, 40);
}

function getReaderControlsRoot(playerHost = state.readingPlayerHost) {
  return (
    playerHost?.closest?.("#playerWrap") ||
    playerHost?.closest?.("#bilibili-player") ||
    playerHost ||
    document.getElementById("playerWrap") ||
    document.getElementById("bilibili-player")
  );
}

function getReaderPlayerControlsState(playerHost = state.readingPlayerHost) {
  const controlRoot = getReaderControlsRoot(playerHost);
  const nodes = [".bpx-player-control-wrap", ".bpx-player-control-mask", ".bpx-player-control-entity"].map(
    (selector) => {
      const node = controlRoot?.querySelector(selector) || null;
      return {
        selector,
        exists: Boolean(node),
        visible: isVisibleReaderControl(node)
      };
    }
  );

  return {
    controlRootFound: Boolean(controlRoot),
    hostHasNoCursor: Boolean(playerHost?.classList.contains("bpx-state-no-cursor")),
    anyPresent: nodes.some((item) => item.exists),
    anyHidden: nodes.some((item) => item.exists && !item.visible),
    nodes
  };
}

function hasReaderPlayerControlsIssue(playerHost = state.readingPlayerHost) {
  if (!state.readingNativePageMode || !playerHost || isWatchlaterPage()) {
    return false;
  }

  const snapshot = getReaderPlayerControlsState(playerHost);
  return snapshot.hostHasNoCursor || (snapshot.anyPresent && snapshot.anyHidden);
}

function queueEnsureReaderPlayerControlsRecovered({
  reason = "unknown",
  delayMs = 120,
  minIntervalMs = 480
} = {}) {
  if (!state.readingViewOpen || !state.readingNativePageMode || isWatchlaterPage()) {
    return;
  }
  const playerHost = state.readingPlayerHost;
  if (!playerHost?.isConnected || state.readingControlsRecoveryInFlight) {
    return;
  }

  const now = Date.now();
  if (state.readingControlsRecoveryTimer) {
    return;
  }
  if (now - state.readingControlsLastRecoverAt < minIntervalMs) {
    return;
  }

  state.readingControlsRecoveryTimer = window.setTimeout(() => {
    state.readingControlsRecoveryTimer = 0;
    if (!state.readingViewOpen || !state.readingNativePageMode || isWatchlaterPage()) {
      return;
    }
    const activeHost = state.readingPlayerHost;
    if (!activeHost?.isConnected || !hasReaderPlayerControlsIssue(activeHost)) {
      return;
    }

    state.readingControlsRecoveryInFlight = true;
    state.readingControlsLastRecoverAt = Date.now();
    ensureReaderPlayerControlsRecovered(activeHost, {
      reason,
      retryDelayMs: 120
    })
      .catch((error) => {
        logWarn("[BOC] queued reader controls recovery failed", { reason, error });
      })
      .finally(() => {
        state.readingControlsRecoveryInFlight = false;
      });
  }, delayMs);
}

function setReaderPlayerControlsVisible(visible, playerHost = state.readingPlayerHost) {
  if (!state.readingNativePageMode || !playerHost) {
    return;
  }

  const controlRoot = getReaderControlsRoot(playerHost);
  if (!controlRoot) {
    return;
  }

  const displayMap = new Map([
    [".bpx-player-control-wrap", "block"],
    [".bpx-player-control-mask", "block"],
    [".bpx-player-control-entity", "block"]
  ]);

  displayMap.forEach((displayValue, selector) => {
    const node = controlRoot.querySelector(selector);
    if (!node) {
      return;
    }

    if (visible) {
      node.style.setProperty("display", displayValue, "important");
      node.setAttribute("data-boc-reader-controls-forced", "1");
      return;
    }

    if (node.getAttribute("data-boc-reader-controls-forced") === "1") {
      node.style.removeProperty("display");
      node.removeAttribute("data-boc-reader-controls-forced");
    }
  });

  if (visible) {
    if (playerHost.classList.contains("bpx-state-no-cursor")) {
      playerHost.classList.remove("bpx-state-no-cursor");
      playerHost.setAttribute("data-boc-reader-no-cursor-cleared", "1");
    }
    return;
  }

  if (playerHost.getAttribute("data-boc-reader-no-cursor-cleared") === "1") {
    playerHost.classList.add("bpx-state-no-cursor");
    playerHost.removeAttribute("data-boc-reader-no-cursor-cleared");
  }
}

async function ensureReaderPlayerControlsRecovered(
  playerHost = state.readingPlayerHost,
  { reason = "unknown", retryDelayMs = 90 } = {}
) {
  if (!state.readingNativePageMode || !playerHost || isWatchlaterPage()) {
    return false;
  }

  const before = getReaderPlayerControlsState(playerHost);
  logInfo("[BOC] reader controls check", {
    reason,
    hostClassName: typeof playerHost.className === "string" ? playerHost.className : "",
    hostHasNoCursor: before.hostHasNoCursor,
    controlRootFound: before.controlRootFound,
    controls: before.nodes
  });

  if (!hasReaderPlayerControlsIssue(playerHost)) {
    return false;
  }

  logInfo("[BOC] recovering normal reader controls", {
    reason,
    hostClassName: typeof playerHost.className === "string" ? playerHost.className : ""
  });
  setReaderPlayerControlsVisible(true, playerHost);
  layoutReaderPlayerHost();

  let after = getReaderPlayerControlsState(playerHost);
  logInfo("[BOC] reader controls after recovery", {
    reason,
    hostClassName: typeof playerHost.className === "string" ? playerHost.className : "",
    hostHasNoCursor: after.hostHasNoCursor,
    controls: after.nodes,
    retried: false
  });
  if (!hasReaderPlayerControlsIssue(playerHost)) {
    return true;
  }

  await sleep(retryDelayMs);
  logInfo("[BOC] retrying normal reader controls recovery", {
    reason,
    hostClassName: typeof playerHost.className === "string" ? playerHost.className : ""
  });
  setReaderPlayerControlsVisible(true, playerHost);
  layoutReaderPlayerHost();
  after = getReaderPlayerControlsState(playerHost);
  logInfo("[BOC] reader controls after retry", {
    reason,
    hostClassName: typeof playerHost.className === "string" ? playerHost.className : "",
    hostHasNoCursor: after.hostHasNoCursor,
    controls: after.nodes,
    retried: true
  });
  return !hasReaderPlayerControlsIssue(playerHost);
}

function scheduleReaderPlayerControlsHide(playerHost = state.readingControlsHoverHost || state.readingPlayerHost) {
  if (state.readingControlsHideTimer) {
    window.clearTimeout(state.readingControlsHideTimer);
  }
  state.readingControlsHideTimer = window.setTimeout(() => {
    state.readingControlsHideTimer = 0;
    if (!state.readingViewOpen) {
      return;
    }
    setReaderPlayerControlsVisible(false, playerHost);
  }, 1200);
}

function bindReaderPlayerControlsHover(playerHost = state.readingPlayerHost) {
  if (!state.readingNativePageMode || !isWatchlaterPage() || !playerHost) {
    return;
  }

  if (state.readingControlsHoverHost && state.readingControlsHoverHost !== playerHost) {
    unbindReaderPlayerControlsHover();
  }
  if (playerHost.__bocReaderControlsHoverBound) {
    state.readingControlsHoverHost = playerHost;
    return;
  }

  const showControls = () => {
    if (!state.readingViewOpen) {
      return;
    }
    setReaderPlayerControlsVisible(true, playerHost);
    scheduleReaderPlayerControlsHide(playerHost);
  };
  const hideControls = () => {
    if (state.readingControlsHideTimer) {
      window.clearTimeout(state.readingControlsHideTimer);
      state.readingControlsHideTimer = 0;
    }
    setReaderPlayerControlsVisible(false, playerHost);
  };

  playerHost.addEventListener("mouseenter", showControls, true);
  playerHost.addEventListener("mousemove", showControls, true);
  playerHost.addEventListener("mouseleave", hideControls, true);
  playerHost.__bocReaderControlsHoverBound = { showControls, hideControls };
  state.readingControlsHoverHost = playerHost;
}

function unbindReaderPlayerControlsHover() {
  const playerHost = state.readingControlsHoverHost;
  if (state.readingControlsHideTimer) {
    window.clearTimeout(state.readingControlsHideTimer);
    state.readingControlsHideTimer = 0;
  }
  if (!playerHost?.__bocReaderControlsHoverBound) {
    state.readingControlsHoverHost = null;
    return;
  }

  const { showControls, hideControls } = playerHost.__bocReaderControlsHoverBound;
  playerHost.removeEventListener("mouseenter", showControls, true);
  playerHost.removeEventListener("mousemove", showControls, true);
  playerHost.removeEventListener("mouseleave", hideControls, true);
  delete playerHost.__bocReaderControlsHoverBound;
  setReaderPlayerControlsVisible(false, playerHost);
  state.readingControlsHoverHost = null;
}

function setReaderHeaderActionsVisible(visible) {
  const actions = document.querySelector(".boc-reading-actions");
  if (!actions) {
    return;
  }
  if (visible) {
    actions.removeAttribute("data-boc-icon-hidden");
    return;
  }
  actions.setAttribute("data-boc-icon-hidden", "1");
}

function scheduleReaderHeaderActionsHide(delayMs = 1000) {
  if (state.readingHeaderHideTimer) {
    window.clearTimeout(state.readingHeaderHideTimer);
    state.readingHeaderHideTimer = 0;
  }
  state.readingHeaderHideTimer = window.setTimeout(() => {
    state.readingHeaderHideTimer = 0;
    if (!state.readingViewOpen) {
      return;
    }
    setReaderHeaderActionsVisible(false);
  }, delayMs);
}

/* ── 划词高亮 ── */

function toggleHighlight(selection, item) {
  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();
  if (!text) {
    console.log("[BOC] toggleHighlight: empty text");
    return;
  }

  const startItem = range.startContainer?.closest?.(".boc-reading-item");
  const endItem = range.endContainer?.closest?.(".boc-reading-item");

  console.log("[BOC] toggleHighlight: startItem=", startItem?.dataset?.index, "endItem=", endItem?.dataset?.index);

  if (startItem !== endItem) {
    highlightMultiItem(selection, item);
    return;
  }
  highlightSingleItem(selection, item, range, text);
}

/* 单行高亮 */
function highlightSingleItem(selection, item, range, text) {
  // 如果选中文本已在高亮 span 内 → 取消高亮
  let node = range.startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  const existingHighlight = node.closest?.(".boc-highlight");
  if (existingHighlight) {
    const parent = existingHighlight.parentNode;
    parent.replaceChild(document.createTextNode(existingHighlight.textContent), existingHighlight);
    parent.normalize();
    state.highlights = state.highlights.filter(h => h.sel !== text);
    selection.removeAllRanges();
    return;
  }

  const span = document.createElement("span");
  span.className = "boc-highlight";
  span.textContent = text;
  try {
    range.deleteContents();
    range.insertNode(span);
  } catch {
    return;
  }

  const dataIdx = item.dataset.index;
  const seconds = item.dataset.seconds;
  // 获取整行文字
  const fullText = item.querySelector(".boc-reading-text")?.textContent?.trim() || text;
  state.highlights.push({
    index: dataIdx !== undefined ? Number(dataIdx) : -1,
    type: "single",
    full: fullText,
    sel: text,
    from: Number(seconds || 0) || 0,
    to: item.nextElementSibling
      ? Number(item.nextElementSibling.dataset.seconds || 0) || 0
      : Number(seconds || 0) + 2 || 0
  });
  selection.removeAllRanges();
}

/* 跨行高亮：用 CSS class 标记行，不修改 DOM 结构 */
function highlightMultiItem(selection, startItem, endItem) {
  if (!startItem || !endItem) { selection?.removeAllRanges?.(); return; }

  // 确定 DOM 顺序（支持从下往上选择）
  const pos = startItem.compareDocumentPosition(endItem);
  const begin = (pos & Node.DOCUMENT_POSITION_PRECEDING) ? endItem : startItem;
  const finish = (pos & Node.DOCUMENT_POSITION_PRECEDING) ? startItem : endItem;

  const texts = [];
  let firstSeconds = 0;
  let lastSeconds = 0;
  let allHighlighted = true;
  let current = begin;

  while (current) {
    const textEl = current.querySelector(".boc-reading-text");
    const txt = textEl?.textContent?.trim();
    if (txt) {
      const seconds = Number(current.dataset.seconds || 0) || 0;
      if (firstSeconds === 0) firstSeconds = seconds;
      lastSeconds = seconds;

      if (current.classList.contains("boc-item-highlight")) {
        current.classList.remove("boc-item-highlight");
      } else {
        allHighlighted = false;
        current.classList.add("boc-item-highlight");
        texts.push(txt);
      }
    }
    if (current === finish) break;
    current = current.nextElementSibling;
    while (current && !current.matches?.(".boc-reading-item")) {
      current = current.nextElementSibling;
    }
  }

  selection.removeAllRanges();

  if (texts.length > 0) {
    const cleaned = texts.map(t => t.replace(/[\r\n]+/g, " ").trim()).filter(Boolean);
    state.highlights.push({
      index: Number(begin.dataset.index) || -1,
      type: "multi",
      text: cleaned.join(", "),
      full: cleaned.join(" "),
      from: firstSeconds,
      to: lastSeconds + 2 || 0
    });
  } else if (allHighlighted) {
    // 全部已高亮 → 取消整条
    const fullText = [];
    let c = begin;
    while (c) {
      const te = c.querySelector(".boc-reading-text");
      if (te?.textContent?.trim()) fullText.push(te.textContent.trim());
      if (c === finish) break;
      c = c.nextElementSibling;
      while (c && !c.matches?.(".boc-reading-item")) {
        c = c.nextElementSibling;
      }
    }
    const cleanFull = fullText.map(t => t.replace(/[\r\n]+/g, " ").trim()).filter(Boolean).join(", ");
    state.highlights = state.highlights.filter(h => h.text !== cleanFull);
  }
}

/* ── 保存到 Obsidian（含高亮） ── */

async function sendReadingToObsidian() {
  let msg = "";
  try {
    // 刷新设置（与主程序 sendToObsidian 保持一致）
    state.settings = await getSettings();

    const hlList = state.highlights?.length > 0 ? state.highlights : [];
    let fullMarkdown = buildMarkdown(state, state.subtitleBody, state.settings, hlList);

    const { obsidianApiBaseUrl, obsidianApiKey, noteFolder } = state.settings || {};
    const baseUrl = String(obsidianApiBaseUrl || "").trim();
    const apiKey = String(obsidianApiKey || "").trim();
    if (!baseUrl || !apiKey) {
      msg = "请先在设置中填写 Obsidian API";
      renderReadingStatus(msg);
      chrome.runtime.sendMessage({ type: "open-options" }).catch(() => {});
      return;
    }
    const filename = buildNoteFilename(state);
    // 优先使用最近一次自定义路径，其次笔记目录
    const customPaths = state.settings?.recentCustomPaths || [];
    const recentPath = Array.isArray(customPaths) ? customPaths.find((p) => String(p || "").trim()) : "";
    const baseFolder = normalizeFolder(recentPath || noteFolder || "");
    const filepath = baseFolder ? `${baseFolder}/${filename}` : filename;
    await writeNoteByLocalApi(baseUrl, apiKey, filepath, fullMarkdown);
    msg = `已保存${hlList.length > 0 ? `（${hlList.length} 处高亮）` : ""}`;
    showReaderSaveToast(msg, false);
  } catch (error) {
    msg = `保存失败：${getErrorMessage(error)}`;
    showReaderSaveToast(msg, true);
  }
}

/** 在"存"按钮下方显示临时提示，与按钮自动隐藏时间一致（1 秒） */
function showReaderSaveToast(text, isError = false) {
  const btn = document.getElementById(ids.readingSaveBtn);
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  // 移除同位置已有的 toast
  const old = btn._bocSaveToast;
  if (old && old.parentNode) old.parentNode.removeChild(old);
  clearTimeout(btn._bocSaveToastTimer);

  const toast = document.createElement("div");
  toast.className = "boc-save-toast";
  toast.textContent = text;
  toast.style.position = "fixed";
  toast.style.left = `${rect.left + rect.width / 2}px`;
  toast.style.top = `${rect.bottom + 6}px`;
  if (isError) {
    toast.classList.add("error");
  }
  document.body.appendChild(toast);
  btn._bocSaveToast = toast;

  btn._bocSaveToastTimer = setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
    btn._bocSaveToast = null;
  }, 2000);
}

function formatTime(seconds) {
  const s = Math.floor(Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function bindReaderHeaderActionsHover() {
  if (!state.readingViewOpen) {
    return;
  }
  const header = document.querySelector(".boc-reading-header");
  if (!header || header.__bocReaderHeaderHoverBound) {
    state.readingHeaderHoverHost = header || null;
    return;
  }

  const showActions = () => {
    if (!state.readingViewOpen) return;
    if (state.readingHeaderHideTimer) {
      window.clearTimeout(state.readingHeaderHideTimer);
      state.readingHeaderHideTimer = 0;
    }
    setReaderHeaderActionsVisible(true);
  };

  // 方法1：鼠标移到右上角区域（260×100px）时显示按钮
  const TOP_RIGHT_ZONE_X = 320;
  const TOP_RIGHT_ZONE_Y = 120;
  const onReaderMouseMove = (e) => {
    if (!state.readingViewOpen) return;
    const nearTopRight = e.clientX > window.innerWidth - TOP_RIGHT_ZONE_X && e.clientY < TOP_RIGHT_ZONE_Y;
    if (nearTopRight) {
      showActions();
    } else {
      scheduleReaderHeaderActionsHide();
    }
  };
  document.addEventListener("mousemove", onReaderMouseMove);

  // 方法2：Escape 键退出阅读模式（按钮不可见时的安全出口）
  const onReaderKeyDown = (e) => {
    if (!state.readingViewOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (isReaderMode()) {
        replaceReaderModeUrl(stripReaderModeUrl(location.href));
      }
      closeReadingView();
    }
  };
  document.addEventListener("keydown", onReaderKeyDown);

  header.__bocReaderHeaderHoverBound = { onReaderMouseMove, onReaderKeyDown };
  state.readingHeaderHoverHost = header;
  setReaderHeaderActionsVisible(true);
  scheduleReaderHeaderActionsHide();
}

function unbindReaderHeaderActionsHover() {
  const header = state.readingHeaderHoverHost;
  if (state.readingHeaderHideTimer) {
    window.clearTimeout(state.readingHeaderHideTimer);
    state.readingHeaderHideTimer = 0;
  }
  if (header) {
    const bound = header.__bocReaderHeaderHoverBound;
    if (bound) {
      if (bound.onReaderMouseMove) {
        document.removeEventListener("mousemove", bound.onReaderMouseMove);
      }
      if (bound.onReaderKeyDown) {
        document.removeEventListener("keydown", bound.onReaderKeyDown);
      }
    }
    delete header.__bocReaderHeaderHoverBound;
  }
  state.readingHeaderHoverHost = null;
  setReaderHeaderActionsVisible(true);
}

function isVisibleReaderControl(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") {
    return false;
  }
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none";
}

function normalizeReaderPlayerContainer(playerHost = state.readingPlayerHost) {
  if (!playerHost) {
    return;
  }

  restoreReaderPlayerContainer();
  const adjusted = [];
  let current = playerHost;
  let depth = 0;

  while (current && current !== document.body && depth < 12) {
    const computed = window.getComputedStyle(current);
    const className = typeof current.className === "string" ? current.className : "";
    const isPlayerLayoutNode = current.matches?.(
      ".bpx-player-container, .bpx-player-video-area, .bpx-player-primary-area, .bpx-player-inner, .scroll-sticky, .player-wrap, #playerWrap, #bilibili-player"
    );
    const isExplicitMiniNode = current.matches?.(
      ".bpx-player-mini-warp, .bpx-player-mini-close, [class*='mini-player'], [class*='picture-in-picture']"
    );
    const hasFloatingPosition = computed.position === "fixed" || computed.position === "sticky";
    const isMiniLike =
      hasFloatingPosition ||
      /mini|picture|float|fixed-player/i.test(className) ||
      current.matches?.(".bpx-player-mini-warp, .bpx-player-mini-close");
    const shouldReset = state.readingNativePageMode
      ? Boolean(isExplicitMiniNode || (isPlayerLayoutNode && isMiniLike))
      : isPlayerLayoutNode || isMiniLike;

    if (shouldReset) {
      adjusted.push({
        node: current,
        position: current.style.position,
        left: current.style.left,
        top: current.style.top,
        right: current.style.right,
        bottom: current.style.bottom,
        width: current.style.width,
        height: current.style.height,
        transform: current.style.transform,
        margin: current.style.margin,
        zIndex: current.style.zIndex
      });
      current.setAttribute("data-boc-reader-player-reset", "1");
      current.style.setProperty("position", "static", "important");
      current.style.setProperty("left", "auto", "important");
      current.style.setProperty("top", "auto", "important");
      current.style.setProperty("right", "auto", "important");
      current.style.setProperty("bottom", "auto", "important");
      current.style.setProperty("transform", "none", "important");
      current.style.setProperty("margin", "0", "important");
      current.style.setProperty("z-index", "auto", "important");
      if (current !== playerHost) {
        current.style.removeProperty("width");
        current.style.removeProperty("height");
      }
    }

    current = current.parentElement;
    depth += 1;
  }

  state.readingPlayerAdjustedNodes = adjusted;
}

function restoreReaderPlayerContainer() {
  const adjusted = Array.isArray(state.readingPlayerAdjustedNodes) ? state.readingPlayerAdjustedNodes : [];
  adjusted.forEach((item) => {
    const node = item?.node;
    if (!node?.isConnected) {
      return;
    }
    node.style.position = item.position || "";
    node.style.left = item.left || "";
    node.style.top = item.top || "";
    node.style.right = item.right || "";
    node.style.bottom = item.bottom || "";
    node.style.width = item.width || "";
    node.style.height = item.height || "";
    node.style.transform = item.transform || "";
    node.style.margin = item.margin || "";
    node.style.zIndex = item.zIndex || "";
    node.removeAttribute("data-boc-reader-player-reset");
  });
  state.readingPlayerAdjustedNodes = [];
}

function alignReaderViewportToPlayer() {
  if (!isReaderMode()) {
    return;
  }

  const titleNode = findReaderTitleContainer();
  const playerHost = state.readingPlayerHost || findReaderPlayerHost(getRuntimeVideoElement());
  const anchor = titleNode || playerHost;
  if (!anchor) {
    return;
  }

  const titleRect = titleNode?.getBoundingClientRect?.();
  const playerRect = playerHost?.getBoundingClientRect?.();
  const top = Math.min(
    titleRect?.top ?? Number.POSITIVE_INFINITY,
    playerRect?.top ?? Number.POSITIVE_INFINITY
  );
  if (!Number.isFinite(top)) {
    return;
  }

  const nextTop = Math.max(0, window.scrollY + top - 16);
  window.scrollTo({ top: nextTop, behavior: "auto" });
  window.setTimeout(() => {
    if (!state.readingViewOpen || !isReaderMode()) {
      return;
    }
    window.scrollTo({ top: nextTop, behavior: "auto" });
    layoutReaderPlayerHost();
  }, 120);
}

/* ── 阅读视图辅助函数（仅缺失函数） ── */

function updateReadingTranscriptTailSpacer() {
  const spacer = document.getElementById(ids.readingTranscriptTailSpacer);
  if (!spacer) {
    return;
  }
  const inlineHost = document.getElementById("boc-reading-inline-host");
  const transcriptList = document.getElementById(ids.readingTranscriptList);
  const hostHeight = inlineHost?.clientHeight || transcriptList?.clientHeight || 0;
  const spacerHeight = Math.max(hostHeight, Math.round(window.innerHeight * 0.92), 320);
  spacer.style.height = `${spacerHeight}px`;
}

function applyNoSubtitleState() {
  state.selectedSubtitleId = "";
  state.selectedSubtitleUrl = "";
  state.selectedSubtitleLang = "";
  state.subtitleBody = [];
  state.subtitleFetchState = "empty";
  state.markdown = "";
  state.srt = "";
  state.txt = "";
  byId(ids.preview).value = "";
}

function updateReaderPreferences(next, { persist = true } = {}) {
  state.readingTheme = normalizeReaderTheme(next.readerTheme ?? state.readingTheme);
  state.readingFontScale = normalizeReaderFontScale(next.readerFontScale ?? state.readingFontScale);
  state.readingLetterSpacing = normalizeReaderLetterSpacing(
    next.readerLetterSpacing ?? state.readingLetterSpacing
  );
  state.readingLineHeight = normalizeReaderLineHeight(next.readerLineHeight ?? state.readingLineHeight);
  state.readingChapterVisible = next.readerChapterVisible !== undefined ? Boolean(next.readerChapterVisible) : state.readingChapterVisible;
  state.readingTranscriptVisible = normalizeReaderTranscriptVisible(
    next.readerTranscriptVisible ?? state.readingTranscriptVisible
  );
  state.readingLayoutSide = normalizeReaderLayoutSide(
    next.readerLayoutSide ?? state.readingLayoutSide
  );
  state.settings = {
    ...state.settings,
    readerTheme: state.readingTheme,
    readerFontScale: state.readingFontScale,
    readerLetterSpacing: state.readingLetterSpacing,
    readerLineHeight: state.readingLineHeight,
    readerChapterVisible: state.readingChapterVisible,
    readerTranscriptVisible: state.readingTranscriptVisible,
    readerLayoutSide: state.readingLayoutSide
  };
  applyReadingViewPresentation();
  renderReaderPanels();
  if (persist) {
    persistReaderSettings();
  }
}

function persistReaderSettings() {
  sendRuntimeMessage({ type: "save-settings", settings: state.settings }).catch((error) => {
    logWarn("[BOC] failed to persist reader settings", error);
  });
}

function getToggleLabel(key, value) {
  const labels = {
    fontScale: { xs: "最小", s: "偏小", m: "标准", l: "偏大", xl: "最大" },
    letterSpacing: { tighter: "最紧", tight: "偏紧", normal: "标准", relaxed: "偏松", loose: "最松" },
    lineHeight: { compact: "最紧", tight: "偏紧", normal: "标准", relaxed: "偏松", loose: "最松" },
  };
  return labels[key]?.[value] || "标准";
}

function getReaderStepperConfig(settingKey) {
  const configs = {
    readerFontScale: {
      options: ["xs", "s", "m", "l", "xl"],
      labelKey: "fontScale",
      getCurrent: () => state.readingFontScale,
      buildPayload: (value) => ({ readerFontScale: value })
    },
    readerLetterSpacing: {
      options: ["tighter", "tight", "normal", "relaxed", "loose"],
      labelKey: "letterSpacing",
      getCurrent: () => state.readingLetterSpacing,
      buildPayload: (value) => ({ readerLetterSpacing: value })
    },
    readerLineHeight: {
      options: ["compact", "tight", "normal", "relaxed", "loose"],
      labelKey: "lineHeight",
      getCurrent: () => state.readingLineHeight,
      buildPayload: (value) => ({ readerLineHeight: value })
    }
  };
  return configs[settingKey] || null;
}

function buildReaderStepperControl({
  id,
  title,
  settingKey
}) {
  const config = getReaderStepperConfig(settingKey);
  if (!config) {
    return "";
  }
  return `
    <div id="${id}" class="boc-reading-stepper" data-reader-setting-id="${id}">
      <span class="boc-reading-stepper-title">${escapeHtml(title)}</span>
      <div class="boc-reading-stepper-buttons" role="group" aria-label="${escapeHtml(title)}">
        ${config.options
          .map(
            (option, index) => `
          <button
            type="button"
            class="boc-reading-stepper-btn"
            data-value="${escapeHtml(option)}"
            aria-label="${escapeHtml(title)} ${escapeHtml(getToggleLabel(config.labelKey, option))}"
            title="${escapeHtml(getToggleLabel(config.labelKey, option))}"
          >${index + 1}</button>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

function bindReaderStepperControl(node, settingKey) {
  if (!node || node.dataset.bocBound === "1") {
    return;
  }

  node.addEventListener("click", (event) => {
    const button = event.target.closest("[data-value]");
    if (!button) {
      return;
    }
    setReaderPreference(settingKey, button.dataset.value || "");
  });
  node.dataset.bocBound = "1";
}

function setReaderPreference(settingKey, nextValue) {
  const config = getReaderStepperConfig(settingKey);
  if (!config) {
    return;
  }

  const current = config.getCurrent();
  if (!config.options.includes(nextValue) || nextValue === current) {
    return;
  }
  updateReaderPreferences(config.buildPayload(nextValue), { persist: true });
}

function renderReaderStepperState(node, settingKey) {
  const config = getReaderStepperConfig(settingKey);
  if (!node || !config) {
    return;
  }

  const current = config.getCurrent();
  node.querySelectorAll("[data-value]").forEach((button) => {
    const isActive = button.dataset.value === current;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function startReadingViewSync() {
  if (state.readingSyncTimer) {
    window.clearInterval(state.readingSyncTimer);
  }
  state.readingSyncTimer = window.setInterval(() => {
    syncReadingViewPlayback();
  }, 250);
}

function stopReadingViewSync() {
  if (state.readingSyncTimer) {
    window.clearInterval(state.readingSyncTimer);
    state.readingSyncTimer = 0;
  }
  if (state.readingMiniDismissTimer) {
    window.clearTimeout(state.readingMiniDismissTimer);
    state.readingMiniDismissTimer = 0;
  }
  if (state.readingControlsHideTimer) {
    window.clearTimeout(state.readingControlsHideTimer);
    state.readingControlsHideTimer = 0;
  }
  if (state.readingControlsRecoveryTimer) {
    window.clearTimeout(state.readingControlsRecoveryTimer);
    state.readingControlsRecoveryTimer = 0;
  }
  state.readingControlsRecoveryInFlight = false;
  if (state.readingPlayerMountTimer) {
    window.clearTimeout(state.readingPlayerMountTimer);
    state.readingPlayerMountTimer = 0;
  }
  if (state.readingPlayerRetryTimer) {
    window.clearTimeout(state.readingPlayerRetryTimer);
    state.readingPlayerRetryTimer = 0;
  }
  stopReaderPlayerObserver();
  unbindReaderPlayerControlsHover();
  if (state.readingVideoEl && state.readingVideoEl.__bocReadingSyncHandler) {
    const video = state.readingVideoEl;
    video.removeEventListener("timeupdate", video.__bocReadingSyncHandler);
    video.removeEventListener("seeked", video.__bocReadingSyncHandler);
    video.removeEventListener("loadedmetadata", video.__bocReadingSyncHandler);
    delete video.__bocReadingSyncHandler;
  }
  state.readingVideoEventsBound = false;
}

function startReaderPlayerObserver() {
  if (!isReaderMode() || state.readingPlayerObserver || !document.body) {
    return;
  }
  const observer = new MutationObserver(() => {
    if (!state.readingViewOpen) {
      return;
    }
    const nextVideo = getRuntimeVideoElement();
    const nextHost = findReaderPlayerHost(nextVideo);
    if (nextVideo && nextHost && (nextVideo !== state.readingVideoEl || nextHost !== state.readingPlayerHost)) {
      queueEnsureReaderPlayerMounted();
    }
    if (document.querySelector(".bpx-player-mini-close, .bpx-player-mini-warp")) {
      scheduleReaderMiniPlayerDismiss();
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  state.readingPlayerObserver = observer;
}

function stopReaderPlayerObserver() {
  if (state.readingPlayerObserver) {
    state.readingPlayerObserver.disconnect();
    state.readingPlayerObserver = null;
  }
}

function bindReadingViewVideo(video = getRuntimeVideoElement()) {
  if (!video) {
    if (state.readingVideoEl && state.readingVideoEl.__bocReadingSyncHandler) {
      const prev = state.readingVideoEl;
      prev.removeEventListener("timeupdate", prev.__bocReadingSyncHandler);
      prev.removeEventListener("seeked", prev.__bocReadingSyncHandler);
      prev.removeEventListener("loadedmetadata", prev.__bocReadingSyncHandler);
      delete prev.__bocReadingSyncHandler;
    }
    state.readingVideoEl = null;
    state.readingVideoEventsBound = false;
    return null;
  }

  if (state.readingVideoEl === video && state.readingVideoEventsBound) {
    return video;
  }

  if (state.readingVideoEl && state.readingVideoEl.__bocReadingSyncHandler) {
    const prev = state.readingVideoEl;
    prev.removeEventListener("timeupdate", prev.__bocReadingSyncHandler);
    prev.removeEventListener("seeked", prev.__bocReadingSyncHandler);
    prev.removeEventListener("loadedmetadata", prev.__bocReadingSyncHandler);
  }

  const syncHandler = (event) => {
    if (state.readingViewOpen) {
      if (event?.type === "loadedmetadata") {
        layoutReaderPlayerHost();
      }
      if (event?.type === "seeked") {
        state.readingNextScrollBehavior = "auto";
        queueEnsureReaderPlayerControlsRecovered({
          reason: "seeked",
          delayMs: 140,
          minIntervalMs: 320
        });
      }
      const latestHost = findReaderPlayerHost(video);
      if (latestHost && latestHost !== state.readingPlayerHost) {
        queueEnsureReaderPlayerMounted();
      }
      syncReadingViewPlayback();
    }
  };
  video.addEventListener("timeupdate", syncHandler);
  video.addEventListener("seeked", syncHandler);
  video.addEventListener("loadedmetadata", syncHandler);
  video.__bocReadingSyncHandler = syncHandler;
  state.readingVideoEl = video;
  state.readingPlayerHost = findReaderPlayerHost(video) || state.readingPlayerHost;
  state.readingVideoEventsBound = true;
  return video;
}

function renderReadingSubtitleSelect() {
  const select = byId(ids.readingSubtitleSelect);
  const subtitles = state.subtitles || [];

  if (subtitles.length === 0) {
    select.innerHTML = '<option value="">暂无字幕</option>';
    select.disabled = true;
    return;
  }

  select.innerHTML = subtitles
    .map((item) => {
      const selectedById =
        state.selectedSubtitleId && String(item.id) === String(state.selectedSubtitleId);
      const selectedByUrl = item.subtitleUrl === state.selectedSubtitleUrl;
      const selected = selectedById || selectedByUrl ? "selected" : "";
      const label = item.lanDoc || item.lan || "unknown";
      const isAi = isAiSubtitle(item);
      const aiTag = isAi ? " [AI]" : "";
      const optionLabel = `${label}${aiTag}`;
      return `<option value="${escapeHtml(item.subtitleUrl)}" data-lang="${escapeHtml(
        label
      )}" data-id="${escapeHtml(String(item.id || ""))}" data-isai="${isAi}" ${selected}>${escapeHtml(
        optionLabel
      )}</option>`;
    })
    .join("");
  select.disabled = false;
}

function renderReaderPanels() {
  const settingsPanel = byId(ids.readingSettingsPanel);
  const settingsBtn = byId(ids.readingSettingsBtn);
  settingsPanel.hidden = !state.readingSettingsExpanded;
  settingsBtn.classList.toggle("is-active", state.readingSettingsExpanded);
  byId(ids.readingAutoScroll).checked = state.readingAutoScroll;
  byId(ids.readingTranscriptVisible).checked = state.readingTranscriptVisible;
}

function renderReadingInfoPanel() {
  const summaryNode = byId(ids.readingInfoSummary);
  const descriptionNode = byId(ids.readingInfoDescription);
  const descriptionBtn = byId(ids.readingDescriptionBtn);
  const summaryItems = buildReadingSummaryItems();
  const description = String(state.description || "").trim();

  summaryNode.innerHTML =
    summaryItems.length === 0
      ? '<div class="boc-reading-empty">当前视频信息还未就绪。</div>'
      : summaryItems
          .map(
            (item) => `
              <div class="boc-reading-info-item">
                <span class="boc-reading-info-label">${escapeHtml(item.label)}</span>
                <span class="boc-reading-info-value">${escapeHtml(item.value)}</span>
              </div>
            `
          )
          .join("");

  if (!description) {
    descriptionNode.innerHTML = '<div class="boc-reading-empty">当前视频没有简介。</div>';
    descriptionNode.classList.remove("is-collapsed");
    descriptionBtn.hidden = true;
  } else {
    descriptionNode.textContent = description;
    const fullScrollHeight = descriptionNode.scrollHeight;
    descriptionNode.classList.add("is-collapsed");
    const clampedClientHeight = descriptionNode.clientHeight;
    descriptionNode.classList.toggle("is-collapsed", !state.readingDescriptionExpanded);
    const hasOverflow = fullScrollHeight > clampedClientHeight + 2;
    if (!hasOverflow) {
      descriptionNode.classList.remove("is-collapsed");
      descriptionBtn.hidden = true;
      return;
    }
    descriptionBtn.hidden = false;
    descriptionBtn.textContent = state.readingDescriptionExpanded ? "收起简介" : "查看更多";
  }
}

function buildReadingSummaryItems() {
  const items = [];
  if (state.title) {
    items.push({ label: "标题", value: state.title });
  }
  if (state.author) {
    items.push({ label: "作者", value: state.author });
  }
  if (state.uploadDate) {
    items.push({ label: "日期", value: state.uploadDate });
  }
  if (Number(state.pageCount) > 1) {
    const pageParts = [`P${Number(state.pageIndex) > 0 ? Number(state.pageIndex) : 1}`];
    if (state.pageTitle) {
      pageParts.push(state.pageTitle);
    }
    items.push({ label: "分P", value: pageParts.join(" ") });
  }
  return items;
}

function updateReaderChapterPresence(hasChapters) {
  const value = hasChapters ? "1" : "0";
  const readingView = byId(ids.readingView);
  readingView.dataset.hasChapters = value;
  document.documentElement.dataset.bocReaderHasChapters = value;
  document.body.dataset.bocReaderHasChapters = value;
}

function hydrateReaderStateFromSettings(settings = state.settings) {
  state.readingTheme = normalizeReaderTheme(settings?.readerTheme);
  state.readingFontScale = normalizeReaderFontScale(settings?.readerFontScale);
  state.readingLetterSpacing = normalizeReaderLetterSpacing(settings?.readerLetterSpacing ?? settings?.readerLineHeight);
  state.readingLineHeight = normalizeReaderLineHeight(settings?.readerLineHeight);
  state.readingChapterVisible = settings?.readerChapterVisible !== undefined ? Boolean(settings.readerChapterVisible) : true;
  state.readingTranscriptVisible = normalizeReaderTranscriptVisible(settings?.readerTranscriptVisible);
  state.readingLayoutSide = normalizeReaderLayoutSide(settings?.readerLayoutSide);
}

function applyReadingViewPresentation() {
  const readingView = byId(ids.readingView);
  readingView.dataset.theme = state.readingTheme;
  readingView.dataset.fontScale = state.readingFontScale;
  readingView.dataset.letterSpacing = state.readingLetterSpacing;
  readingView.dataset.lineHeight = state.readingLineHeight;
  readingView.dataset.chapterVisibility = state.readingChapterVisible ? "auto" : "hide";
  readingView.dataset.transcriptVisible = state.readingTranscriptVisible ? "1" : "0";
  readingView.dataset.layoutSide = state.readingLayoutSide ? "1" : "0";
  document.documentElement.dataset.bocReaderTheme = state.readingTheme;
  document.documentElement.dataset.bocReaderFontScale = state.readingFontScale;
  document.documentElement.dataset.bocReaderLetterSpacing = state.readingLetterSpacing;
  document.documentElement.dataset.bocReaderLineHeight = state.readingLineHeight;
  document.documentElement.dataset.bocReaderChapterVisibility = state.readingChapterVisible ? "auto" : "hide";
  document.documentElement.dataset.bocReaderTranscriptVisible = state.readingTranscriptVisible ? "1" : "0";
  document.body.dataset.bocReaderTheme = state.readingTheme;
  document.body.dataset.bocReaderFontScale = state.readingFontScale;
  document.body.dataset.bocReaderLetterSpacing = state.readingLetterSpacing;
  document.body.dataset.bocReaderLineHeight = state.readingLineHeight;
  document.body.dataset.bocReaderChapterVisibility = state.readingChapterVisible ? "auto" : "hide";
  document.body.dataset.bocReaderTranscriptVisible = state.readingTranscriptVisible ? "1" : "0";
  const readingChapterVisibleEl = byId(ids.readingChapterVisible);
  if (readingChapterVisibleEl) {
    readingChapterVisibleEl.checked = state.readingChapterVisible;
  }
  const readingLayoutSideEl = document.getElementById(ids.readingLayoutSide);
  if (readingLayoutSideEl) {
    readingLayoutSideEl.checked = state.readingLayoutSide;
  }
  const main = document.querySelector(".boc-reading-main");
  if (main) {
    main.style.display = state.readingTranscriptVisible ? "" : "none";
  }
  const inlineHost = document.getElementById("boc-reading-inline-host");
  if (inlineHost) {
    const leftContainer = document.querySelector(".left-container");
    const bgColor = leftContainer ? getComputedStyle(leftContainer).backgroundColor : "";
    if (state.readingTranscriptVisible) {
      inlineHost.style.border = "";
      inlineHost.style.background = "";
      inlineHost.style.marginTop = "";
      inlineHost.style.boxShadow = "";
      inlineHost.style.borderRadius = "";
    } else {
      inlineHost.style.border = "none";
      inlineHost.style.background = bgColor;
      inlineHost.style.marginTop = "0";
      inlineHost.style.boxShadow = "none";
      inlineHost.style.borderRadius = "0";
    }
  }
}

/* ── 阅读视图核心函数结束 ── */

init();

function init() {
  const existingRoot = document.getElementById(ids.root);
  if (existingRoot) {
    // 已有一个实例在运行，避免重复初始化破坏状态
    return;
  }

  logInfo(`[BOC] content script loaded, version=${BOC_VERSION}`);

  installReaderDebugHelpers();

  const shouldEnterReaderMode = isReaderMode();
  if (shouldEnterReaderMode) {
    document.documentElement.setAttribute("data-boc-reader-mode", "1");
    document.body.setAttribute("data-boc-reader-mode", "1");
  }

  const root = document.createElement("div");
  root.id = ids.root;
  root.innerHTML = buildUiHtml();
  document.body.appendChild(root);

  bindUiEvents();
  bindRuntimeEvents();
  startUrlWatcher();
  getSettings().then((settings) => {
    state.settings = settings;
    hydrateReaderStateFromSettings(settings);
    // 从 localStorage 恢复滑块值
    const ls = (k, d) => { try { const v = localStorage.getItem("boc_" + k); return v !== null ? Number(v) : undefined; } catch {} };
    applyReaderFontSize(ls("readerFontSize") ?? state.readerFontSize);
    applyReaderLetterSpacing(ls("readerLetterSpacing") ?? state.readerLetterSpacing);
    applyReaderLineHeight(ls("readerLineHeight") ?? state.readerLineHeight);
    applyReaderWindowWidth(ls("readerWindowWidth") ?? state.readerWindowWidth);
    const savedPct = ls("readerSubtitlePercent") ?? state.readerSubtitlePercent ?? 28;
    state.readingPlayerRatio = 1 - savedPct / 100;
    renderTimestampModeSelect();
    applyReadingViewPresentation();
    if (shouldEnterReaderMode) {
      enterReaderMode().catch((error) => {
        renderReadingStatus(`阅读视图启动失败：${getErrorMessage(error)}`);
      });
    }
  });
}

function bindRuntimeEvents() {
  if (state.runtimeEventsBound) {
    return;
  }
  state.runtimeEventsBound = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === "popup-get-state") {
      sendResponse({ ok: true, payload: getPopupPayload() });
      return false;
    }

    if (message.type === "popup-refresh") {
      refreshClip()
        .then(() => sendResponse({ ok: true, payload: getPopupPayload() }))
        .catch((error) =>
          sendResponse({ ok: false, error: getErrorMessage(error), payload: getPopupPayload() })
        );
      return true;
    }

    if (message.type === "popup-select-subtitle") {
      const url = String(message.url || "").trim();
      const lang = String(message.lang || "unknown");
      const subtitleId = String(message.subtitleId || "");
      if (!url) {
        sendResponse({ ok: false, error: "Missing subtitle URL", payload: getPopupPayload() });
        return false;
      }
      loadSubtitle(url, lang, state.fetchRunId, subtitleId)
        .then(() => {
          setStatus("字幕切换完成。");
          renderSubtitleSelect();
          sendResponse({ ok: true, payload: getPopupPayload() });
        })
        .catch((error) =>
          sendResponse({ ok: false, error: getErrorMessage(error), payload: getPopupPayload() })
        );
      return true;
    }

    if (message.type === "popup-send-obsidian") {
      const customPath = String(message.customPath || "").trim();
      sendToObsidian(customPath)
        .then(() => sendResponse({ ok: true, payload: getPopupPayload() }))
        .catch((error) =>
          sendResponse({ ok: false, error: getErrorMessage(error), payload: getPopupPayload() })
        );
      return true;
    }

    if (message.type === "popup-trigger-reading-view") {
      const readerUrl = String(message.readerUrl || "").trim();
      if (readerUrl) {
        replaceReaderModeUrl(readerUrl);
        document.documentElement.setAttribute("data-boc-reader-mode", "1");
        document.body.setAttribute("data-boc-reader-mode", "1");
      }
      if (!state.readingViewOpen) {
        enterReaderMode().catch((error) => {
          logWarn("[BOC] reading mode trigger failed", error);
        });
      }
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "popup-download-season") {
      const customPath = String(message.customPath || "").trim();
      // 立即回应 Popup，后台异步执行合集下载
      sendResponse({ ok: true, payload: getPopupPayload() });
      downloadAllSeasonEpisodes(customPath).catch((error) => {
        logWarn("[BOC] season download error", error);
      });
      return false;
    }

    if (message.type === "popup-season-send") {
      const customPath = String(message.customPath || "").trim();
      sendResponse({ ok: true, payload: getPopupPayload() });
      sendSeasonToObsidian(customPath).catch((error) => {
        logWarn("[BOC] season send error", error);
      });
      return false;
    }

    if (message.type === "popup-download-all-pages") {
      const customPath = String(message.customPath || "").trim();
      sendResponse({ ok: true, payload: getPopupPayload() });
      downloadAllPages(customPath).catch((error) => {
        logWarn("[BOC] multi-page download error", error);
      });
      return false;
    }

    if (message.type === "popup-set-timestamp-mode") {
      const newMode = String(message.mode || "").trim();
      if (newMode !== "hidden" && newMode !== "plain" && newMode !== "media-extended") {
        sendResponse({ ok: false, error: "Invalid timestamp mode", payload: getPopupPayload() });
        return false;
      }
      state.settings.timestampMode = newMode;
      state.settings.includeTimestampInBody = newMode !== "hidden";
      renderTimestampModeSelect();

      if (state.subtitleBody.length > 0) {
        state.markdown = buildMarkdown(state, state.subtitleBody, state.settings);
        state.srt = buildSrt(state.subtitleBody);
        state.txt = buildTxt(state.subtitleBody, state.settings);
        byId(ids.preview).value = buildSubtitlePreview(state.subtitleBody, state.settings);
      }

      persistTimestampMode(newMode).catch(() => {});
      sendResponse({ ok: true, payload: getPopupPayload() });
      return false;
    }

    return false;
  });
}

function buildUiHtml() {
  return `
    <aside id="${ids.panel}" aria-hidden="true">
      <header class="boc-header">
        <strong>Default</strong>
        <div class="boc-header-actions">
          <button id="${ids.settingsBtn}" type="button" title="插件设置">设置</button>
          <button id="${ids.closeBtn}" type="button" title="关闭">关闭</button>
        </div>
      </header>

      <p id="${ids.status}" class="boc-status">准备就绪，点击"刷新抓取"开始。</p>

      <div id="${ids.seasonBar}" class="boc-season-bar" style="display:none">
        <div class="boc-season-head">
          <span class="boc-season-label">合集</span>
          <span id="${ids.seasonTitle}" class="boc-season-title"></span>
          <span id="${ids.seasonProgress}" class="boc-season-progress"></span>
        </div>
        <div class="boc-season-actions">
          <button id="${ids.seasonBtn}" type="button">下载合集全部</button>
          <button id="${ids.seasonSendBtn}" type="button" style="display:none">发送合集到 Obsidian</button>
        </div>
      </div>

      <div class="boc-props-head">属性</div>
      <div id="${ids.meta}" class="boc-meta"></div>

      <label class="boc-label" for="${ids.subtitleSelect}">字幕语言</label>
      <select id="${ids.subtitleSelect}" disabled>
        <option value="">暂无字幕</option>
      </select>

      <label class="boc-label" for="${ids.timestampModeSelect}">时间戳格式</label>
      <select id="${ids.timestampModeSelect}">
        <option value="media-extended">时间戳链接（Media Extended）</option>
        <option value="plain">纯文本时间戳</option>
        <option value="hidden">不显示时间戳</option>
      </select>

      <label class="boc-label" for="${ids.preview}">字幕预览</label>
      <textarea id="${ids.preview}" readonly></textarea>

      <div class="boc-actions">
        <button id="${ids.refreshBtn}" type="button">刷新抓取</button>
        <button id="${ids.copyBtn}" type="button">复制完整 Markdown</button>
        <button id="${ids.downloadBtn}" type="button">下载字幕</button>
        <button id="${ids.sendBtn}" type="button">发送到 Obsidian</button>
      </div>

      <!-- 批量下载进度条 -->
      <div id="${ids.batchProgress}" class="boc-batch-progress" style="display:none">
        <div class="boc-batch-progress-bar-track">
          <div id="${ids.batchProgressBar}" class="boc-batch-progress-bar-fill" style="width:0%"></div>
        </div>
        <div class="boc-batch-progress-info">
          <span id="${ids.batchProgressText}" class="boc-batch-progress-text">0/0</span>
          <button id="${ids.batchStopBtn}" type="button" class="boc-batch-stop-btn">停止</button>
        </div>
      </div>

      <p id="${ids.message}" class="boc-message"></p>
    </aside>

    <section id="${ids.readingView}" aria-hidden="true" data-boc-reader-ready="0" aria-busy="true">
      <div class="boc-reading-layout">
        <aside class="boc-reading-rail">
          <div class="boc-reading-eyebrow">章节</div>
          <div id="${ids.readingChapterList}" class="boc-reading-list"></div>
        </aside>

        <section class="boc-reading-stage">
          <header class="boc-reading-header">
            <div class="boc-reading-header-copy">
              <strong class="boc-reading-title">${escapeHtml(state.title || "B站字幕阅读")}</strong>
              <div id="${ids.readingMeta}" class="boc-reading-meta">bilibili.com</div>
            </div>
            <div class="boc-reading-actions">
              <button id="${ids.readingSaveBtn}" type="button" class="boc-reading-icon-btn boc-save-btn" title="保存到 Obsidian" aria-label="保存">存</button>
              <button id="${ids.readingThemeSelect}" type="button" class="boc-reading-icon-btn" title="主题" aria-label="切换主题">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              </button>
              <button id="${ids.readingSettingsBtn}" type="button" class="boc-reading-icon-btn" title="设置" aria-label="设置">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button id="${ids.readingCloseBtn}" type="button" class="boc-reading-icon-btn" title="退出" aria-label="退出阅读视图">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </header>

          <section id="${ids.readingSettingsPanel}" class="boc-reading-panel boc-reading-settings-panel" hidden>
            <section class="boc-reading-settings-group">
              <div class="boc-reading-eyebrow">排版</div>
              <div class="boc-reading-stepper-list">
                <div class="boc-reading-slider-row">
                  <span class="boc-reading-stepper-title">字号</span>
                  <div class="boc-reading-slider-wrap">
                    <input id="${ids.readingFontSizeSlider}" type="range" min="10" max="26" step="1" value="14" class="boc-reading-slider" />
                    <span id="boc-reading-font-size-label" class="boc-reading-slider-label">14px</span>
                  </div>
                </div>
                <div class="boc-reading-slider-row">
                  <span class="boc-reading-stepper-title">字间距</span>
                  <div class="boc-reading-slider-wrap">
                    <input id="${ids.readingLetterSpacingSlider}" type="range" min="-0.1" max="0.15" step="0.01" value="0" class="boc-reading-slider" />
                    <span id="boc-reading-letter-spacing-label" class="boc-reading-slider-label">0em</span>
                  </div>
                </div>
                <div class="boc-reading-slider-row">
                  <span class="boc-reading-stepper-title">行间距</span>
                  <div class="boc-reading-slider-wrap">
                    <input id="${ids.readingLineHeightSlider}" type="range" min="1.0" max="2.5" step="0.1" value="1.5" class="boc-reading-slider" />
                    <span id="boc-reading-line-height-label" class="boc-reading-slider-label">1.5</span>
                  </div>
                </div>
                <div class="boc-reading-slider-row">
                  <span class="boc-reading-stepper-title">窗口大小</span>
                  <div class="boc-reading-slider-wrap">
                    <input id="${ids.readingContentWidthSelect}" type="range" min="1000" max="1740" step="10" value="1600" class="boc-reading-slider" />
                    <span id="boc-reading-width-label" class="boc-reading-slider-label">1600px</span>
                  </div>
                </div>
                <div class="boc-reading-slider-row">
                  <span class="boc-reading-stepper-title">字幕宽度</span>
                  <div class="boc-reading-slider-wrap">
                    <input id="${ids.readingSplitRatioSlider}" type="range" min="25" max="32" step="1" value="28" class="boc-reading-slider" />
                    <span id="boc-reading-split-ratio-label" class="boc-reading-slider-label">558px</span>
                  </div>
                </div>
              </div>
            </section>

            <section class="boc-reading-settings-group">
              <div class="boc-reading-controls">
                <label class="boc-reading-toggle boc-reading-toggle-inline">
                  <input id="${ids.readingAutoScroll}" type="checkbox" checked />
                  <span>滚动</span>
                </label>
                <label class="boc-reading-toggle boc-reading-toggle-inline">
                  <input id="${ids.readingTranscriptVisible}" type="checkbox" checked />
                  <span>字幕</span>
                </label>
                <label class="boc-reading-toggle boc-reading-toggle-inline">
                  <input id="${ids.readingChapterVisible}" type="checkbox" checked />
                  <span>章节</span>
                </label>
              </div>
            </section>

            <section class="boc-reading-settings-group">
              <div class="boc-reading-controls">
                <select id="${ids.readingSubtitleSelect}" class="boc-reading-select boc-reading-select-sm" aria-label="字幕语言">
                </select>
              </div>
            </section>

            <section class="boc-reading-settings-group boc-reading-info-group">
              <div class="boc-reading-eyebrow">视频摘要</div>
              <div id="${ids.readingInfoSummary}" class="boc-reading-info-list"></div>
            </section>
            <section class="boc-reading-settings-group boc-reading-info-group">
              <div class="boc-reading-eyebrow">视频简介</div>
              <div id="${ids.readingInfoDescription}" class="boc-reading-info-copy"></div>
              <button id="${ids.readingDescriptionBtn}" type="button" class="boc-reading-text-btn">展开简介</button>
            </section>
          </section>

          <p id="${ids.readingStatus}" class="boc-reading-status">使用页面原生播放器联动章节和字幕。</p>

          <div class="boc-reading-player-shell">
            <div id="${ids.readingPlayerSlot}" class="boc-reading-player-slot"></div>
          </div>
        </section>

        <aside class="boc-reading-transcript-rail">
          <div class="boc-reading-eyebrow">字幕</div>
          <section class="boc-reading-main">
            <div id="${ids.readingTranscriptList}" class="boc-reading-transcript"></div>
          </section>
        </aside>
      </div>
    </section>
  `;
}

function bindUiEvents() {
  const panel = byId(ids.panel);
  const closeBtn = byId(ids.closeBtn);
  const refreshBtn = byId(ids.refreshBtn);
  const select = byId(ids.subtitleSelect);
  const copyBtn = byId(ids.copyBtn);
  const downloadBtn = byId(ids.downloadBtn);
  const sendBtn = byId(ids.sendBtn);
  const settingsBtn = byId(ids.settingsBtn);
  const seasonBtn = byId(ids.seasonBtn);
  const seasonSendBtn = byId(ids.seasonSendBtn);
  const readingView = byId(ids.readingView);
  const readingCloseBtn = byId(ids.readingCloseBtn);
  const readingAutoScroll = byId(ids.readingAutoScroll);
  const readingTranscriptVisible = byId(ids.readingTranscriptVisible);
  const readingThemeSelect = byId(ids.readingThemeSelect);
  const readingSettingsToggleBtn = byId(ids.readingSettingsBtn);
  const readingContentWidthSelect = document.getElementById(ids.readingContentWidthSelect);
  const readingDescriptionBtn = byId(ids.readingDescriptionBtn);
  const chapterList = byId(ids.readingChapterList);
  const transcriptList = byId(ids.readingTranscriptList);

  closeBtn.addEventListener("click", () => panel.classList.remove("open"));
  refreshBtn.addEventListener("click", refreshClip);
  select.addEventListener("change", onSubtitleChange);
  copyBtn.addEventListener("click", copyMarkdown);
  downloadBtn.addEventListener("click", downloadSubtitle);
  sendBtn.addEventListener("click", sendToObsidian);
  settingsBtn.addEventListener("click", requestOpenOptions);
  seasonBtn.addEventListener("click", downloadAllSeasonEpisodes);
  seasonSendBtn.addEventListener("click", sendSeasonToObsidian);
  const timestampModeSelect = byId(ids.timestampModeSelect);
  timestampModeSelect.addEventListener("change", onTimestampModeChange);
  const batchStopBtn = byId(ids.batchStopBtn);
  batchStopBtn.addEventListener("click", onBatchStopClick);

  // 阅读视图事件绑定
  readingCloseBtn.addEventListener("click", () => {
    if (isReaderMode()) {
      replaceReaderModeUrl(stripReaderModeUrl(location.href));
    }
    closeReadingView();
  });
  readingAutoScroll.addEventListener("change", (event) => {
    state.readingAutoScroll = Boolean(event.target.checked);
    if (state.readingAutoScroll) {
      state.readingManualScrollPauseUntil = 0;
      syncReadingViewPlayback(true);
    }
    updateReaderFollowState();
  });
  readingTranscriptVisible.addEventListener("change", (event) => {
    const visible = event.target.checked;
    updateReaderPreferences({ readerTranscriptVisible: visible }, { persist: true });
    // 字幕取消勾选时整个面板隐藏，视频占满
    const host = document.getElementById("boc-reading-inline-host");
    if (host) {
      host.style.display = visible ? "" : "none";
    }
    // 标题也跟着隐藏
    const title = document.querySelector("#boc-reading-inline-host h1.video-title");
    if (title) {
      title.style.display = visible ? "" : "none";
    }
    // 重新布局
    if (state.readingViewOpen) {
      applyReaderSplit(state.readingPlayerRatio);
    }
  });

  // ── 保存按钮 ──
  const readingSaveBtn = document.getElementById(ids.readingSaveBtn);
  if (readingSaveBtn) {
    readingSaveBtn.addEventListener("click", () => {
      sendReadingToObsidian();
    });
  }

  // ── 划词高亮 ── (mouseup → mousedown 标记阻止 click 跳转)
  if (transcriptList) {
    let _selMouseUp = false;
    let _selStartItem = null;
    transcriptList.addEventListener("mousedown", (e) => {
      _selMouseUp = false;
      _selStartItem = e.target.closest(".boc-reading-item");
    });
    transcriptList.addEventListener("mouseup", (e) => {
      const sel = window.getSelection();
      if (!sel || !sel.toString().trim()) return;
      const item = e.target.closest(".boc-reading-item");
      if (!item) return;
      _selMouseUp = true;
      // 用鼠标事件追踪跨行：mousedown 和 mouseup 在不同 item 上
      if (_selStartItem && _selStartItem !== item) {
        highlightMultiItem(sel, _selStartItem, item);
      } else {
        toggleHighlight(sel, item);
      }
    });
    // click 时如果刚处理过划词，跳过跳转
    transcriptList.addEventListener("click", (e) => {
      if (_selMouseUp) {
        _selMouseUp = false;
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
  }
  const readingChapterVisible = byId(ids.readingChapterVisible);
  if (readingChapterVisible) {
    readingChapterVisible.addEventListener("change", (event) => {
      updateReaderPreferences({ readerChapterVisible: Boolean(event.target.checked) }, { persist: true });
    });
  }
  const readingLayoutSide = document.getElementById(ids.readingLayoutSide);
  if (readingLayoutSide) {
    readingLayoutSide.addEventListener("change", (event) => {
      updateReaderPreferences({ readerLayoutSide: Boolean(event.target.checked) }, { persist: true });
    });
  }
  readingThemeSelect.addEventListener("click", () => {
    const themes = ["light", "dark", "paper"];
    const current = state.readingTheme || "light";
    const nextIndex = (themes.indexOf(current) + 1) % themes.length;
    updateReaderPreferences({ readerTheme: themes[nextIndex] }, { persist: true });
    readingThemeSelect.classList.add("is-active");
    setTimeout(() => readingThemeSelect.classList.remove("is-active"), 300);
  });
  readingSettingsToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.readingSettingsExpanded = !state.readingSettingsExpanded;
    renderReaderPanels();
  });
  readingDescriptionBtn.addEventListener("click", () => {
    state.readingDescriptionExpanded = !state.readingDescriptionExpanded;
    renderReadingInfoPanel();
  });
  // ── 字号/字间距/行间距/窗口大小 滑块 ──
  bindReaderSlider(ids.readingFontSizeSlider, "readerFontSize",
    (v) => `${v}px`, applyReaderFontSize);
  bindReaderSlider(ids.readingLetterSpacingSlider, "readerLetterSpacing",
    (v) => `${Number(v) >= 0 ? "+" : ""}${v}em`, applyReaderLetterSpacing);
  bindReaderSlider(ids.readingLineHeightSlider, "readerLineHeight",
    (v) => `${v}`, applyReaderLineHeight);
  bindReaderSlider(ids.readingContentWidthSelect, "readerWindowWidth",
    (v) => `${v}px`, applyReaderWindowWidth);
  // 字幕宽度滑块（百分比→playerRatio）
  const splitEl = document.getElementById(ids.readingSplitRatioSlider);
  const splitLabel = document.getElementById("boc-reading-split-ratio-label");
  const calcSplitPx = (pct) => {
    const w = state.readerWindowWidth || 1600;
    return Math.round((w - 6) * Number(pct) / 100);
  };
  if (splitEl) {
    splitEl.addEventListener("input", () => {
      const pct = Number(splitEl.value);
      if (splitLabel) splitLabel.textContent = `${calcSplitPx(pct)}px`;
      const ratio = 1 - pct / 100;
      applyReaderSplit(ratio);
      state.readingPlayerRatio = ratio;
      try { localStorage.setItem("boc_readerSubtitlePercent", String(pct)); } catch {}
    });
    // 恢复保存的值
    let saved;
    try { saved = localStorage.getItem("boc_readerSubtitlePercent"); } catch {}
    saved = saved !== null ? Number(saved) : (state.readerSubtitlePercent ?? 28);
    splitEl.value = String(saved);
    if (splitLabel) splitLabel.textContent = `${calcSplitPx(saved)}px`;
    applyReaderSplit(1 - Number(saved) / 100);
  }

  const readingSubtitleSelect = byId(ids.readingSubtitleSelect);
  readingSubtitleSelect.addEventListener("change", (event) => {
    const option = event.target.options[event.target.selectedIndex];
    const url = String(option?.value || "");
    if (!url) return;
    loadSubtitle(url, String(option.dataset.lang || "unknown"), state.fetchRunId, String(option.dataset.id || ""))
      .then(() => {
        renderReadingView();
        syncReadingViewPlayback(true);
      })
      .catch((error) => {
        logWarn("[BOC] failed to switch subtitle in reading view", error);
      });
  });

  // Click outside settings panel to close
  if (!state.readingDocumentClickBound) {
    document.addEventListener("click", (e) => {
      if (!state.readingSettingsExpanded) return;
      const settingsPanel = document.getElementById(ids.readingSettingsPanel);
      const settingsBtnEl = document.getElementById(ids.readingSettingsBtn);
      if (!settingsPanel || !settingsBtnEl) {
        return;
      }
      if (!settingsPanel.contains(e.target) && !settingsBtnEl.contains(e.target)) {
        state.readingSettingsExpanded = false;
        renderReaderPanels();
      }
    });
    state.readingDocumentClickBound = true;
  }

  const handleReaderManualScroll = () => {
    if (Date.now() <= state.readingProgrammaticScrollUntil) {
      return;
    }
    noteManualReaderInteraction();
  };
  transcriptList.addEventListener("scroll", handleReaderManualScroll);
  transcriptList.addEventListener("wheel", handleReaderManualScroll, { passive: true });
  chapterList.addEventListener("wheel", handleReaderManualScroll, { passive: true });
  chapterList.addEventListener("pointerdown", () => noteManualReaderInteraction(3500));
  transcriptList.addEventListener("pointerdown", () => noteManualReaderInteraction(3500));
  chapterList.addEventListener("click", onReadingChapterClick);
  transcriptList.addEventListener("click", onReadingTranscriptClick);
  readingView.addEventListener("transitionend", () => {
    if (!state.readingViewOpen) {
      stopReadingViewSync();
    }
  });
}

function onBatchStopClick() {
  state.stopRequested = true;
  setMessage("正在停止下载...");
}

function updateBatchProgress(current, total) {
  const container = document.getElementById(ids.batchProgress);
  const bar = document.getElementById(ids.batchProgressBar);
  const text = document.getElementById(ids.batchProgressText);
  if (!container) return;

  if (total <= 0) {
    container.style.display = "none";
    return;
  }

  container.style.display = "";
  const pct = Math.min(100, Math.round((current / total) * 100));
  bar.style.width = pct + "%";
  text.textContent = `${current}/${total}`;
}

function startUrlWatcher() {
  if (state.urlWatcherStarted) {
    return;
  }
  state.urlWatcherStarted = true;

  window.setInterval(() => {
    const nextUrl = location.href;
    const nextSignature = computeCurrentClipSignature();
    if (nextSignature === state.currentClipSignature) {
      return;
    }

    state.currentUrl = nextUrl;
    state.currentClipSignature = nextSignature;
    resetClipState();
    const shouldEnterReaderMode = isReaderMode(nextUrl);
    if (!state.readingViewOpen && shouldEnterReaderMode) {
      document.documentElement.setAttribute("data-boc-reader-mode", "1");
      document.body.setAttribute("data-boc-reader-mode", "1");
      renderReadingStatus("检测到阅读视图跳转，正在打开阅读模式...");
      enterReaderMode().catch((error) => {
        renderReadingStatus(`阅读视图启动失败：${getErrorMessage(error)}`);
      });
      return;
    }
    if (state.readingViewOpen || shouldEnterReaderMode) {
      renderReadingStatus("检测到视频变化，正在自动刷新字幕...");
      waitForVideoMetadata().then(() => {
        refreshClip().catch((error) => {
          if (!isStaleRunError(error)) {
            renderReadingStatus(`自动刷新失败：${getErrorMessage(error)}`);
          }
        });
      });
      return;
    }
    setStatus("检测到页面变化，请点击\"刷新抓取\"加载当前视频字幕。");
  }, 1200);
}

function resetClipState() {
  state.bvid = "";
  state.aid = "";
  state.cid = "";
  state.cidSource = "";
  state.pageIndex = 1;
  state.pageCount = 0;
  state.pageTitle = "";
  state.videoDuration = 0;
  state.description = "";
  state.title = "";
  state.author = "";
  state.uploadDate = "";
  state.subtitles = [];
  state.selectedSubtitleId = "";
  state.selectedSubtitleUrl = "";
  state.selectedSubtitleLang = "";
  state.subtitleBody = [];
  state.subtitleFetchState = "idle";
  state.chapters = [];
  state.markdown = "";
  state.srt = "";
  state.txt = "";
  state.currentClipSignature = computeCurrentClipSignature();
  stopReadingViewSync();
  state.readingActiveSubtitleIndex = -1;
  state.readingActiveChapterIndex = -1;
  state.readingVideoEl = null;
  stopReaderPlayerObserver();

  // 重置合集状态
  state.seasonId = "";
  state.seasonTitle = "";
  state.seasonEpisodes = [];
  state.seasonProcessed = [];
  state.seasonStatus = "idle";

  // 重置多P状态
  state.pages = [];
  state.multiPageStatus = "idle";
  state.stopRequested = false;

  renderMeta();
  renderSubtitleSelect();
  renderSeasonInfo();
  byId(ids.preview).value = "";
  setMessage("");
  if (state.readingViewOpen) {
    renderReadingView();
    renderReadingStatus("请先点击\"刷新抓取\"加载当前视频字幕。");
  }
}

async function refreshClip() {
  const runId = ++state.fetchRunId;
  try {
    setBusyState(true);
    setMessage("");
    setStatus("正在抓取视频信息...");
    state.settings = await getSettings();
    renderTimestampModeSelect();
    ensureRunActive(runId);

    state.bvid = extractBvid(location.href);
    if (!state.bvid) {
      throw new Error("当前页面不是标准 BV 视频地址，无法抓取字幕。");
    }

    const pageIndex = extractPageIndex(location.href);
    const oid = extractOid(location.href);
    const hasPageParam = hasExplicitPageParam(location.href);
    const meta = await retryAsync(() => fetchVideoMeta(state.bvid), 2, 250);
    ensureRunActive(runId);

    // 调试：打印 API 返回的原始数据
    logInfo("[BOC] raw meta data", {
      meta,
      defaultCid: meta.defaultCid,
      pagesCount: (meta.pages || []).length
    });

    state.aid = meta.aid || "";
    state.title = meta.title || readVideoTitle();
    state.author = meta.author || readVideoAuthor();
    state.uploadDate = meta.uploadDate || readUploadDate();
    state.description = meta.description || "";

    // 检测合集（UGC Season）
    state.seasonId = meta.seasonId || "";
    state.seasonTitle = meta.seasonTitle || "";
    state.seasonEpisodes = Array.isArray(meta.seasonEpisodes) ? meta.seasonEpisodes : [];
    logInfo("[BOC] season info", {
      id: state.seasonId,
      title: state.seasonTitle,
      episodeCount: state.seasonEpisodes.length
    });

    state.pageCount = Array.isArray(meta.pages) ? meta.pages.length : 0;
    state.pages = Array.isArray(meta.pages) ? meta.pages : [];
    state.multiPageStatus = "idle";
    let resolvedPageIndex = pageIndex;
    if ((meta.pages || []).length > 1 && !hasPageParam) {
      const pageIndexFromOid = pickPageIndexFromOid(meta.pages, oid);
      if (pageIndexFromOid > 0) {
        resolvedPageIndex = pageIndexFromOid;
        logInfo("[BOC] resolved page index from oid", {
          oid,
          resolvedPageIndex
        });
      } else {
        // B 站多分P中，P1 常见为无 ?p= 参数；watchlater 等页面可能改用 oid 标识当前分P。
        resolvedPageIndex = 1;
        logInfo("[BOC] multi-page video without p param or valid oid, fallback to P1", {
          oid
        });
      }
    }

    const currentPage = pickPageFromPages(meta.pages, resolvedPageIndex);
    state.pageIndex = resolvedPageIndex;
    state.pageTitle = currentPage?.part || "";
    state.cid = currentPage?.cid || pickCidFromPages(meta.pages, resolvedPageIndex, meta.defaultCid);
    state.cidSource = "meta-pages";
    state.videoDuration = pickDurationFromPages(meta.pages, resolvedPageIndex, meta.defaultDuration);
    if (!(state.videoDuration > 0)) {
      state.videoDuration = readRuntimeVideoDuration();
    }
    if (!(state.videoDuration > 0)) {
      throw new Error("无法获取当前视频时长，已停止抓取以避免串到错误字幕。");
    }

    logInfo("[BOC] resolved video ids", {
      url: location.href,
      aid: state.aid,
      bvid: state.bvid,
      cid: state.cid,
      cidSource: state.cidSource,
      pageIndex: resolvedPageIndex,
      videoDuration: state.videoDuration
    });

    setStatus("正在获取可用字幕...");
    let subtitleBundle = await retryAsync(
      () => fetchSubtitleBundle(state.bvid, state.cid, state.aid),
      3,
      500
    );
    ensureRunActive(runId);
    state.subtitles = normalizeSubtitleTracks(subtitleBundle.tracks);
    state.chapters = normalizeChapters(subtitleBundle.chapters);
    logInfo(
      "[BOC] chapters",
      state.chapters.map((item) => ({
        from: item.from,
        to: item.to,
        title: item.title
      }))
    );
    logInfo(
      "[BOC] subtitle tracks",
      state.subtitles.map((item) => ({
        id: item?.id,
        lan: item?.lan,
        lanDoc: item?.lanDoc,
        url: item?.subtitleUrl
      }))
    );

    // 无字幕时也允许进入阅读视图，只是字幕区域保持空态。
    if (state.subtitles.length === 0) {
      applyNoSubtitleState();
      renderMeta();
      renderSubtitleSelect();
      renderSeasonInfo();
      if (state.readingViewOpen) {
        moveReadingMainInline();
        renderReadingView();
        renderReadingStatus("当前视频无字幕。");
        startReadingViewSync();
        startReaderPlayerObserver();
        syncReadingViewPlayback(true);
      }
      setStatus("当前视频无字幕。");
      return;
    }

    // 显式点击"刷新抓取"时默认走网络，避免命中历史缓存导致字幕错位。
    const forceRefresh = true;

    const preferred = pickPreferredSubtitle(state.subtitles, {
      previousId: state.selectedSubtitleId,
      previousUrl: state.selectedSubtitleUrl,
      previousLang: state.selectedSubtitleLang
    });

    if (!preferred) {
      throw new Error("这个视频暂时没有可用字幕。");
    }

    const candidates = buildSubtitleCandidates(state.subtitles, preferred);
    let selected = null;

    try {
      selected = await tryLoadSubtitleCandidates(candidates, runId, forceRefresh);
    } catch (error) {
      const message = getErrorMessage(error, "");
      if (!message.includes("HTTP") && error?.code !== "SUBTITLE_DURATION_MISMATCH") {
        throw error;
      }

      // Retry because subtitle signed URLs may expire quickly or hit rate limit.
      subtitleBundle = await retryAsync(
        () => fetchSubtitleBundle(state.bvid, state.cid, state.aid),
        2,
        500
      );
      ensureRunActive(runId);
      state.subtitles = normalizeSubtitleTracks(subtitleBundle.tracks);
      state.chapters = normalizeChapters(subtitleBundle.chapters);
      const retryPreferred = pickPreferredSubtitle(state.subtitles, {
        previousId: preferred.id,
        previousUrl: preferred.subtitleUrl,
        previousLang: preferred.lanDoc || preferred.lan || ""
      });
      if (!retryPreferred) {
        throw error;
      }
      const retryCandidates = buildSubtitleCandidates(state.subtitles, retryPreferred);
      selected = await tryLoadSubtitleCandidates(retryCandidates, runId, forceRefresh);
    }
    ensureRunActive(runId);
    if (selected) {
      logInfo("[BOC] selected subtitle track", {
        id: selected.id,
        lan: selected.lan,
        lanDoc: selected.lanDoc
      });
    }
    state.subtitleFetchState = "ready";
    renderMeta();
    renderSubtitleSelect();
    renderSeasonInfo();
    if (state.readingViewOpen) {
      moveReadingMainInline();
      renderReadingView();
      renderReadingStatus("抓取完成，阅读视图已同步最新字幕。");
      startReadingViewSync();
      startReaderPlayerObserver();
      syncReadingViewPlayback(true);
    }
    setStatus("抓取完成，可以复制、下载或发送到 Obsidian。");
  } catch (error) {
    if (isStaleRunError(error)) {
      return;
    }
    resetClipState();
    if (error?.code === "SUBTITLE_DURATION_MISMATCH") {
      setStatus("抓取失败：未找到与当前视频时长匹配的字幕轨，可能该视频无可用字幕。");
      return;
    }
    setStatus(`抓取失败：${getErrorMessage(error)}`);
  } finally {
    if (runId === state.fetchRunId) {
      setBusyState(false);
    }
  }
}

async function onSubtitleChange(event) {
  const value = event.target.value;
  const option = event.target.options[event.target.selectedIndex];
  const lang = option?.dataset.lang || "unknown";
  const subtitleId = option?.dataset.id || "";
  if (!value) {
    return;
  }

  try {
    setBusyState(true);
    setStatus(`正在切换字幕：${lang}`);
    setMessage("");
    await loadSubtitle(value, lang, state.fetchRunId, subtitleId);
    setStatus("字幕切换完成。");
  } catch (error) {
    if (isStaleRunError(error)) {
      return;
    }
    setStatus(`切换字幕失败：${getErrorMessage(error)}`);
  } finally {
    setBusyState(false);
  }
}

async function loadSubtitle(url, lang, runId = state.fetchRunId, subtitleId = "", forceRefresh = false) {
  if (!url) {
    throw new Error("字幕 URL 为空。");
  }

  const cacheKey = getSubtitleCacheKey({
    bvid: state.bvid,
    cid: state.cid,
    subtitleId,
    subtitleUrl: url,
    lang
  });

  // 尝试从缓存读取
  if (!forceRefresh) {
    const cachedBody = await loadSubtitleFromCache(cacheKey);
    if (cachedBody && Array.isArray(cachedBody) && cachedBody.length > 0) {
      const cachedCheck = validateSubtitleByDuration(cachedBody, state.videoDuration);
      if (!cachedCheck.ok) {
        logWarn("[BOC] cached subtitle duration mismatch, clearing cache", {
          cacheKey,
          reason: cachedCheck.reason
        });
        await clearSubtitleCacheByKey(cacheKey);
      } else {
        logInfo("[BOC] using cached subtitle", { cacheKey, itemCount: cachedBody.length });
        ensureRunActive(runId);
        state.selectedSubtitleId = subtitleId ? String(subtitleId) : state.selectedSubtitleId;
        state.selectedSubtitleUrl = url;
        state.selectedSubtitleLang = lang;
        state.subtitleBody = cachedBody;
        state.subtitleFetchState = "ready";
        state.markdown = buildMarkdown(state, cachedBody, state.settings);
        state.srt = buildSrt(cachedBody);
        state.txt = buildTxt(cachedBody, state.settings);
        byId(ids.preview).value = buildSubtitlePreview(cachedBody, state.settings);
        if (state.readingViewOpen) {
          renderReadingView();
          syncReadingViewPlayback(true);
        }
        return;
      }
    }
  }

  // 从网络获取
  const subtitle = await fetchSubtitleBody(url);
  ensureRunActive(runId);
  const body = Array.isArray(subtitle.body) ? subtitle.body : [];
  if (body.length === 0) {
    throw new Error("字幕文件为空。");
  }
  const durationCheck = validateSubtitleByDuration(body, state.videoDuration);
  if (!durationCheck.ok) {
    const mismatchError = new Error("字幕时长与当前视频不匹配。");
    mismatchError.code = "SUBTITLE_DURATION_MISMATCH";
    mismatchError.details = durationCheck;
    throw mismatchError;
  }

  // 存入缓存
  await saveSubtitleToCache(cacheKey, body);

  state.selectedSubtitleId = subtitleId ? String(subtitleId) : state.selectedSubtitleId;
  state.selectedSubtitleUrl = url;
  state.selectedSubtitleLang = lang;
  state.subtitleBody = body;
  state.subtitleFetchState = "ready";
  state.markdown = buildMarkdown(state, body, state.settings);
  state.srt = buildSrt(body);
  state.txt = buildTxt(body, state.settings);
  byId(ids.preview).value = buildSubtitlePreview(body, state.settings);
  if (state.readingViewOpen) {
    renderReadingView();
    syncReadingViewPlayback(true);
  }
}

function getSubtitleCacheKey({ bvid, cid, subtitleId = "", subtitleUrl = "", lang = "" }) {
  const sourceKey = buildSubtitleSourceKey(subtitleId, subtitleUrl, lang);
  return `${CACHE_KEY_PREFIX}${bvid}_${cid}_${sourceKey}`;
}

function buildSubtitleSourceKey(subtitleId, subtitleUrl, lang) {
  const id = String(subtitleId || "").trim();
  if (id) {
    return `id_${id}`;
  }

  const normalizedUrl = normalizeSubtitleUrlForCache(subtitleUrl);
  if (normalizedUrl) {
    return `url_${normalizedUrl}`;
  }

  return `lang_${String(lang || "").trim().toLowerCase() || "unknown"}`;
}

function normalizeSubtitleUrlForCache(url) {
  const text = String(url || "").trim();
  if (!text) {
    return "";
  }

  try {
    const parsed = new URL(text);
    const path = parsed.pathname.replace(/[^\w/.-]+/g, "_");
    return `${parsed.hostname}${path}`;
  } catch {
    return text.replace(/[^\w/.-]+/g, "_");
  }
}

async function loadSubtitleFromCache(cacheKey) {
  try {
    const result = await chrome.storage.local.get(cacheKey);
    return result[cacheKey]?.body || null;
  } catch {
    return null;
  }
}

async function saveSubtitleToCache(cacheKey, body) {
  try {
    await chrome.storage.local.set({
      [cacheKey]: {
        body,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    logWarn("[BOC] failed to save subtitle cache", error);
  }
}

async function clearSubtitleCacheByKey(cacheKey) {
  try {
    await chrome.storage.local.remove(cacheKey);
  } catch (error) {
    logWarn("[BOC] failed to clear subtitle cache by key", { cacheKey, error });
  }
}

async function clearSubtitleCache(bvid, cid, lang) {
  const cacheKey = getSubtitleCacheKey({ bvid, cid, lang });
  try {
    await chrome.storage.local.remove(cacheKey);
    logInfo("[BOC] cleared subtitle cache", { cacheKey });
  } catch (error) {
    logWarn("[BOC] failed to clear subtitle cache", error);
  }
}

function renderMeta() {
  const meta = byId(ids.meta);
  if (!state.bvid) {
    meta.innerHTML = '<div class="boc-meta-item">尚未抓取视频信息</div>';
    return;
  }

  const subtitleCount = state.subtitles.length;
  meta.innerHTML = `
    <div class="boc-meta-item"><strong>标题：</strong>${escapeHtml(state.title)}</div>
    <div class="boc-meta-item"><strong>URL：</strong>${escapeHtml(location.href)}</div>
    <div class="boc-meta-item"><strong>作者：</strong>${escapeHtml(state.author || "未知")}</div>
    <div class="boc-meta-item"><strong>日期：</strong>${escapeHtml(state.uploadDate || "未知")}</div>
    <div class="boc-meta-item"><strong>字幕轨：</strong>${subtitleCount}</div>
  `;
}

function renderTimestampModeSelect() {
  const select = byId(ids.timestampModeSelect);
  const mode = getTimestampMode(state.settings);
  select.value = mode;
}

function renderSubtitleSelect() {
  const select = byId(ids.subtitleSelect);
  const subtitles = state.subtitles || [];

  if (subtitles.length === 0) {
    select.innerHTML = '<option value="">暂无字幕</option>';
    select.disabled = true;
    return;
  }

  select.innerHTML = subtitles
    .map((item) => {
      const selectedById =
        state.selectedSubtitleId && String(item.id) === String(state.selectedSubtitleId);
      const selectedByUrl = item.subtitleUrl === state.selectedSubtitleUrl;
      const selected = selectedById || selectedByUrl ? "selected" : "";
      const label = item.lanDoc || item.lan || "unknown";
      const isAi = isAiSubtitle(item);
      const aiTag = isAi ? " [AI自动]" : "";
      const optionLabel = `${label}${aiTag}`;
      return `<option value="${escapeHtml(item.subtitleUrl)}" data-lang="${escapeHtml(
        label
      )}" data-id="${escapeHtml(String(item.id || ""))}" data-isai="${isAi}" ${selected}>${escapeHtml(
        optionLabel
      )}</option>`;
    })
    .join("");
  select.disabled = false;
}

function renderSeasonInfo() {
  const seasonBar = byId(ids.seasonBar);
  const seasonTitle = byId(ids.seasonTitle);
  const seasonProgress = byId(ids.seasonProgress);
  const seasonBtn = byId(ids.seasonBtn);
  const seasonSendBtn = byId(ids.seasonSendBtn);

  const hasSeason = state.seasonId && state.seasonEpisodes.length > 0;
  const total = state.seasonEpisodes.length;

  if (!hasSeason) {
    seasonBar.style.display = "none";
    return;
  }

  seasonBar.style.display = "";
  seasonTitle.textContent = `${state.seasonTitle}（共${total}集）`;

  const status = state.seasonStatus;
  const processed = state.seasonProcessed.filter((n) => !n.error).length;
  const failed = state.seasonProcessed.filter((n) => n.error).length;

  if (status === "idle") {
    seasonProgress.textContent = "";
    seasonBtn.textContent = "下载合集全部";
    seasonBtn.style.display = "";
    seasonBtn.disabled = false;
    seasonSendBtn.style.display = "none";
  } else if (status === "downloading") {
    const current = state.seasonProcessed.length;
    seasonProgress.textContent = `正在处理 ${current}/${total}...`;
    seasonBtn.textContent = "下载合集全部";
    seasonBtn.disabled = true;
    seasonSendBtn.style.display = "none";
  } else if (status === "done") {
    seasonProgress.textContent = `完成 ${processed}/${total}${failed > 0 ? `（${failed}集失败）` : ""}`;
    seasonBtn.textContent = "重新下载合集全部";
    seasonBtn.style.display = "";
    seasonBtn.disabled = false;
    seasonSendBtn.style.display = processed > 0 ? "" : "none";
    seasonSendBtn.textContent = `发送合集到 Obsidian（${processed}篇）`;
    seasonSendBtn.disabled = false;
  } else if (status === "sending") {
    seasonProgress.textContent = `正在发送到 Obsidian...`;
    seasonBtn.disabled = true;
    seasonSendBtn.disabled = true;
  } else if (status === "sent") {
    seasonProgress.textContent = `已全部发送到 Obsidian`;
    seasonBtn.disabled = false;
    seasonSendBtn.disabled = true;
    seasonSendBtn.textContent = "已发送";
  }
}

function getPopupPayload() {
  const subtitleOptions = (state.subtitles || []).map((item) => {
    const label = item.lanDoc || item.lan || "unknown";
    const isAi = isAiSubtitle(item);
    const selectedById =
      state.selectedSubtitleId && String(item.id) === String(state.selectedSubtitleId);
    const selectedByUrl = item.subtitleUrl === state.selectedSubtitleUrl;
    return {
      id: String(item.id || ""),
      url: item.subtitleUrl,
      lang: label,
      isAi,
      selected: selectedById || selectedByUrl
    };
  });

  return {
    url: location.href,
    title: state.title || "",
    author: state.author || "",
    uploadDate: state.uploadDate || "",
    tags: String(state.settings?.tags || ""),
    status: state.statusText || "",
    message: state.messageText || "",
    subtitlePreview: buildSubtitlePreview(state.subtitleBody || [], state.settings || DEFAULT_SETTINGS),
    markdown: state.markdown || "",
    srt: state.srt || "",
    txt: state.txt || "",
    downloadFormat: normalizeDownloadFormat(state.settings?.downloadFormat),
    timestampMode: getTimestampMode(state.settings),
    subtitleOptions,
    season: {
      id: state.seasonId || "",
      title: state.seasonTitle || "",
      totalEpisodes: state.seasonEpisodes.length,
      processedCount: state.seasonProcessed.length,
      successCount: state.seasonProcessed.filter((n) => !n.error).length,
      status: state.seasonStatus || "idle"
    },
    multiplePages: state.pageCount > 1,
    pageCount: state.pageCount,
    multiPageStatus: state.multiPageStatus
  };
}

async function copyMarkdown() {
  if (!state.markdown) {
    setMessage("没有可复制的内容，请先刷新抓取。");
    return;
  }

  try {
    await navigator.clipboard.writeText(state.markdown);
    setMessage("Markdown 已复制到剪贴板。");
  } catch (error) {
    setMessage(`复制失败：${getErrorMessage(error)}`);
  }
}

async function downloadSubtitle() {
  state.settings = await getSettings();
  const format = normalizeDownloadFormat(state.settings?.downloadFormat);
  const content = format === "txt" ? state.txt : state.srt;
  if (!content) {
    setMessage("没有可下载的字幕，请先刷新抓取。");
    return;
  }

  const safeTitle = sanitizeFileName(state.title || state.bvid || "bilibili-subtitle");
  const langSuffix = sanitizeFileName(state.selectedSubtitleLang || "subtitle") || "subtitle";
  const filename = `${safeTitle}.${langSuffix}.${format}`;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  setMessage(`已下载：${filename}`);
}

async function sendToObsidian(customPath = "") {
  state.settings = await getSettings();
  if (!state.markdown) {
    setMessage("没有可发送内容，请先刷新抓取。");
    return;
  }

  const filename = buildNoteFilename(state);
  const baseFolder = customPath || normalizeFolder(state.settings.noteFolder || "");
  const filepath = baseFolder ? `${baseFolder}/${filename}` : filename;
  const baseUrl = String(state.settings.obsidianApiBaseUrl || "").trim();
  const apiKey = String(state.settings.obsidianApiKey || "").trim();
  if (!baseUrl || !apiKey) {
    setMessage("请先在设置中填写 Obsidian Local REST API 地址和 API Key。");
    requestOpenOptions();
    return;
  }

  try {
    await writeNoteByLocalApi(baseUrl, apiKey, filepath, state.markdown);
    setMessage(`已写入 Obsidian：${filepath}`);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      setMessage("扩展刚刚更新，请刷新当前页面后重试。");
      return;
    }
    setMessage(`写入失败：${getErrorMessage(error)}`);
  }
}

async function writeNoteByLocalApi(baseUrl, apiKey, filepath, content) {
  const resp = await sendRuntimeMessage({
    type: "write-obsidian-note",
    baseUrl,
    apiKey,
    filepath,
    content
  });
  if (!resp?.ok) {
    throw new Error(toReadableText(resp?.error, "Local API 写入失败"));
  }
}

/**
 * 批量抓取合集所有集数的字幕，每集生成独立 Markdown 并存入 state.seasonProcessed。
 * 处理过程中面板显示逐集进度，完成后弹出"发送合集到 Obsidian"按钮。
 */
async function downloadAllSeasonEpisodes(customPath = "") {
  if (state.seasonStatus === "downloading" || state.seasonStatus === "sending") {
    setMessage("合集正在处理中，请等待完成。");
    return;
  }

  const episodes = state.seasonEpisodes;
  if (!episodes || episodes.length === 0) {
    setMessage("当前视频不在合集中，或合集信息为空。");
    return;
  }

  state.seasonStatus = "downloading";
  state.seasonProcessed = [];
  state.stopRequested = false;
  renderSeasonInfo();
  setBusyState(true);
  setMessage("");
  updateBatchProgress(0, episodes.length);

  const settings = state.settings || DEFAULT_SETTINGS;

  for (let i = 0; i < episodes.length; i++) {
    if (state.stopRequested) {
      break;
    }

    const ep = episodes[i];
    const label = `[${i + 1}/${episodes.length}] ${ep.title || ep.bvid}`;
    setStatus(`正在处理 ${label}`);

    try {
      ensurePageActive();
      // 1. 获取该集的字幕列表
      const bundle = await retryAsync(
        () => fetchSubtitleBundle(ep.bvid, ep.cid, ep.aid),
        2,
        500
      );
      ensurePageActive();

      const tracks = normalizeSubtitleTracks(bundle.tracks);
      if (tracks.length === 0) {
        state.seasonProcessed.push({ title: ep.title, bvid: ep.bvid, error: "该视频无可用字幕" });
        updateBatchProgress(i + 1, episodes.length);
        await sleep(800);
        renderSeasonInfo();
        continue;
      }

      // 2. 选最佳字幕轨道
      const preferred = pickPreferredSubtitle(tracks, {});
      const candidates = buildSubtitleCandidates(tracks, preferred);

      // 3. 尝试加载字幕
      let loaded = null;
      for (const candidate of candidates) {
        try {
          const body = await fetchSubtitleBody(candidate.subtitleUrl);
          ensurePageActive();
          const bodyArr = Array.isArray(body?.body) ? body.body : Array.isArray(body) ? body : [];
          if (bodyArr.length === 0) continue;
          const durationCheck = validateSubtitleByDuration(bodyArr, ep.duration);
          if (!durationCheck.ok) continue;

          loaded = {
            body: bodyArr,
            lang: candidate.lanDoc || candidate.lan || "unknown",
            subtitleId: candidate.id,
            subtitleUrl: candidate.subtitleUrl
          };
          break;
        } catch {
          continue;
        }
      }

      if (!loaded) {
        state.seasonProcessed.push({ title: ep.title, bvid: ep.bvid, error: "无法加载可用字幕" });
        updateBatchProgress(i + 1, episodes.length);
        await sleep(800);
        renderSeasonInfo();
        continue;
      }

      // 4. 构成本集 Markdown
      const episodeUrl = `https://www.bilibili.com/video/${ep.bvid}`;
      const episodeMeta = {
        bvid: ep.bvid,
        aid: ep.aid,
        cid: ep.cid,
        title: ep.title || "未知标题",
        author: state.author || "",
        uploadDate: state.uploadDate || "",
        description: "",
        selectedSubtitleLang: loaded.lang,
        chapters: normalizeChapters(bundle.chapters),
        videoDuration: ep.duration,
        pageCount: 1,
        pageIndex: 1,
        pageTitle: ""
      };

      _episodeUrlOverride = episodeUrl;
      const markdown = buildMarkdown(episodeMeta, loaded.body, settings);
      const srt = buildSrt(loaded.body);
      const txt = buildTxt(loaded.body, settings);
      _episodeUrlOverride = "";

      const safeSeasonName = sanitizeFileName(state.seasonTitle || "合集");
      const safeEpisodeTitle = sanitizeFileName(ep.title || ep.bvid || "未知标题");
      const filepath = `${safeSeasonName}/P${i + 1} - ${safeEpisodeTitle}.md`;

      state.seasonProcessed.push({
        title: ep.title,
        bvid: ep.bvid,
        filepath,
        markdown,
        srt,
        txt,
        subtitleLang: loaded.lang
      });

      setMessage(`第 ${i + 1} 集字幕已抓取`);
    } catch (error) {
      if (isStaleRunError(error)) {
        state.seasonStatus = "idle";
        renderSeasonInfo();
        setBusyState(false);
        updateBatchProgress(0, 0);
        setStatus("合集处理已中止（页面已切换）");
        return;
      }
      state.seasonProcessed.push({ title: ep.title, bvid: ep.bvid, error: getErrorMessage(error) });
      setMessage(`第 ${i + 1} 集处理失败：${getErrorMessage(error)}`);
    }

    // 防止 B 站 API 速率限制
    updateBatchProgress(i + 1, episodes.length);
    await sleep(800);
    renderSeasonInfo();
  }

  const wasStopped = state.stopRequested;
  state.stopRequested = false;
  state.seasonStatus = wasStopped ? "idle" : "done";
  const successCount = state.seasonProcessed.filter((n) => !n.error).length;
  const failCount = state.seasonProcessed.filter((n) => n.error).length;
  setBusyState(false);
  updateBatchProgress(0, 0);
  renderSeasonInfo();

  if (wasStopped) {
    setStatus(`合集下载已停止（成功 ${successCount} 集${failCount > 0 ? `，${failCount} 集失败` : ""}）`);
    return;
  }

  if (successCount === 0) {
    setStatus(
      `合集处理完成：全部 ${failCount} 集均无可用字幕`
    );
    return;
  }

  // 自动发送到 Obsidian（如果已配置 API）
  const baseUrl = String(state.settings?.obsidianApiBaseUrl || "").trim();
  const apiKey = String(state.settings?.obsidianApiKey || "").trim();
  if (baseUrl && apiKey) {
    setStatus(
      `合集抓取完成：成功 ${successCount} 集${failCount > 0 ? `，${failCount} 集失败` : ""}，正在写入 Obsidian...`
    );
    await sendSeasonToObsidian(customPath);
  } else {
    setStatus(
      `合集抓取完成：成功 ${successCount} 集${failCount > 0 ? `，${failCount} 集失败` : ""}`
    );
    setMessage("请先在设置中填写 Obsidian Local REST API 地址和 Key");
    requestOpenOptions();
  }
}

/**
 * 查询 Obsidian 指定目录下的已有 .md 文件列表。
 * 目录不存在时返回空数组（不报错）。
 */
async function checkExistingObsidianFiles(dirPath) {
  const settings = await getSettings();
  const baseUrl = String(settings.obsidianApiBaseUrl || "").trim();
  const apiKey = String(settings.obsidianApiKey || "").trim();
  if (!baseUrl || !apiKey) {
    return [];
  }
  try {
    const resp = await sendRuntimeMessage({
      type: "list-obsidian-dir",
      baseUrl,
      apiKey,
      dirPath
    });
    if (!resp?.ok) return [];
    return Array.isArray(resp.files) ? resp.files : [];
  } catch {
    return [];
  }
}

/**
 * 将合集每集笔记逐篇写入 Obsidian，按合集名建文件夹。
 * 每篇独立发送，间隔 300ms 避免 Local REST API 过载。
 */
async function sendSeasonToObsidian(customPath = "") {
  if (state.seasonStatus === "sending") {
    setMessage("正在发送中，请等待完成。");
    return;
  }

  const notes = state.seasonProcessed.filter((n) => !n.error);
  if (notes.length === 0) {
    setMessage("合集处理未完成，请先点击\"下载合集全部\"。");
    return;
  }

  const settings = await getSettings();
  const baseUrl = String(settings.obsidianApiBaseUrl || "").trim();
  const apiKey = String(settings.obsidianApiKey || "").trim();
  if (!baseUrl || !apiKey) {
    setMessage("请先在设置中填写 Obsidian Local REST API 地址和 API Key。");
    requestOpenOptions();
    return;
  }

  const baseFolder = customPath || normalizeFolder(settings.noteFolder || "");

  state.seasonStatus = "sending";
  renderSeasonInfo();
  setBusyState(true);
  setMessage("");

  let successCount = 0;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const filepath = baseFolder ? `${baseFolder}/${note.filepath}` : note.filepath;
    const label = `[${i + 1}/${notes.length}] ${note.title || note.bvid}`;

    try {
      await writeNoteByLocalApi(baseUrl, apiKey, filepath, note.markdown);
      successCount++;
      setMessage(`已写入：${filepath}`);
      setStatus(`正在发送 ${label}`);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        setMessage("扩展刚刚更新，请刷新当前页面后重试。");
        state.seasonStatus = "done";
        renderSeasonInfo();
        setBusyState(false);
        return;
      }
      setMessage(`写入失败 ${note.filepath}：${getErrorMessage(error)}`);
    }

    await sleep(300);
  }

  state.seasonStatus = "sent";
  setBusyState(false);
  renderSeasonInfo();
  setStatus(
    `合集已全部发送到 Obsidian（${successCount}/${notes.length} 篇成功）`
  );
  if (successCount < notes.length) {
    setMessage(`${notes.length - successCount} 篇写入失败，请检查 Local REST API 状态`);
  }
}

/**
 * 下载多P视频的全部页面字幕，逐页获取并直接写入 Obsidian。
 * 适用于一个 BV 号下包含多个分P的视频（如课程、系列讲座）。
 */
async function downloadAllPages(customPath = "") {
  const pages = state.pages;
  if (!pages || pages.length === 0) {
    setMessage("没有可下载的多P数据，请先刷新抓取。");
    return;
  }

  const settings = state.settings || DEFAULT_SETTINGS;
  const baseUrl = String(settings.obsidianApiBaseUrl || "").trim();
  const apiKey = String(settings.obsidianApiKey || "").trim();
  if (!baseUrl || !apiKey) {
    setMessage("请先在设置中填写 Obsidian Local REST API 地址和 API Key。");
    requestOpenOptions();
    return;
  }

  const baseFolder = customPath || normalizeFolder(settings.noteFolder || "");

  state.multiPageStatus = "downloading";
  state.stopRequested = false;
  setBusyState(true);
  setMessage("");
  updateBatchProgress(0, pages.length);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pages.length; i++) {
    if (state.stopRequested) {
      break;
    }

    const page = pages[i];
    const label = `[${i + 1}/${pages.length}] ${page.part || `P${page.page}`}`;
    setStatus(`正在处理 ${label}`);

    try {
      ensurePageActive();

      // 1. 获取该P的字幕列表
      const bundle = await retryAsync(
        () => fetchSubtitleBundle(state.bvid, page.cid, state.aid),
        2,
        500
      );
      ensurePageActive();

      const tracks = normalizeSubtitleTracks(bundle.tracks);
      if (tracks.length === 0) {
        failCount++;
        setMessage(`P${page.page} 无可用字幕`);
        updateBatchProgress(i + 1, pages.length);
        await sleep(800);
        continue;
      }

      // 2. 选最佳字幕轨道
      const preferred = pickPreferredSubtitle(tracks, {});
      const candidates = buildSubtitleCandidates(tracks, preferred);

      // 3. 尝试加载字幕
      let loaded = null;
      for (const candidate of candidates) {
        try {
          const body = await fetchSubtitleBody(candidate.subtitleUrl);
          ensurePageActive();
          const bodyArr = Array.isArray(body?.body) ? body.body : Array.isArray(body) ? body : [];
          if (bodyArr.length === 0) continue;
          const durationCheck = validateSubtitleByDuration(bodyArr, page.duration);
          if (!durationCheck.ok) continue;

          loaded = {
            body: bodyArr,
            lang: candidate.lanDoc || candidate.lan || "unknown",
            subtitleId: candidate.id,
            subtitleUrl: candidate.subtitleUrl
          };
          break;
        } catch {
          continue;
        }
      }

      if (!loaded) {
        failCount++;
        setMessage(`P${page.page} 无法加载可用字幕`);
        updateBatchProgress(i + 1, pages.length);
        await sleep(800);
        continue;
      }

      // 4. 构成本P的 Markdown
      const pageUrl = `https://www.bilibili.com/video/${state.bvid}?p=${page.page}`;
      const pageMeta = {
        bvid: state.bvid,
        aid: state.aid,
        cid: page.cid,
        title: state.title,
        author: state.author,
        uploadDate: state.uploadDate,
        description: state.description,
        selectedSubtitleLang: loaded.lang,
        chapters: normalizeChapters(bundle.chapters),
        videoDuration: page.duration,
        pageCount: pages.length,
        pageIndex: page.page,
        pageTitle: page.part
      };

      _episodeUrlOverride = pageUrl;
      const markdown = buildMarkdown(pageMeta, loaded.body, settings);
      _episodeUrlOverride = "";

      // 5. 生成文件名并写入 Obsidian
      const filename = buildNoteFilename(pageMeta);
      const filepath = baseFolder ? `${baseFolder}/${filename}` : filename;
      await writeNoteByLocalApi(baseUrl, apiKey, filepath, markdown);

      successCount++;
      setMessage(`已写入：${filename}`);
    } catch (error) {
      if (isStaleRunError(error)) {
        state.multiPageStatus = "idle";
        setBusyState(false);
        updateBatchProgress(0, 0);
        setStatus("多P下载已中止（页面已切换）");
        return;
      }
      failCount++;
      setMessage(`P${page.page} 处理失败：${getErrorMessage(error)}`);
    }

    updateBatchProgress(i + 1, pages.length);
    await sleep(800);
  }

  state.multiPageStatus = "idle";
  setBusyState(false);
  updateBatchProgress(0, 0);

  if (state.stopRequested) {
    setStatus(`多P下载已停止（已完成 ${successCount} P${failCount > 0 ? `，${failCount} P 失败` : ""}）`);
    state.stopRequested = false;
  } else if (successCount > 0) {
    setStatus(`多P下载完成：成功 ${successCount} P${failCount > 0 ? `，${failCount} P 失败` : ""}`);
  } else {
    setStatus(`多P下载完成：全部 ${failCount} P 均无可用字幕`);
  }
}

/**
 * 将 UP 主每集笔记逐篇写入 Obsidian，按 UP 主名建文件夹。
 */
function setBusyState(disabled) {
  byId(ids.copyBtn).disabled = disabled;
  byId(ids.downloadBtn).disabled = disabled;
  byId(ids.sendBtn).disabled = disabled;
  byId(ids.refreshBtn).disabled = disabled;
  byId(ids.settingsBtn).disabled = disabled;
  byId(ids.subtitleSelect).disabled = disabled || state.subtitles.length === 0;
}

function setStatus(text) {
  state.statusText = String(text || "");
  byId(ids.status).textContent = state.statusText;
}

function setMessage(text) {
  state.messageText = String(text || "");
  byId(ids.message).textContent = state.messageText;
}

function toReadableText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text === "[object Object]") {
      return fallback;
    }
    return text;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const json = JSON.stringify(value);
    if (json && json !== "{}") {
      return json;
    }
  } catch {
    // ignore
  }
  const text = String(value);
  if (!text || text === "[object Object]") {
    return fallback;
  }
  return text;
}

function getErrorMessage(error, fallback = "未知错误") {
  const code = toReadableText(error?.code, "");
  const message = toReadableText(error?.message, "");
  if (message) {
    return code ? `${message} (code: ${code})` : message;
  }
  if (code) {
    return `code: ${code}`;
  }
  return toReadableText(error, fallback);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function isExtensionContextInvalidated(error) {
  const msg = String(error?.message || "");
  return msg.includes("Extension context invalidated");
}

/**
 * 侧边栏时间戳模式切换 —— 实时更新预览和 markdown/srt/txt
 */
function onTimestampModeChange(event) {
  const newMode = String(event.target.value || "").trim();
  if (newMode !== "hidden" && newMode !== "plain" && newMode !== "media-extended") {
    return;
  }
  state.settings.timestampMode = newMode;
  // 同时更新旧字段以保持兼容
  state.settings.includeTimestampInBody = newMode !== "hidden";

  // 如果有已加载的字幕，重新生成所有输出格式
  if (state.subtitleBody.length > 0) {
    state.markdown = buildMarkdown(state, state.subtitleBody, state.settings);
    state.srt = buildSrt(state.subtitleBody);
    state.txt = buildTxt(state.subtitleBody, state.settings);
    byId(ids.preview).value = buildSubtitlePreview(state.subtitleBody, state.settings);
  }

  // 持久化到 storage
  persistTimestampMode(newMode).catch(() => {});
}

/**
 * 仅写入 timestampMode 到 storage（不覆盖整个 settings）
 */
async function persistTimestampMode(mode) {
  try {
    await chrome.storage.sync.set({ timestampMode: mode });
  } catch {
    // 静默失败，不影响使用
  }
}

function requestOpenOptions() {
  sendRuntimeMessage({ type: "open-options" })
    .then((resp) => {
      if (!resp?.ok) {
        setMessage(`打开设置失败：${toReadableText(resp?.error, "未知错误")}`);
      }
    })
    .catch((error) => {
      if (isExtensionContextInvalidated(error)) {
        setMessage("扩展刚刚更新，请刷新当前页面后重试。");
        return;
      }
      setMessage(`打开设置失败：${getErrorMessage(error)}`);
    });
}

async function getSettings() {
  try {
    const response = await sendRuntimeMessage({ type: "get-settings" });
    if (!response?.ok) {
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...(response.settings || {}) };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function byId(id) {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing node: ${id}`);
  }
  return node;
}

function extractBvid(url) {
  const match = url.match(/\/video\/(BV[0-9A-Za-z]+)/);
  if (match?.[1]) {
    return match[1];
  }

  try {
    const parsed = new URL(url);
    const fromQuery = String(parsed.searchParams.get("bvid") || "").trim();
    if (/^BV[0-9A-Za-z]+$/.test(fromQuery)) {
      return fromQuery;
    }
  } catch {
    // ignore invalid URL
  }

  return "";
}

function extractPageIndex(url) {
  try {
    const page = Number(new URL(url).searchParams.get("p") || "1");
    if (!Number.isFinite(page) || page <= 0) {
      return 1;
    }
    return page;
  } catch {
    return 1;
  }
}

function hasExplicitPageParam(url) {
  try {
    return new URL(url).searchParams.has("p");
  } catch {
    return false;
  }
}

function extractOid(url) {
  try {
    return String(new URL(url).searchParams.get("oid") || "").trim();
  } catch {
    return "";
  }
}

function ensureRunActive(runId) {
  if (runId !== state.fetchRunId) {
    const error = new Error("Stale refresh run");
    error.code = "STALE_RUN";
    throw error;
  }
}

function isStaleRunError(error) {
  return error?.code === "STALE_RUN";
}

/**
 * 检查页面 URL 是否发生变化（用于批量下载操作的活跃性守卫）。
 * 与 ensureRunActive 不同，此函数不依赖 fetchRunId，
 * 因此不会因弹窗刷新（popup-refresh）而误中止后台批量任务。
 * 仅在用户导航到其他页面时才会抛出 STALE_RUN 错误。
 */
function ensurePageActive() {
  if (location.href !== state.currentUrl) {
    const error = new Error("Stale refresh run");
    error.code = "STALE_RUN";
    throw error;
  }
}

async function retryAsync(task, retries = 1, delayMs = 180) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      // 如果不是网络错误也不是可重试的业务错误，立即抛出
      const isNetworkError = isRetryableNetworkError(error);
      const isRetryable = error?.retryable === true;
      if (!isNetworkError && !isRetryable) {
        throw error;
      }
      if (attempt >= retries) {
        throw error;
      }
      // 指数退避：delayMs * 2^(attempt-1)，最多等待 5 秒
      const backoffDelay = Math.min(delayMs * Math.pow(2, attempt - 1), 5000);
      logInfo(`[BOC] retrying after ${backoffDelay}ms, attempt ${attempt + 1}/${retries}`, {
        error: getErrorMessage(error),
        code: error.code
      });
      await sleep(backoffDelay);
    }
  }
  throw lastError || new Error("Unknown retry error");
}

function isRetryableNetworkError(error) {
  const message = getErrorMessage(error, "").toLowerCase();
  if (!message) {
    return false;
  }

  if (message.includes("http ")) {
    return true;
  }

  return (
    message.includes("请求失败") ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    message.includes("net::") ||
    message.includes("background fetch failed") ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
}

async function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchVideoMeta(bvid) {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  logInfo("[BOC] fetch video meta", { url, bvid });
  const payload = await fetchJson(url);
  if (payload.code !== 0) {
    throw new Error(toReadableText(payload?.message, "无法获取视频信息"));
  }

  const data = payload.data || {};
  const pubdate = Number(data.pubdate || 0);
  const uploadDate = pubdate > 0 ? formatLocalDate(pubdate * 1000) : "";
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const ugcSeason = data.ugc_season || null;

  return {
    aid: data.aid ? String(data.aid) : "",
    title: String(data.title || ""),
    author: String(data.owner?.name || ""),
    description: String(data.desc || ""),
    uploadDate,
    defaultCid: data.cid ? String(data.cid) : "",
    defaultDuration: Number(data.duration || 0) || 0,
    pages: pages.map((item) => ({
      cid: String(item.cid || ""),
      page: Number(item.page || 0) || 0,
      part: String(item.part || "").trim(),
      duration: Number(item.duration || 0) || 0
    })),
    // 合集（UGC Season）信息
    seasonId: String(ugcSeason?.id || ""),
    seasonTitle: String(ugcSeason?.title || ""),
    seasonEpisodes: parseEpisodesFromSections(ugcSeason?.sections || [])
  };
}

/**
 * 解析合集 sections 中的 episodes 列表。
 * B 站合集结构：sections[] → section.episodes[] → {aid, bvid, cid, title, page, duration}
 * 同一视频可能出现在多个 section，需要去重。
 */
function parseEpisodesFromSections(sections) {
  const seen = new Set();
  const episodes = [];
  const safeSections = Array.isArray(sections) ? sections : [];

  for (const section of safeSections) {
    const sectionEpisodes = Array.isArray(section?.episodes) ? section.episodes : [];
    for (const ep of sectionEpisodes) {
      const bvid = String(ep?.bvid || "").trim();
      if (!bvid) {
        continue;
      }
      // 按 bvid 去重
      if (seen.has(bvid)) {
        continue;
      }
      seen.add(bvid);

      const arc = ep?.arc || {};
      const page = ep?.page || {};
      episodes.push({
        aid: String(arc?.aid || ep?.aid || ""),
        bvid,
        cid: String(page?.cid || ep?.cid || ""),
        title: String(ep?.title || arc?.title || "").trim(),
        page: Number(page?.page || ep?.page || 1) || 1,
        duration: Number(arc?.duration || page?.duration || 0) || 0
      });
    }
  }

  return episodes;
}

function pickPageFromPages(pages, pageIndex) {
  const safePageIndex = Number(pageIndex) > 0 ? Number(pageIndex) : 1;
  const safePages = Array.isArray(pages) ? pages : [];
  const pageByIndex = safePages[safePageIndex - 1];
  if (pageByIndex?.cid) {
    return pageByIndex;
  }

  const pageByNo = safePages.find((item) => Number(item.page) === safePageIndex);
  if (pageByNo?.cid) {
    return pageByNo;
  }

  return null;
}

function pickCidFromPages(pages, pageIndex, fallbackCid = "") {
  const matchedPage = pickPageFromPages(pages, pageIndex);
  if (matchedPage?.cid) {
    return String(matchedPage.cid);
  }

  const safePages = Array.isArray(pages) ? pages : [];
  if (safePages[0]?.cid) {
    return String(safePages[0].cid);
  }

  if (fallbackCid) {
    return String(fallbackCid);
  }

  throw new Error("没有找到当前分P的 CID。");
}

function pickPageIndexFromOid(pages, oid) {
  const safeOid = String(oid || "").trim();
  if (!safeOid) {
    return 0;
  }

  const safePages = Array.isArray(pages) ? pages : [];
  const pageByCid = safePages.find((item) => String(item?.cid || "") === safeOid);
  if (pageByCid?.page) {
    return Number(pageByCid.page) || 0;
  }

  return 0;
}

function pickDurationFromPages(pages, pageIndex, fallbackDuration = 0) {
  const matchedPage = pickPageFromPages(pages, pageIndex);
  if (Number(matchedPage?.duration) > 0) {
    return Number(matchedPage.duration);
  }

  const safePages = Array.isArray(pages) ? pages : [];
  if (Number(safePages[0]?.duration) > 0) {
    return Number(safePages[0].duration);
  }

  return Number(fallbackDuration || 0) || 0;
}

function readVideoTitle() {
  const h1 = document.querySelector("h1.video-title");
  if (h1?.textContent?.trim()) {
    return h1.textContent.trim();
  }

  const metaTitle = document.querySelector('meta[property="og:title"]');
  if (metaTitle?.getAttribute("content")) {
    return metaTitle.getAttribute("content").trim();
  }

  return document.title.replace(/_哔哩哔哩_bilibili/i, "").trim();
}

function readVideoAuthor() {
  const owner = document.querySelector(".up-name");
  if (owner?.textContent?.trim()) {
    return owner.textContent.trim();
  }

  const author = document.querySelector('meta[name="author"]');
  return author?.getAttribute("content")?.trim() || "";
}

function readUploadDate() {
  const publishNode = document.querySelector('meta[itemprop="uploadDate"]');
  if (publishNode?.getAttribute("content")) {
    return publishNode.getAttribute("content").trim();
  }

  const dateText = document.querySelector(".pubdate-ip-text")?.textContent?.trim();
  if (dateText) {
    return dateText;
  }

  return formatLocalDate();
}

async function fetchSubtitleBundle(bvid, cid, aid = "") {
  const requests = buildSubtitleInfoRequests({ bvid, cid, aid });
  const fetchByRequest = async (request) => {
    logInfo("[BOC] fetch subtitles list", {
      source: request.source,
      url: request.url,
      bvid,
      cid,
      aid
    });

    const payload = await fetchJson(request.url);
    logInfo("[BOC] subtitles API raw response", { source: request.source, payload });
    if (payload.code !== 0) {
      throw buildBiliApiError(payload, "无法获取字幕列表");
    }

    const chapters = mapChaptersFromPlayerData(payload.data);
    const subtitles = mapSubtitleTracks(payload.data?.subtitle?.subtitles || [], request.source);
    const withUrl = subtitles.filter((item) => item.subtitleUrl);
    return { source: request.source, chapters, withUrl };
  };

  if (requests.length === 0) {
    return { tracks: [], chapters: [] };
  }

  const primaryRequest = requests[0];
  try {
    const primaryResult = await fetchByRequest(primaryRequest);
    if (primaryResult.withUrl.length > 0) {
      return { tracks: primaryResult.withUrl, chapters: primaryResult.chapters };
    }
    // 主来源成功但无字幕：直接判定无字幕，不再跨源兜底。
    return { tracks: [], chapters: primaryResult.chapters };
  } catch (primaryError) {
    logWarn("[BOC] subtitles API request failed", {
      source: primaryRequest.source,
      message: getErrorMessage(primaryError)
    });

    // 仅当主来源请求失败时才尝试次来源。
    if (requests.length > 1) {
      const secondaryRequest = requests[1];
      try {
        const secondaryResult = await fetchByRequest(secondaryRequest);
        if (secondaryResult.withUrl.length > 0) {
          logWarn("[BOC] primary subtitles source failed, using fallback source", {
            primary: primaryRequest.source,
            fallback: secondaryRequest.source
          });
          return { tracks: secondaryResult.withUrl, chapters: secondaryResult.chapters };
        }
        return { tracks: [], chapters: secondaryResult.chapters };
      } catch (secondaryError) {
        logWarn("[BOC] fallback subtitles source failed", {
          source: secondaryRequest.source,
          message: getErrorMessage(secondaryError)
        });
        throw secondaryError;
      }
    }

    throw primaryError;
  }
}

function buildSubtitleInfoRequests({ bvid, cid, aid }) {
  const safeBvid = encodeURIComponent(String(bvid || ""));
  const safeCid = encodeURIComponent(String(cid || ""));
  const safeAid = encodeURIComponent(String(aid || ""));
  const requests = [];

  // 参考 SubBatch：优先用 aid+cid 的 wbi 接口作为主来源。
  if (aid) {
    requests.push({
      source: "player-wbi-v2",
      url:
        "https://api.bilibili.com/x/player/wbi/v2" +
        `?aid=${safeAid}` +
        `&cid=${safeCid}` +
        (bvid ? `&bvid=${safeBvid}` : "")
    });
  }

  // 仅在主来源不可用时再回退到 player-v2。
  requests.push({
    source: "player-v2",
    url:
      "https://api.bilibili.com/x/player/v2" +
      (bvid ? `?bvid=${safeBvid}` : "?") +
      `${bvid ? "&" : ""}cid=${safeCid}` +
      (aid ? `&aid=${safeAid}` : "")
  });

  return requests;
}

function buildBiliApiError(payload, fallbackMessage) {
  const msg = toReadableText(payload?.message, fallbackMessage);
  const error = new Error(msg);
  error.code = payload?.code;
  error.retryable = isRetryableError(payload?.code);
  return error;
}

function mapSubtitleTracks(subtitles, source = "unknown") {
  return (subtitles || []).map((item) => ({
    id: item?.id === undefined || item?.id === null ? "" : String(item.id),
    lan: item?.lan || "",
    lanDoc: item?.lan_doc || "",
    subtitleUrl: normalizeSubtitleUrl(item?.subtitle_url || ""),
    source
  }));
}

function mapChaptersFromPlayerData(data) {
  const raw = Array.isArray(data?.view_points) ? data.view_points : [];
  return normalizeChapters(
    raw.map((item) => ({
      title: String(item?.content || item?.title || item?.label || "").trim(),
      from: normalizeChapterTime(item?.from ?? item?.start ?? item?.start_time),
      to: normalizeChapterTime(item?.to ?? item?.end ?? item?.end_time),
      source: "player-view-points"
    }))
  );
}

function normalizeChapterTime(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return 0;
  }

  // 某些接口会返回毫秒级时间戳，这里统一转换成秒。
  return num > 60 * 60 * 24 ? num / 1000 : num;
}

function normalizeChapters(chapters) {
  const normalized = (chapters || [])
    .map((item) => ({
      title: String(item?.title || "").trim(),
      from: Number(item?.from || 0) || 0,
      to: Number(item?.to || 0) || 0,
      source: String(item?.source || "")
    }))
    .filter((item) => item.title && item.from >= 0)
    .sort((a, b) => a.from - b.from);

  const unique = [];
  const seen = new Set();
  normalized.forEach((item) => {
    const key = `${Math.floor(item.from * 10)}|${item.title.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    unique.push(item);
  });

  return unique;
}

function isRetryableError(code) {
  // -509: 请求过于频繁
  // -3: 参数错误（可能是临时性的）
  // 其他负数错误码也可能是临时性的
  return code === -509 || code === -3 || code < 0;
}

function normalizeSubtitleTracks(subtitles) {
  return [...(subtitles || [])].sort((a, b) => {
    const p = subtitlePriority(a) - subtitlePriority(b);
    if (p !== 0) {
      return p;
    }

    const lanA = String(a.lanDoc || a.lan || "").toLowerCase();
    const lanB = String(b.lanDoc || b.lan || "").toLowerCase();
    if (lanA < lanB) {
      return -1;
    }
    if (lanA > lanB) {
      return 1;
    }

    const idA = Number.parseInt(String(a.id || "0"), 10);
    const idB = Number.parseInt(String(b.id || "0"), 10);
    if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) {
      return idA - idB;
    }

    return String(a.subtitleUrl).localeCompare(String(b.subtitleUrl));
  });
}

function pickPreferredSubtitle(
  subtitles,
  { previousId = "", previousUrl = "", previousLang = "" } = {}
) {
  const tracks = subtitles || [];
  if (tracks.length === 0) {
    return null;
  }

  // 先按轨道 id 复用，最稳定
  if (previousId) {
    const byId = tracks.find((item) => String(item.id || "") === String(previousId));
    if (byId) {
      return byId;
    }
  }

  // 其次按 URL 路径复用（忽略 auth_key 等动态参数）
  const prevUrlKey = normalizeSubtitleUrlForCache(previousUrl);
  if (prevUrlKey) {
    const byUrl = tracks.find(
      (item) => normalizeSubtitleUrlForCache(item.subtitleUrl) === prevUrlKey
    );
    if (byUrl) {
      return byUrl;
    }
  }

  const normalizedPrevLang = String(previousLang || "").trim().toLowerCase();
  if (normalizedPrevLang) {
    const byLang = tracks.find((item) => {
      const label = String(item.lanDoc || item.lan || "").trim().toLowerCase();
      return label === normalizedPrevLang;
    });
    if (byLang) {
      return byLang;
    }
  }

  // 默认直接拿排序后的第一条：中文优先，其次英文。
  return tracks[0];
}

function buildSubtitleCandidates(subtitles, preferred) {
  const tracks = subtitles || [];
  const seen = new Set();
  const list = [];

  const pushUnique = (item) => {
    if (!item) {
      return;
    }
    const key =
      `${String(item.id || "").trim()}|` +
      `${normalizeSubtitleUrlForCache(item.subtitleUrl)}|` +
      `${String(item.lan || "").trim().toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    list.push(item);
  };

  pushUnique(preferred);
  for (const item of tracks) {
    pushUnique(item);
  }
  return list;
}

async function tryLoadSubtitleCandidates(candidates, runId, forceRefresh) {
  let lastError = null;
  for (const item of candidates || []) {
    try {
      logInfo("[BOC] try subtitle track", {
        id: item.id,
        lan: item.lan,
        lanDoc: item.lanDoc,
        url: item.subtitleUrl
      });
      await loadSubtitle(
        item.subtitleUrl,
        item.lanDoc || item.lan || "unknown",
        runId,
        item.id,
        forceRefresh
      );
      return item;
    } catch (error) {
      lastError = error;
      const reasonCode = toReadableText(error?.code, "");
      const reasonMessage = getErrorMessage(error, "unknown");
      const meta = {
        id: item.id,
        lan: item.lan,
        lanDoc: item.lanDoc,
        reason: reasonCode || reasonMessage
      };
      if (reasonCode === "SUBTITLE_DURATION_MISMATCH") {
        logInfo(`[BOC] subtitle track skipped ${JSON.stringify(meta)}`);
      } else {
        logWarn(`[BOC] subtitle track rejected ${JSON.stringify(meta)}`);
      }
      ensureRunActive(runId);
      continue;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("这个视频暂时没有可用字幕。");
}

function isAiSubtitle(item) {
  const lan = String(item?.lan || "").toLowerCase();
  // B站 AI 自动字幕的 lan 以 "ai-" 开头
  return lan.startsWith("ai-");
}

function subtitlePriority(item) {
  const lan = String(item?.lan || "").toLowerCase();
  const label = String(item?.lanDoc || "").toLowerCase();

  // 优先级：中文（包含 AI 中文）-> 英文 -> 其他
  if (lan === "zh-cn" || lan === "zh-hans") {
    return 0;
  }
  if (lan === "zh") {
    return 1;
  }
  if (lan.includes("zh")) {
    return 2;
  }
  if (label.includes("中文")) {
    return 3;
  }

  if (lan === "en" || lan === "en-us" || lan === "en-gb") {
    return 10;
  }
  if (lan.includes("en")) {
    return 11;
  }
  if (label.includes("英文") || label.includes("英语") || label.includes("english")) {
    return 12;
  }

  return 50;
}

function validateSubtitleByDuration(body, videoDuration) {
  const duration = Number(videoDuration || 0);
  if (!Array.isArray(body) || body.length === 0) {
    return { ok: false, reason: "empty", videoDuration: duration, maxTo: 0 };
  }

  let maxTo = 0;
  for (const item of body) {
    const to = Number(item?.to);
    const from = Number(item?.from);
    if (Number.isFinite(to) && to > maxTo) {
      maxTo = to;
    }
    if (Number.isFinite(from) && from > maxTo) {
      maxTo = from;
    }
  }

  if (!(duration > 0)) {
    return { ok: true, reason: "skip-no-video-duration", videoDuration: duration, maxTo };
  }

  const upperTolerance = Math.max(12, duration * 0.15);
  if (maxTo > duration + upperTolerance) {
    return { ok: false, reason: "too-long", videoDuration: duration, maxTo };
  }

  let minCoverageRatio = 0;
  if (duration >= 600) {
    minCoverageRatio = 0.18;
  } else if (duration >= 300) {
    minCoverageRatio = 0.22;
  } else if (duration >= 180) {
    minCoverageRatio = 0.25;
  }

  if (minCoverageRatio > 0 && maxTo < duration * minCoverageRatio) {
    return { ok: false, reason: "too-short", videoDuration: duration, maxTo };
  }

  return { ok: true, reason: "ok", videoDuration: duration, maxTo };
}

function readRuntimeVideoDuration() {
  const video = document.querySelector("video");
  const duration = Number(video?.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return duration;
  }
  return 0;
}

async function fetchSubtitleBody(url) {
  logInfo("[BOC] fetch subtitle body", { url });
  return fetchJsonInBackground(url);
}

async function fetchJson(url) {
  if (typeof url === "string" && url.startsWith("https://api.bilibili.com/")) {
    return fetchJsonInBackground(url);
  }

  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`);
  }

  return response.json();
}

async function fetchJsonInBackground(url) {
  try {
    const resp = await sendRuntimeMessage({ type: "fetch-json", url });
    if (!resp?.ok) {
      throw new Error(toReadableText(resp?.error, "Background fetch failed"));
    }
    return resp.data;
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      throw new Error("扩展刚刚更新，请刷新当前页面后重试。");
    }
    throw error;
  }
}

function normalizeSubtitleUrl(url) {
  if (!url) {
    return "";
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return `https://${url.replace(/^\/+/, "")}`;
}

function buildSubtitlePreview(body, settings) {
  const compactWithHours = shouldShowHoursInSubtitle(body);
  const mode = getTimestampMode(settings);
  return (body || [])
    .map((item) => {
      const text = String(item?.content || "").trim();
      if (!text) {
        return "";
      }
      const prefix = buildTimestampPrefix(item.from, _episodeUrlOverride || location.href, compactWithHours, mode);
      return prefix ? `${prefix} ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

function buildMarkdown(meta, body, settings, highlights) {
  const created = formatLocalDate();
  const tags = (settings.tags || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const tagsYaml =
    tags.length === 0 ? "[]" : `[${tags.map((tag) => `"${tag.replace(/"/g, '\\"')}"`).join(", ")}]`;

  const compactWithHours = shouldShowHoursInNote(meta, body);
  const chapterLines = buildChapterLines(meta.chapters || [], compactWithHours, settings);
  const subtitleSectionLines = buildSubtitleSectionLines(
    body,
    meta.chapters || [],
    settings,
    compactWithHours
  );
  const frontMatter = buildFrontMatter(meta, settings, created, tagsYaml);

  const page = extractPageIndex(_episodeUrlOverride || location.href);
  const embedIframe = buildBilibiliEmbedIframe(meta, page);
  const intro = String(meta.description || "").trim();

  const lines = [];
  if (frontMatter) {
    lines.push(frontMatter, "");
  }
  lines.push(embedIframe, "");

  if (intro) {
    lines.push("## 简介", "", intro, "");
  }

  if (chapterLines.length > 0) {
    lines.push("## 章节", "", ...chapterLines, "");
  }

  // 高亮片段（插入在章节和字幕之间）
  if (highlights && highlights.length > 0) {
    lines.push("## 高亮片段", "");
    // 按时间顺序排序
    const sorted = [...highlights].sort((a, b) => (a.from || 0) - (b.from || 0));
    sorted.forEach(h => {
      const tsLink = settings?.timestampMode === "media-extended"
        ? `[${formatTime(h.from)}](${cleanVideoUrl()}#t=${Math.floor(h.from)})`
        : formatTime(h.from);
      let text;
      if (h.type === "single" && h.full && h.sel) {
        // 单行：整行文字，选中部分用 == 包裹
        const idx = h.full.indexOf(h.sel);
        if (idx !== -1) {
          text = h.full.slice(0, idx) + "==" + h.sel + "==" + h.full.slice(idx + h.sel.length);
        } else {
          text = `==${h.full}==`;
        }
      } else {
        // 多行或旧数据：整段用 == 包裹
        text = `==${h.text || h.full || ""}==`;
      }
      lines.push(`- ${tsLink} ${text}`);
    });
    lines.push("");
  }

  lines.push("## 字幕", "", ...subtitleSectionLines);

  return lines.join("\n");
}

function buildFrontMatter(meta, settings, created, tagsYaml) {
  const enabled = getEnabledFrontmatterFields(settings);
  const fixedPropertyLines = getFixedFrontmatterPropertyLines(settings);
  if (enabled.length === 0 && fixedPropertyLines.length === 0) {
    return "";
  }

  const pageSuffix = Number(meta.pageCount) > 1 && Number(meta.pageIndex) > 0 ? `?p=${Number(meta.pageIndex)}` : "";
  const fieldLines = {
    title: `title: "${escapeYaml(meta.title)}"`,
    url: `url: "https://www.bilibili.com/video/${escapeYaml(meta.bvid)}${pageSuffix}"`,
    bvid: `bvid: "${escapeYaml(meta.bvid)}"`,
    cid: `cid: "${escapeYaml(meta.cid)}"`,
    author: `author: "${escapeYaml(meta.author || "unknown")}"`,
    upload_date: `upload_date: "${escapeYaml(meta.uploadDate || "unknown")}"`,
    subtitle_lang: `subtitle_lang: "${escapeYaml(meta.selectedSubtitleLang || "unknown")}"`,
    created: `created: "${created}"`,
    tags: `tags: ${tagsYaml}`
  };

  const lines = enabled.map((field) => fieldLines[field]).filter(Boolean);
  lines.push(...fixedPropertyLines);
  if (lines.length === 0) {
    return "";
  }

  return ["---", ...lines, "---"].join("\n");
}

function getEnabledFrontmatterFields(settings) {
  const defaultFields = Array.isArray(DEFAULT_SETTINGS.frontmatterFields)
    ? DEFAULT_SETTINGS.frontmatterFields
    : [];
  const raw = Array.isArray(settings?.frontmatterFields) ? settings.frontmatterFields : defaultFields;
  const allowed = new Set(defaultFields);
  const unique = [];
  raw.forEach((item) => {
    const key = String(item || "").trim();
    if (!key || !allowed.has(key) || unique.includes(key)) {
      return;
    }
    unique.push(key);
  });
  return unique;
}

function getFixedFrontmatterPropertyLines(settings) {
  const customPropertyKeyPattern = /^[\p{L}\p{N}_\-\s]+$/u;
  const systemFields = new Set(
    (Array.isArray(DEFAULT_SETTINGS.frontmatterFields) ? DEFAULT_SETTINGS.frontmatterFields : []).map((field) =>
      String(field).toLowerCase()
    )
  );
  const rows = Array.isArray(settings?.fixedFrontmatterProperties) ? settings.fixedFrontmatterProperties : [];
  const seenKeys = new Set();
  const lines = [];

  rows.forEach((item) => {
    const key = String(item?.key || "").trim();
    const type = normalizeFixedPropertyType(item?.type);
    const value = item?.value;
    const lowerKey = key.toLowerCase();
    if (!key || isFixedPropertyRowEffectivelyEmpty(type, value)) {
      return;
    }
    if (!customPropertyKeyPattern.test(key)) {
      return;
    }
    if (systemFields.has(lowerKey) || seenKeys.has(lowerKey)) {
      return;
    }
    seenKeys.add(lowerKey);
    const yamlLine = formatFixedPropertyYamlLine(key, type, value);
    if (yamlLine) {
      lines.push(yamlLine);
    }
  });

  return lines;
}

function normalizeFixedPropertyType(value) {
  const type = String(value || "").trim().toLowerCase();
  return type === "number" || type === "checkbox" || type === "list" ? type : "text";
}

function isFixedPropertyRowEffectivelyEmpty(type, value) {
  return !String(value || "").trim();
}

function formatFixedPropertyYamlLine(key, type, value) {
  const normalizedType = normalizeFixedPropertyType(type);
  if (normalizedType === "number") {
    const num = Number(String(value || "").trim());
    if (!Number.isFinite(num)) {
      return "";
    }
    return `${key}: ${String(value).trim()}`;
  }

  if (normalizedType === "checkbox") {
    const normalizedValue = String(value || "").trim().toLowerCase();
    if (normalizedValue !== "true" && normalizedValue !== "false") {
      return "";
    }
    return `${key}: ${normalizedValue}`;
  }

  if (normalizedType === "list") {
    const items = String(value || "")
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    return `${key}: [${items.map((item) => `"${escapeYaml(item)}"`).join(", ")}]`;
  }

  return `${key}: "${escapeYaml(value)}"`;
}

function buildSubtitleSectionLines(body, chapters, settings, withHours) {
  const subtitleItems = (body || [])
    .map((item, index) => ({
      ...item,
      _index: index,
      text: String(item?.content || "").trim()
    }))
    .filter((item) => item.text);
  if (subtitleItems.length === 0) {
    return ["（暂无字幕）"];
  }

  const chapterItems = normalizeChapters(chapters);
  if (chapterItems.length === 0) {
    return subtitleItems.map((item) => formatSubtitleLine(item, settings, withHours));
  }

  const lines = [];
  const usedIndexes = new Set();

  chapterItems.forEach((chapter, idx) => {
    const start = Number(chapter.from || 0) || 0;
    const next = chapterItems[idx + 1];
    const chapterTo = Number(chapter.to || 0) || 0;
    let end = Infinity;
    if (next && Number(next.from) > start) {
      end = Number(next.from);
    } else if (chapterTo > start) {
      end = chapterTo;
    }

    const sectionItems = subtitleItems.filter((item) => {
      const from = Number(item.from || 0) || 0;
      const inStart = from + 0.001 >= start;
      const inEnd = end === Infinity ? true : from < end;
      return inStart && inEnd;
    });

    if (sectionItems.length === 0) {
      return;
    }

    const chapterMode = getTimestampMode(settings);
    const chapterStamp = buildTimestampPrefix(start, _episodeUrlOverride || location.href, withHours, chapterMode);
    lines.push(`### ${chapter.title}${chapterStamp}`, "");
    sectionItems.forEach((item) => {
      usedIndexes.add(item._index);
      lines.push(formatSubtitleLine(item, settings, withHours));
    });
    lines.push("");
  });

  const remaining = subtitleItems.filter((item) => !usedIndexes.has(item._index));
  if (remaining.length > 0) {
    lines.push("### 其他片段", "");
    remaining.forEach((item) => {
      lines.push(formatSubtitleLine(item, settings, withHours));
    });
    lines.push("");
  }

  if (lines.length === 0) {
    return subtitleItems.map((item) => formatSubtitleLine(item, settings, withHours));
  }

  while (lines.length > 0 && !lines[lines.length - 1]) {
    lines.pop();
  }
  return lines;
}

function formatSubtitleLine(item, settings, withHours) {
  const text = String(item?.content || "").trim();
  if (!text) {
    return "";
  }
  const mode = getTimestampMode(settings);
  const prefix = buildTimestampPrefix(item.from, _episodeUrlOverride || location.href, withHours, mode);
  return prefix ? `${prefix} ${text}` : text;
}

function buildChapterLines(chapters, withHours = false, settings = null) {
  const chapterItems = normalizeChapters(chapters);
  if (chapterItems.length === 0) {
    return [];
  }

  const mode = getTimestampMode(settings);
  return chapterItems.map((item) => {
    if (mode === "hidden") {
      return `- ${item.title}`;
    }
    if (mode === "plain") {
      const stamp = formatCompactTimestamp(item.from, withHours);
      return `- ${stamp} ${item.title}`;
    }
    const link = formatMediaExtendedLink(item.from, _episodeUrlOverride || location.href, withHours);
    return `- ${link} ${item.title}`;
  });
}

function buildBilibiliEmbedIframe(meta, page = 1) {
  const bvid = String(meta?.bvid || "").trim();
  if (!bvid) {
    return "";
  }
  // Media Extended 原生嵌入格式：![](URL)
  // 去掉 www 和多余查询参数，生成最短链接
  const pageParam = Number(page) > 1 ? `?p=${Number(page)}` : "";
  return `![](https://bilibili.com/video/${bvid}${pageParam})`;
}

function buildSrt(body) {
  return body
    .map((item, index) => {
      const from = formatTimestamp(item.from, true);
      const to = formatTimestamp(item.to, true);
      const text = (item.content || "").trim();
      return `${index + 1}\n${from} --> ${to}\n${text}`;
    })
    .join("\n\n");
}

function buildTxt(body, settings) {
  const withHours = shouldShowHoursInSubtitle(body);
  const mode = getTimestampMode(settings);
  return (body || [])
    .map((item) => {
      const text = String(item?.content || "").trim();
      if (!text) {
        return "";
      }
      const prefix = buildTimestampPrefix(item.from, _episodeUrlOverride || location.href, withHours, mode);
      return prefix ? `${prefix} ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

function shouldShowHoursInSubtitle(body) {
  const maxTo = (body || []).reduce((max, item) => {
    const to = Number(item?.to || 0);
    return Number.isFinite(to) && to > max ? to : max;
  }, 0);
  return maxTo >= 3600;
}

function shouldShowHoursInNote(meta, body) {
  const subtitleMaxTo = (body || []).reduce((max, item) => {
    const to = Number(item?.to || 0);
    return Number.isFinite(to) && to > max ? to : max;
  }, 0);
  const chapterMaxTo = normalizeChapters(meta?.chapters || []).reduce((max, item) => {
    const from = Number(item?.from || 0) || 0;
    const to = Number(item?.to || 0) || 0;
    return Math.max(max, from, to);
  }, 0);
  const duration = Number(meta?.videoDuration || 0) || 0;
  return Math.max(subtitleMaxTo, chapterMaxTo, duration) >= 3600;
}

/**
 * 获取当前时间戳显示模式
 * @param {object} settings - 设置对象
 * @returns {"hidden"|"plain"|"media-extended"}
 */
function getTimestampMode(settings) {
  const mode = settings?.timestampMode;
  if (mode === "hidden" || mode === "plain" || mode === "media-extended") {
    return mode;
  }
  // 向后兼容旧版 includeTimestampInBody 布尔值
  return settings?.includeTimestampInBody === false ? "hidden" : "media-extended";
}

/**
 * 根据模式生成字幕行前的时间戳前缀
 * @param {number} from - 开始时间（秒）
 * @param {string} url - 视频 URL
 * @param {boolean} withHours - 是否显示小时
 * @param {"hidden"|"plain"|"media-extended"} mode - 时间戳模式
 * @returns {string} 时间戳前缀字符串
 */
function buildTimestampPrefix(from, url, withHours, mode) {
  if (mode === "hidden") {
    return "";
  }
  if (mode === "plain") {
    return ` ${formatCompactTimestamp(from, withHours)}`;
  }
  // media-extended
  return ` ${formatMediaExtendedLink(from, url, withHours)}`;
}

function formatCompactTimestamp(seconds, withHours) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hour = Math.floor(safe / 3600);
  const minute = Math.floor((safe % 3600) / 60);
  const second = safe % 60;

  if (withHours) {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(
      second
    ).padStart(2, "0")}`;
  }

  const totalMinutes = Math.floor(safe / 60);
  return `${String(totalMinutes).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

/**
 * 生成 Media Extended 兼容的 Markdown 时间戳链接
 * 格式：[MM:SS](URL#t=秒数)
 * t=0 时校正为 t=0.1，URL 使用精简短链
 * @param {number} from - 开始时间（秒）
 * @param {string} url - 视频 URL
 * @param {boolean} withHours - 是否显示小时
 * @returns {string} 如 [01:23](https://bilibili.com/video/BVxxx#t=83)
 */
function formatMediaExtendedLink(from, url, withHours = false) {
  // 精简 URL：提取 BV 号，生成最短链接
  const safeUrl = String(url || location.href || "").trim();
  let shortUrl;
  try {
    const urlObj = new URL(safeUrl);
    const bvMatch = urlObj.pathname.match(/\/(BV[A-Za-z0-9]+)/);
    if (bvMatch) {
      const pageParam = urlObj.searchParams.get("p");
      const pageSuffix = pageParam ? `?p=${pageParam}` : "";
      shortUrl = `https://bilibili.com/video/${bvMatch[1]}${pageSuffix}`;
    } else {
      urlObj.hash = "";
      urlObj.search = "";
      shortUrl = urlObj.toString();
    }
  } catch {
    shortUrl = safeUrl;
  }

  // t=0 校正为 t=0.1
  const fromSec = Math.max(0, Number(from) || 0);
  const tValue = fromSec === 0 ? 0.1 : fromSec;

  // 显示文本：MM:SS 或 HH:MM:SS
  const totalSec = Math.max(0, Math.floor(fromSec));
  const hour = Math.floor(totalSec / 3600);
  const minute = Math.floor((totalSec % 3600) / 60);
  const second = totalSec % 60;

  let displayTime;
  if (withHours) {
    displayTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  } else {
    displayTime = `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  }

  return `[${displayTime}](${shortUrl}#t=${tValue})`;
}

function formatTimestamp(seconds, forSrt = false) {
  const safe = Number(seconds) || 0;
  const msTotal = Math.max(0, Math.floor(safe * 1000));
  const hour = Math.floor(msTotal / 3600000);
  const minute = Math.floor((msTotal % 3600000) / 60000);
  const second = Math.floor((msTotal % 60000) / 1000);
  const ms = msTotal % 1000;

  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  if (!forSrt) {
    return `${hh}:${mm}:${ss}.${String(ms).padStart(3, "0")}`;
  }

  return `${hh}:${mm}:${ss},${String(ms).padStart(3, "0")}`;
}

function sanitizeFileName(value) {
  return value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
}

function normalizeDownloadFormat(value) {
  return value === "txt" ? "txt" : "srt";
}

/**
 * 将 "MM:SS" 或 "H:MM:SS" 格式的时间字符串转为秒数。
 * B 站 space API 返回的 length 字段为此格式。
 */
function parseDuration(length) {
  if (!length) return 0;
  const parts = String(length).split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return Number(length) || 0;
}

function buildNoteFilename(meta) {
  const includeDate = state.settings?.includeDateInFilename !== false;
  const baseParts = [];

  if (includeDate) {
    baseParts.push(formatLocalDate());
  }

  baseParts.push(meta.title || meta.bvid || "bilibili-subtitle");

  if (Number(meta.pageCount) > 1) {
    baseParts.push(`P${Number(meta.pageIndex) > 0 ? Number(meta.pageIndex) : 1}`);
    const pageTitle = String(meta.pageTitle || "").trim();
    if (pageTitle) {
      baseParts.push(pageTitle);
    }
  }

  const baseName = sanitizeFileName(baseParts.filter(Boolean).join("-"));
  return `${baseName || "bilibili-subtitle"}.md`;
}

function normalizeFolder(input) {
  return String(input || "").trim().replace(/^\/+|\/+$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeYaml(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
