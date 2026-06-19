const el = {
  status: document.getElementById("status"),
  message: document.getElementById("message"),
  propTitle: document.getElementById("propTitle"),
  propUrl: document.getElementById("propUrl"),
  propCreated: document.getElementById("propCreated"),
  propTags: document.getElementById("propTags"),
  subtitleSelect: document.getElementById("subtitleSelect"),
  preview: document.getElementById("preview"),
  sendBtn: document.getElementById("sendBtn"),
  readingViewBtn: document.getElementById("readingViewBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  batchSection: document.getElementById("batchSection"),
  batchSeasonBtn: document.getElementById("batchSeasonBtn"),
  batchMultiPageBtn: document.getElementById("batchMultiPageBtn"),
  timestampModeSelect: document.getElementById("timestampModeSelect"),
  customPathCheck: document.getElementById("customPathCheck"),
  customPathInput: document.getElementById("customPathInput")
};

let latestPayload = null;

function formatLocalDate(value = Date.now()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

init().catch((error) => {
  setStatus(`初始化失败：${error.message}`);
});

async function init() {
  bindEvents();
  await refreshFromTab();
  await loadRecentPaths();
}

function bindEvents() {
  el.sendBtn.addEventListener("click", async () => {
    setStatus("正在发送到 Obsidian...");
    const customPath = getCustomPath();
    await saveRecentPath(customPath);
    const resp = await sendToContent({ type: "popup-send-obsidian", customPath });
    if (!resp?.ok) {
      setMessage(`发送失败：${resp?.error || "未知错误"}`);
    }
    render(resp?.payload || latestPayload);
  });

  el.subtitleSelect.addEventListener("change", async (event) => {
    const option = event.target.options[event.target.selectedIndex];
    const url = String(option?.value || "");
    if (!url) {
      return;
    }
    setStatus("正在切换字幕...");
    const resp = await sendToContent({
      type: "popup-select-subtitle",
      url,
      lang: String(option.dataset.lang || "unknown"),
      subtitleId: String(option.dataset.id || "")
    });
    if (!resp?.ok) {
      setMessage(`切换失败：${resp?.error || "未知错误"}`);
    }
    render(resp?.payload || latestPayload);
  });

  el.settingsBtn.addEventListener("click", async () => {
    await sendToRuntime({ type: "open-options" });
  });

  el.readingViewBtn?.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!isSupportedSubtitlePage(tab?.url || "")) {
      setMessage("请先打开一个 B 站视频页。");
      return;
    }

    const prepResp = await sendToContent({ type: "popup-get-state" });
    if (!prepResp?.ok) {
      setMessage(prepResp?.error || "请刷新浏览器网页重试，或当前网页不支持");
      return;
    }

    setStatus("正在打开阅读视图...");
    const resp = await sendToRuntime({
      type: "open-reading-view-tab",
      url: tab.url,
      tabId: tab.id
    });
    if (!resp?.ok) {
      setMessage(`打开失败：${resp?.error || "未知错误"}`);
      return;
    }
    setMessage("已在当前页面打开阅读视图。");
    setStatus("阅读视图已打开。");
    window.setTimeout(() => window.close(), 80);
  });

  el.batchSeasonBtn.addEventListener("click", async () => {
    el.batchSeasonBtn.disabled = true;
    el.batchSeasonBtn.textContent = "下载中...";
    setStatus("正在后台处理合集，请查看页面侧边栏进度...");
    const customPath = getCustomPath();
    await saveRecentPath(customPath);
    await sendToContent({ type: "popup-download-season", customPath });
  });

  el.batchMultiPageBtn.addEventListener("click", async () => {
    el.batchMultiPageBtn.disabled = true;
    el.batchMultiPageBtn.textContent = "下载中...";
    setStatus("正在后台处理多P视频，请查看页面侧边栏进度...");
    const customPath = getCustomPath();
    await saveRecentPath(customPath);
    await sendToContent({ type: "popup-download-all-pages", customPath });
  });

  el.timestampModeSelect.addEventListener("change", async (event) => {
    const newMode = String(event.target.value || "").trim();
    if (newMode !== "hidden" && newMode !== "plain" && newMode !== "media-extended") {
      return;
    }
    const resp = await sendToContent({ type: "popup-set-timestamp-mode", mode: newMode });
    if (!resp?.ok) {
      setMessage(`切换失败：${resp?.error || "未知错误"}`);
    }
    render(resp?.payload || latestPayload);
  });

  // 自定义路径复选框切换
  el.customPathCheck.addEventListener("change", () => {
    el.customPathInput.disabled = !el.customPathCheck.checked;
    if (el.customPathCheck.checked) {
      // 勾选时清空值，让 datalist 显示全部选项
      el.customPathInput.value = "";
      el.customPathInput.focus();
    } else {
      // 取消勾选时恢复显示第一个路径
      restoreFirstPathInInput();
    }
  });

  // 点击下拉时清空值，显示所有选项
  el.customPathInput.addEventListener("focus", () => {
    if (el.customPathCheck.checked) {
      el.customPathInput.value = "";
    }
  });
}

