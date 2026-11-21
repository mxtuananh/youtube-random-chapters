(() => {
  "use strict";
  const {
    normalizeChapters,
    parseTimestamp,
    chapterIndexAt,
    chooseUnplayedOtherChapter,
    shouldTriggerBoundary,
    shouldTriggerFinalEnd
  } = RandomChapterUtils;
  const messageType = "random-chapters:player-data";
  let videoId = "";
  let chapters = [];
  let chapterSource = "";
  let emptyBridgeVideoId = "";
  let emptyBridgeTitle = "";
  let staleNativeTitle = "";
  let enabled = false;
  let allowPlayedRepeats = false;
  const playedByVideo = new Map();
  let currentVideo = null;
  let previousTime = 0;
  let seekInProgress = false;
  let internalSeek = false;
  let navigationPending = false;
  let lastHref = location.href;
  let navigationTimer = 0;
  let syncTimer = 0;
  let stateRequest = 0;
  let lastPopupState = "";
  const videoListeners = [];

  function currentId() {
    return new URL(location.href).searchParams.get("v") || "";
  }

  function storageKey(id) { return `randomChapters:${id}`; }

  function refreshButtons() {
    document.querySelectorAll(".random-chapters-toggle").forEach((button) => {
      const pressed = String(enabled);
      const title = enabled ? "Turn random chapter playback off" : "Turn random chapter playback on";
      if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
      button.classList.toggle("is-enabled", enabled);
      if (button.title !== title) button.title = title;
      if (button.getAttribute("aria-label") !== `Random chapters: ${enabled ? "On" : "Off"}`) {
        button.setAttribute("aria-label", `Random chapters: ${enabled ? "On" : "Off"}`);
      }
      const status = button.querySelector(".random-chapters-status");
      const value = enabled ? "On" : "Off";
      if (status && status.textContent !== value) status.textContent = value;
      status?.classList.toggle("is-enabled", enabled);
    });
  }

  function removeButtons() {
    document.querySelectorAll(".random-chapters-toggle").forEach((button) => button.remove());
  }

  function setEnabled(value) {
    stateRequest += 1;
    enabled = Boolean(value);
    if (videoId) chrome.storage.local.set({ [storageKey(videoId)]: enabled });
    refreshButtons();
    notifyPopup();
  }

  function playedChapters(id = videoId) {
    if (!playedByVideo.has(id)) playedByVideo.set(id, new Set());
    return playedByVideo.get(id);
  }

  function markCurrentChapterPlayed(time = currentVideo?.currentTime) {
    if (!videoId || !chapters.length || !Number.isFinite(time) || currentVideo?.paused
      || seekInProgress || navigationPending || currentId() !== videoId || internalSeek || isAdShowing()) return;
    const index = chapterIndexAt(chapters, time);
    if (index >= 0) playedChapters().add(chapters[index].start);
  }

  function popupState() {
    return { type: "random-chapters:state", videoId: navigationPending ? "" : videoId, enabled, hasChapters: !navigationPending && chapters.length >= 2 };
  }

  function notifyPopup() {
    const state = popupState();
    const signature = JSON.stringify(state);
    if (signature === lastPopupState) return;
    lastPopupState = signature;
    if (chrome.runtime?.sendMessage) chrome.runtime.sendMessage(state, () => void chrome.runtime.lastError);
  }

  function makeButton(placement) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "random-chapters-toggle";
    button.dataset.randomChaptersPlacement = placement;
    button.setAttribute("aria-pressed", String(enabled));
    button.classList.toggle("is-enabled", enabled);
    button.setAttribute("aria-label", `Random chapters: ${enabled ? "On" : "Off"}`);
    button.title = enabled ? "Turn random chapter playback off" : "Turn random chapter playback on";
    const prefix = document.createElement("span");
    prefix.className = "random-chapters-prefix";
    prefix.textContent = "Random chapter: ";
    const status = document.createElement("span");
    status.className = "random-chapters-status";
    status.textContent = enabled ? "On" : "Off";
    status.classList.toggle("is-enabled", enabled);
    button.append(prefix, status);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setEnabled(!enabled);
    });
    return button;
  }

  function isUsableAnchor(anchor) {
    return Boolean(anchor && !anchor.hidden && !anchor.closest("[hidden], [aria-hidden='true']"));
  }

  function syncPlacement(placement, anchor) {
    const existing = document.querySelector(`[data-random-chapters-placement="${placement}"]`);
    if (!isUsableAnchor(anchor)) {
      existing?.remove();
      return;
    }
    if (existing?.previousElementSibling === anchor) {
      if (placement === "player") matchNativeChapterStyle(anchor, existing);
      return;
    }
    existing?.remove();
    const button = makeButton(placement);
    if (placement === "player") matchNativeChapterStyle(anchor, button);
    anchor.insertAdjacentElement("afterend", button);
  }

  function matchNativeChapterStyle(anchor, button) {
    try {
      const native = anchor.matches("button, .ytp-button, [role='button']")
        ? anchor : anchor.querySelector(".ytp-chapter-title");
      if (!native) return;
      const text = native.querySelector?.(".ytp-chapter-title-content") || native;
      const style = window.getComputedStyle(native);
      const textStyle = window.getComputedStyle(text);
      const rect = native.getBoundingClientRect?.();
      const height = rect?.height > 0 ? `${rect.height}px` : style.height;
      if (height && height !== "auto" && height !== "0px") setButtonStyle(button, "--random-chapters-height", height);
      for (const [property, variable] of [
        ["backgroundColor", "--random-chapters-background"],
        ["backgroundImage", "--random-chapters-background-image"],
        ["backdropFilter", "--random-chapters-backdrop-filter"],
        ["boxShadow", "--random-chapters-box-shadow"],
        ["opacity", "--random-chapters-opacity"],
        ["paddingTop", "--random-chapters-padding-top"],
        ["paddingRight", "--random-chapters-padding-right"],
        ["paddingBottom", "--random-chapters-padding-bottom"],
        ["paddingLeft", "--random-chapters-padding-left"],
        ["border", "--random-chapters-border"],
        ["borderRadius", "--random-chapters-border-radius"]
      ]) {
        if (style[property]) setButtonStyle(button, variable, style[property]);
      }
      for (const [property, variable] of [
        ["fontSize", "--random-chapters-font-size"],
        ["fontFamily", "--random-chapters-font-family"],
        ["fontWeight", "--random-chapters-font-weight"],
        ["fontStyle", "--random-chapters-font-style"],
        ["letterSpacing", "--random-chapters-letter-spacing"],
        ["lineHeight", "--random-chapters-line-height"],
        ["textShadow", "--random-chapters-text-shadow"]
      ]) {
        if (textStyle[property]) setButtonStyle(button, variable, textStyle[property]);
      }
      if (textStyle.color) setButtonStyle(button, "--random-chapters-color", textStyle.color);
    } catch (_) {}
  }

  function setButtonStyle(button, property, value) {
    if (button.style.getPropertyValue(property) !== value) button.style.setProperty(property, value);
  }

  function playerChapterAnchor() {
    const container = document.querySelector(".ytp-chapter-container");
    const affordanceSelector = ".ytp-chapter-title, button[aria-label='View chapters'], button[title='View chapters'], [role='button'][aria-label='View chapters']";
    if (isDisplayed(container)) return container;
    const affordance = document.querySelector("#movie_player")?.querySelector(affordanceSelector);
    const native = affordance?.closest("button, .ytp-button, [role='button']") || affordance;
    return isDisplayed(native) ? native : null;
  }

  function nativeChapterTitle(anchor) {
    const title = anchor?.querySelector?.(".ytp-chapter-title-content")
      || (anchor?.matches?.(".ytp-chapter-title") ? anchor : null);
    return title?.textContent?.trim() && isDisplayed(title) ? title.textContent.trim() : "";
  }

  function isDisplayed(element) {
    if (!element || element.hidden || element.closest?.("[hidden], [aria-hidden='true']")) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    const rect = element.getBoundingClientRect?.();
    return !rect || rect.width > 0 && rect.height > 0;
  }

  function timestampFromElement(element) {
    const raw = element.getAttribute("data-start-time") || element.getAttribute("start-time");
    if (raw != null && raw.trim() !== "") {
      const numeric = Number(raw);
      if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    }
    const label = element.querySelector("#time, #time-description, .timestamp, time")?.textContent?.trim();
    const fromLabel = parseTimestamp(label);
    if (Number.isFinite(fromLabel)) return fromLabel;
    const href = element.querySelector("a[href]")?.href;
    if (href) {
      try {
        const url = new URL(href, location.href);
        const seconds = url.searchParams.get("startTimeSeconds");
        if (seconds != null && Number.isFinite(Number(seconds))) return Number(seconds);
        const t = url.searchParams.get("t");
        if (t && /^\d+(?:\.\d+)?$/.test(t)) return Number(t);
        if (t && /^\d+h(?:\d+m)?(?:\d+s)?$/.test(t)) {
          const parts = t.match(/(\d+)h|(\d+)m|(\d+)s/g) || [];
          return parts.reduce((sum, part) => {
            if (part.endsWith("h")) return sum + Number(part.slice(0, -1)) * 3600;
            if (part.endsWith("m")) return sum + Number(part.slice(0, -1)) * 60;
            return sum + Number(part.slice(0, -1));
          }, 0);
        }
      } catch (_) {}
    }
    return NaN;
  }

  function extractVisibleChapters() {
    if (!playerChapterAnchor()) return;
    const found = [];
    document.querySelectorAll("ytd-macro-markers-list-item-renderer, .ytp-chapter-hover-container").forEach((element) => {
      const href = element.querySelector("a[href]")?.href;
      if (href) {
        try {
          const id = new URL(href, location.href).searchParams.get("v");
          if (id && id !== videoId) return;
        } catch (_) {}
      }
      const start = timestampFromElement(element);
      const title = element.querySelector("#title, [class*='title'], .ytp-chapter-title-content")?.textContent?.trim();
      if (Number.isFinite(start) && title) found.push({ start, title });
    });
    const normalized = normalizeChapters(found);
    if (normalized.length >= 2 && chapterSource !== "bridge") {
      const changed = JSON.stringify(chapters) !== JSON.stringify(normalized);
      chapters = normalized;
      chapterSource = "dom";
      if (changed) {
        markCurrentChapterPlayed(currentVideo?.currentTime);
        notifyPopup();
      }
    }
  }

  function isAdShowing() {
    return Boolean(document.querySelector(".ad-showing, .ad-interrupting, .ytp-ad-player"));
  }

  function chooseAndSeek(finishedIndex) {
    if (!currentVideo || chapters.length < 2 || navigationPending || currentId() !== videoId || isAdShowing()) return false;
    if (finishedIndex >= 0) playedChapters().add(chapters[finishedIndex].start);
    const selection = chooseUnplayedOtherChapter(chapters, finishedIndex, playedChapters(), allowPlayedRepeats);
    const targetIndex = selection.index;
    playedByVideo.set(videoId, selection.played);
    if (targetIndex < 0) return false;
    internalSeek = true;
    currentVideo.currentTime = chapters[targetIndex].start + 0.05;
    playedChapters().add(chapters[targetIndex].start);
    previousTime = currentVideo.currentTime;
    currentVideo.play().catch(() => {});
    window.setTimeout(() => { internalSeek = false; }, 500);
    return true;
  }

  function onTimeUpdate() {
    const video = currentVideo;
    if (!video) return;
    if (!enabled || seekInProgress || internalSeek || chapters.length < 2 || video.paused
      || navigationPending || currentId() !== videoId || isAdShowing()) {
      if (!seekInProgress && !internalSeek) markCurrentChapterPlayed(video.currentTime);
      previousTime = video.currentTime;
      return;
    }
    const currentTime = video.currentTime;
    const finishedIndex = chapterIndexAt(chapters, previousTime);
    if (finishedIndex >= 0) {
      const boundary = finishedIndex + 1 < chapters.length ? chapters[finishedIndex + 1].start : video.duration;
      const crossed = shouldTriggerBoundary(previousTime, currentTime, boundary, { enabled, seeking: seekInProgress });
      const finalEnd = finishedIndex === chapters.length - 1
        && shouldTriggerFinalEnd(currentTime, boundary, { enabled, seeking: seekInProgress, leadSeconds: 0.5 });
      if (crossed || finalEnd) {
        if (chooseAndSeek(finishedIndex)) return;
      }
    }
    markCurrentChapterPlayed(currentTime);
    previousTime = currentTime;
  }

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    videoListeners.push([target, type, handler]);
  }

  function detachVideo() {
    videoListeners.splice(0).forEach(([target, type, handler]) => target.removeEventListener(type, handler));
    currentVideo = null;
    seekInProgress = false;
    internalSeek = false;
  }

  function attachVideo() {
    const video = document.querySelector("video.html5-main-video");
    if (video === currentVideo) return;
    detachVideo();
    currentVideo = video;
    if (!video) return;
    previousTime = video.currentTime;
    listen(video, "timeupdate", onTimeUpdate);
    listen(video, "seeking", () => { seekInProgress = true; });
    listen(video, "seeked", () => { seekInProgress = false; previousTime = video.currentTime; markCurrentChapterPlayed(video.currentTime); });
    listen(video, "playing", () => { previousTime = video.currentTime; markCurrentChapterPlayed(video.currentTime); });
    listen(video, "ended", () => {
      if (enabled) chooseAndSeek(chapterIndexAt(chapters, video.currentTime));
    });
  }

  function loadVideoState(id) {
    if (videoId && videoId !== id) staleNativeTitle = nativeChapterTitle(playerChapterAnchor());
    videoId = id;
    chapters = [];
    chapterSource = "";
    emptyBridgeVideoId = "";
    emptyBridgeTitle = "";
    enabled = false;
    previousTime = currentVideo?.currentTime || 0;
    seekInProgress = false;
    internalSeek = false;
    removeButtons();
    const request = ++stateRequest;
    if (!id) return;
    chrome.storage.local.get(storageKey(id), (items) => {
      if (request !== stateRequest || videoId !== id) return;
      enabled = Boolean(items[storageKey(id)]);
      refreshButtons();
      notifyPopup();
    });
  }

  function syncVideo() {
    const href = location.href;
    const id = currentId();
    const routeChanged = href !== lastHref;
    if (routeChanged) {
      lastHref = href;
      if (id !== videoId) { chapters = []; chapterSource = ""; }
      previousTime = currentVideo?.currentTime || 0;
      seekInProgress = false;
      internalSeek = false;
    }
    if (id !== videoId) loadVideoState(id);
    attachVideo();
    extractVisibleChapters();
    const nativeAnchor = playerChapterAnchor();
    const title = nativeChapterTitle(nativeAnchor);
    const staleTitle = (emptyBridgeVideoId === videoId && title === emptyBridgeTitle)
      || (staleNativeTitle && title === staleNativeTitle);
    const confirmed = chapters.length >= 2 || (title && !staleTitle);
    if (title && !staleTitle) {
      emptyBridgeVideoId = "";
      staleNativeTitle = "";
    }
    if (navigationPending) syncPlacement("player", null);
    else syncPlacement("player", confirmed ? nativeAnchor : null);
    refreshButtons();
  }
  if (chrome.runtime?.onMessage?.addListener) chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "random-chapters:get-state") { syncVideo(); sendResponse(popupState()); return false; }
    if (message?.type === "random-chapters:set-enabled") {
      syncVideo();
      if (!navigationPending && message.videoId === videoId && message.videoId === currentId() && chapters.length >= 2) {
        setEnabled(message.enabled);
      }
      sendResponse(popupState());
      return false;
    }
  });

  function scheduleSync() {
    if (syncTimer) return;
    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      syncVideo();
    }, 100);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== messageType) return;
    syncVideo();
    if (event.data.videoId !== currentId() || event.data.videoId !== videoId) return;
    const incoming = normalizeChapters(event.data.chapters);
    if (incoming.length >= 2) {
      const changed = JSON.stringify(chapters) !== JSON.stringify(incoming);
      chapters = incoming;
      chapterSource = "bridge";
      emptyBridgeVideoId = "";
      staleNativeTitle = "";
      if (changed) markCurrentChapterPlayed(currentVideo?.currentTime);
    } else if (event.data.authoritative === true) {
      chapters = [];
      chapterSource = "";
      emptyBridgeVideoId = videoId;
      emptyBridgeTitle = nativeChapterTitle(playerChapterAnchor());
    }
    notifyPopup();
    scheduleSync();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.allowPlayedChapterRepeats) allowPlayedRepeats = Boolean(changes.allowPlayedChapterRepeats.newValue);
    if (!videoId) return;
    const key = storageKey(videoId);
    if (changes[key]) { enabled = Boolean(changes[key].newValue); refreshButtons(); notifyPopup(); }
  });

  chrome.storage.local.get("allowPlayedChapterRepeats", (items) => {
    allowPlayedRepeats = Boolean(items.allowPlayedChapterRepeats);
  });

  function beginNavigation() {
    navigationPending = true;
    syncPlacement("player", null);
    notifyPopup();
  }
  window.addEventListener("random-chapters:navigate-start", beginNavigation);
  window.addEventListener("yt-navigate-start", beginNavigation);
  window.addEventListener("yt-navigate-finish", () => {
    navigationPending = false;
    syncVideo();
  });

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  navigationTimer = window.setInterval(syncVideo, 1000);
  window.postMessage({ type: "random-chapters:request" }, location.origin);
  window.addEventListener("beforeunload", () => {
    observer.disconnect();
    window.clearInterval(navigationTimer);
    window.clearTimeout(syncTimer);
    detachVideo();
  }, { once: true });
  syncVideo();
})();