function getCustomPath() {
  return el.customPathInput.value.trim();
}

async function refreshFromTab() {
  setStatus("正在抓取...");
  const resp = await sendToContent({ type: "popup-refresh" });
  if (!resp?.ok) {
    const errorText = resp?.error || "请在 B 站视频页使用。";
    setStatus(`抓取失败：${errorText}`);
  }
  render(resp?.payload || latestPayload);
}

function render(payload) {
  if (!payload) {
    return;
  }
  latestPayload = payload;

  setStatus(payload.status || "准备就绪");
  setMessage(payload.message || "");

  setText(el.propTitle, payload.title || "-");
  setText(el.propUrl, payload.url || "-");
  setText(el.propCreated, formatLocalDate());
  setText(el.propTags, payload.tags || "clippings");
  el.propTitle.title = payload.title || "";
  el.propUrl.title = payload.url || "";

  // 字幕语言下拉
  const options = payload.subtitleOptions || [];
  if (options.length === 0) {
    el.subtitleSelect.innerHTML = '<option value="">暂无字幕</option>';
    el.subtitleSelect.disabled = true;
  } else {
    el.subtitleSelect.innerHTML = options
      .map((item) => {
        const selected = item.selected ? "selected" : "";
        const aiTag = item.isAi ? " [AI]" : "";
        return `<option value="${escapeHtml(item.url)}" data-id="${escapeHtml(
          item.id || ""
        )}" data-lang="${escapeHtml(item.lang || "")}" ${selected}>${escapeHtml(
          `${item.lang || "unknown"}${aiTag}`
        )}</option>`;
      })
      .join("");
    el.subtitleSelect.disabled = false;
  }

  // 同步时间戳模式选择器
  if (payload.timestampMode && el.timestampModeSelect) {
    el.timestampModeSelect.value = payload.timestampMode;
  }

  el.preview.value = payload.subtitlePreview || "";

  // 批量下载区域（合集 / 全部P）
  const season = payload.season;
  const hasBatchSeason = season && season.id && season.totalEpisodes > 0;
  const hasBatchMultiPage = payload.multiplePages && payload.pageCount > 1;

  const showBatch = hasBatchSeason || hasBatchMultiPage;
  el.batchSection.style.display = showBatch ? "" : "none";

  // 合集按钮
  if (hasBatchSeason) {
    const isDone = season.status === "done" || season.status === "sent";
    const isBusy = season.status === "downloading" || season.status === "sending";
    const isIdle = !isBusy && !isDone;
    el.batchSeasonBtn.disabled = !isIdle;
    el.batchSeasonBtn.classList.toggle("batch-btn-done", isDone);
    if (isBusy) {
      el.batchSeasonBtn.textContent = "下载中...";
    } else if (isDone) {
      el.batchSeasonBtn.textContent = `合集下载 (${season.totalEpisodes}集) (下载完成)`;
    } else {
      el.batchSeasonBtn.textContent = `合集下载 (${season.totalEpisodes}集)`;
    }
  } else {
    el.batchSeasonBtn.disabled = true;
    el.batchSeasonBtn.textContent = "合集下载";
  }

  // 全部P按钮
  if (hasBatchMultiPage) {
    const isDone = payload.multiPageStatus === "done";
    const isBusy = payload.multiPageStatus === "downloading";
    const isIdle = !isBusy && !isDone;
    el.batchMultiPageBtn.disabled = !isIdle;
    el.batchMultiPageBtn.classList.toggle("batch-btn-done", isDone);
    if (isBusy) {
      el.batchMultiPageBtn.textContent = "下载中...";
    } else if (isDone) {
      el.batchMultiPageBtn.textContent = `全部P下载 (${payload.pageCount} P) (下载完成)`;
    } else {
      el.batchMultiPageBtn.textContent = `全部P下载 (${payload.pageCount} P)`;
    }
  } else {
    el.batchMultiPageBtn.disabled = true;
    el.batchMultiPageBtn.textContent = "全部P下载";
  }
}

function setText(node, text) {
  if (!node) return;
  node.textContent = String(text || "");
}

function setStatus(text) {
  el.status.textContent = String(text || "");
}

function setMessage(text) {
  el.message.textContent = String(text || "");
}

async function loadRecentPaths() {
  try {
    const resp = await sendToRuntime({ type: "get-settings" });
    const paths = resp?.settings?.recentCustomPaths;
    if (!Array.isArray(paths)) return;
    const validPaths = paths.filter((p) => String(p || "").trim());
    const datalist = document.getElementById("recentPathsDatalist");
    if (datalist) {
      datalist.innerHTML = validPaths
        .map((p) => `<option value="${escapeHtml(String(p).trim())}">`)
        .join("");
    }
    // 不勾选时，输入框显示第一个有效路径
    if (!el.customPathCheck.checked && validPaths.length > 0) {
      el.customPathInput.value = String(validPaths[0]).trim();
    }
  } catch {
    // 静默失败
  }
}

function restoreFirstPathInInput() {
  try {
    // 异步读取后设置
    sendToRuntime({ type: "get-settings" }).then((resp) => {
      const paths = resp?.settings?.recentCustomPaths;
      if (!Array.isArray(paths)) return;
      const first = paths.find((p) => String(p || "").trim());
      if (first) {
        el.customPathInput.value = String(first).trim();
      }
    }).catch(() => {});
  } catch {
    // 静默
  }
}

async function saveRecentPath(path) {
  const trimmed = String(path || "").trim();
  if (!trimmed) return;
  try {
    const resp = await sendToRuntime({ type: "get-settings" });
    const settings = resp?.settings;
    if (!settings) return;
    const paths = Array.isArray(settings.recentCustomPaths) ? [...settings.recentCustomPaths] : ["", "", ""];
    // 去重：移除已有条目
    const filtered = paths.filter((p) => String(p || "").trim() !== trimmed);
    // 插入到最前
    filtered.unshift(trimmed);
    // 保持最多 3 条
    settings.recentCustomPaths = filtered.slice(0, 3);
    await sendToRuntime({ type: "save-settings", settings: { recentCustomPaths: settings.recentCustomPaths } });
    await loadRecentPaths();
  } catch {
    // 静默失败
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0] || null;
}

async function getActiveTabId() {
  const tab = await getActiveTab();
  return tab?.id || null;
}

async function sendToContent(message) {
  const tab = await getActiveTab();
  const tabId = tab?.id || null;
  if (!tabId) {
    throw new Error("找不到当前标签页");
  }

  try {
    return await sendMessageToTab(tabId, message);
  } catch (error) {
    if (shouldRetryAfterInjection(error) && isSupportedSubtitlePage(tab?.url || "")) {
      try {
        await ensureContentScriptReady(tabId);
        await sleep(80);
        return await sendMessageToTab(tabId, message);
      } catch (retryError) {
        error = retryError;
      }
    }

    const normalizedError = normalizeContentErrorMessage(error);
    setStatus("请在 B 站视频页使用插件。");
    setMessage(normalizedError);
    return { ok: false, error: normalizedError, payload: latestPayload };
  }
}

function normalizeContentErrorMessage(error) {
  const message = String(error?.message || "").trim();
  if (message.includes("Could not establish connection. Receiving end does not exist.")) {
    return "请刷新浏览器网页重试，或当前网页不支持";
  }
  return message || "未知错误";
}

function shouldRetryAfterInjection(error) {
  const message = String(error?.message || "");
  return message.includes("Could not establish connection. Receiving end does not exist.");
}

function isSupportedSubtitlePage(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.hostname !== "www.bilibili.com") {
      return false;
    }
    return parsed.pathname === "/list/watchlater" ||
      parsed.pathname === "/list/watchlater/" ||
      parsed.pathname.startsWith("/video/");
  } catch {
    return false;
  }
}

async function ensureContentScriptReady(tabId) {
  if (!chrome.scripting) {
    throw new Error("请刷新浏览器网页重试，或当前网页不支持");
  }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
}

async function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function sendToRuntime(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
}
