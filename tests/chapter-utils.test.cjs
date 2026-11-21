const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
  normalizeChapters,
  parseChapterPayload,
  parseTimestamp,
  chapterIndexAt,
  chooseOtherChapter,
  chooseUnplayedOtherChapter,
  shouldTriggerBoundary,
  shouldTriggerFinalEnd
} = require("../chapter-utils.js");

test("normalizes, sorts, and removes invalid or duplicate chapters", () => {
  assert.deepEqual(normalizeChapters([
    { start: 12, title: "End" }, { start: -1, title: "Bad" }, { start: 4, title: "Start" },
    { start: 4, title: "Duplicate" }, { start: 8, title: "  " }
  ]), [{ start: 4, title: "Start" }, { start: 12, title: "End" }]);
});

test("parses chaptered player bar chapters", () => {
  const payload = { playerOverlays: { chapteredPlayerBarRenderer: { chapters: [
    { chapterRenderer: { timeRangeStartMillis: 0, title: { simpleText: "Opening" } } },
    { chapterRenderer: { timeRangeStartMillis: 12500, title: { runs: [{ text: "Demo" }] } } }
  ] } } };
  assert.deepEqual(parseChapterPayload(payload), [{ start: 0, title: "Opening" }, { start: 12.5, title: "Demo" }]);
});

test("parses CHAPTERS markersMap payload", () => {
  const payload = { playerBar: { multiMarkersPlayerBarRenderer: { markersMap: [{
    key: "CHAPTERS", value: { markers: [
      { startMillis: 0, title: { simpleText: "One" } },
      { startMillis: 30000, title: { simpleText: "Two" } }
    ] }
  }] } } };
  assert.deepEqual(parseChapterPayload(payload), [{ start: 0, title: "One" }, { start: 30, title: "Two" }]);
});

test("parses macro marker list chapter rows", () => {
  const payload = { engagementPanels: [{ engagementPanelSectionListRenderer: { content: {
    macroMarkersListRenderer: { contents: [
      { macroMarkersListItemRenderer: { timeDescription: { simpleText: "0:00" }, title: { simpleText: "Start" } } },
      { macroMarkersListItemRenderer: { timeDescription: { simpleText: "1:02:03" }, title: { simpleText: "End" } } }
    ] }
  } } }] };
  assert.deepEqual(parseChapterPayload(payload), [{ start: 0, title: "Start" }, { start: 3723, title: "End" }]);
});

test("finds active chapter and selects away from the chapter that ended", () => {
  const chapters = normalizeChapters([{ start: 0, title: "A" }, { start: 10, title: "B" }, { start: 20, title: "C" }]);
  assert.equal(chapterIndexAt(chapters, 10), 1);
  assert.equal(chooseOtherChapter(chapters, 0, () => 0), 1);
  assert.equal(chooseOtherChapter(chapters, 2, () => 0.99), 1);
  assert.equal(chooseOtherChapter(chapters.slice(0, 1), 0), -1);
});

test("skips visited chapters, starts a new round, and always excludes the finished chapter", () => {
  const chapters = normalizeChapters([{ start: 0, title: "A" }, { start: 10, title: "B" }, { start: 20, title: "C" }]);
  const first = chooseUnplayedOtherChapter(chapters, 0, new Set([0]), false, () => 0);
  assert.equal(first.index, 1);
  assert.deepEqual([...first.played], [0]);
  const next = chooseUnplayedOtherChapter(chapters, 1, new Set([0, 10]), false, () => 0);
  assert.equal(next.index, 2, "visited A is skipped while C remains unplayed");
  const round = chooseUnplayedOtherChapter(chapters, 2, new Set([0, 10, 20]), false, () => 0);
  assert.equal(round.index, 0, "a new round restarts after all other chapters were visited");
  assert.deepEqual([...round.played], [20], "the new round keeps the just-finished chapter excluded");
  const repeat = chooseUnplayedOtherChapter(chapters, 2, new Set([0, 10, 20]), true, () => 0);
  assert.equal(repeat.index, 0, "allowing repeats still excludes the just-finished chapter");
});

test("recognizes natural boundaries and suppresses manual seeks", () => {
  assert.equal(shouldTriggerBoundary(9.8, 10.1, 10, { enabled: true }), true);
  assert.equal(shouldTriggerBoundary(3, 10.1, 10, { enabled: true }), false);
  assert.equal(shouldTriggerBoundary(9.8, 10.1, 10, { enabled: true, seeking: true }), false);
  assert.equal(shouldTriggerFinalEnd(29.7, 30, { enabled: true }), true);
  assert.equal(shouldTriggerFinalEnd(29.7, 30, { enabled: true, seeking: true }), false);
});

test("parses timestamps from chapter labels", () => {
  assert.equal(parseTimestamp("1:02:03"), 3723);
  assert.equal(parseTimestamp("not a timestamp"), NaN);
});

test("content playback excludes the finished chapter and persists state per video", async () => {
  const source = fs.readFileSync(require.resolve("../content.js"), "utf8");
  const styles = fs.readFileSync(require.resolve("../content.css"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(require.resolve("../manifest.json"), "utf8"));
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.match(styles, /background: var\(--random-chapters-background, transparent\)/);
  assert.match(styles, /\.random-chapters-status\.is-enabled\s*\{\s*font-weight:\s*700;/);
  assert.doesNotMatch(styles, /opacity: 0\.88/);
  const store = { randomChapters: { A: false, B: false } };
  const listeners = new Map();
  const buttonList = [];
  const button = () => {
    const item = {
      className: "", attributes: {}, handlers: {}, dataset: {}, parentNode: null, previousElementSibling: null, hidden: false, children: [], _text: "",
      get textContent() { return this.children.length ? this.children.map((child) => child.textContent).join("") : this._text; },
      set textContent(value) { this.children = []; this._text = value; },
      append(...items) { this.children.push(...items); },
      querySelector(selector) { return selector === ".random-chapters-status" ? this.children.find((child) => child.className.split(/\s+/).includes("random-chapters-status")) || null : null; },
      style: {
        properties: {},
        getPropertyValue(key) { return this.properties[key] || ""; },
        setProperty(key, value) { this.properties[key] = value; }
      },
      setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return this.attributes[key] ?? null; },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      matches(selector) { return selector.split(",").some((part) => part.trim() === "button"); },
      closest() { return null; },
      remove() { this.parentNode = null; this.previousElementSibling = null; const i = buttonList.indexOf(this); if (i >= 0) buttonList.splice(i, 1); },
      click() { this.handlers.click({ preventDefault() {}, stopPropagation() {} }); }
    };
    item.classList = { toggle(name, force) {
      const classes = new Set(item.className.split(/\s+/).filter(Boolean));
      if (force) classes.add(name); else classes.delete(name);
      item.className = [...classes].join(" ");
    } };
    return item;
  };
  let containerIsButton = false;
  const chapterTitle = {
    hidden: false,
    getBoundingClientRect: () => ({ width: 100, height: 36 }),
    matches: (selector) => selector.split(",").some((part) => part.trim() === ".ytp-chapter-title.ytp-button"),
    querySelector: (selector) => selector === ".ytp-chapter-title-content" ? chapterTitleContent : null,
    closest: (selector) => selector.includes("[hidden]") ? null : null,
    insertAdjacentElement(_where, element) { element.parentNode = chapterContainer; element.previousElementSibling = this; buttonList.push(element); }
  };
  const chapterTitleContent = { textContent: "", getBoundingClientRect: () => ({ width: 100, height: 16 }) };
  const chapterContainer = {
    hidden: false,
    matches: (selector) => containerIsButton && selector.split(",").some((part) => ["button", ".ytp-button"].includes(part.trim())),
    closest: () => null,
    insertAdjacentElement(_where, element) { element.parentNode = this; element.previousElementSibling = this; buttonList.push(element); },
    querySelector(selector) {
      if (selector === ".ytp-chapter-title-content") return chapterTitleContent;
      if (selector.includes(".ytp-chapter-title")) return chapterTitle;
      if (selector === ".random-chapters-toggle") return buttonList.find((item) => item.parentNode === chapterContainer) || null;
      return null;
    }
  };
  let nativeChapterUi = true;
  const paneTitle = {
    id: "title",
    hidden: false,
    matches: (selector) => selector.includes("#title"),
    closest: () => null,
    insertAdjacentElement(_where, element) { element.parentNode = chapterHeader; element.previousElementSibling = this; buttonList.push(element); }
  };
  const chapterList = {};
  const chapterHeader = { id: "header", tagName: "H2", children: [paneTitle] };
  const chapterPanel = {
    id: "engagement-panel-macro-markers-description-chapters",
    tagName: "YTD-ENGAGEMENT-PANEL-SECTION-LIST-RENDERER",
    getAttribute(name) { return name === "target-id" ? this.id : null; },
    children: [
      { tagName: "YTD-ENGAGEMENT-PANEL-TITLE-HEADER-RENDERER", children: [chapterHeader] },
      { tagName: "YTD-MACRO-MARKERS-LIST-RENDERER", children: [chapterList] }
    ],
    querySelector(selector) {
      if (selector.includes("ytd-macro-markers-list-renderer")) return chapterList;
      if (selector.includes("ytd-engagement-panel-title-header-renderer") && selector.includes("#title") && selector.includes("#header")) return chapterHeader;
      if (selector.includes("ytd-engagement-panel-title-header-renderer") && selector.includes("#title")) return paneTitle;
      if (selector.includes("ytd-engagement-panel-title-header-renderer") && selector.includes("#header")) return chapterHeader;
      return null;
    }
  };
  const mostReplayedTitle = { id: "title", hidden: false, closest: () => null };
  const mostReplayedPanel = {
    id: "engagement-panel-macro-markers-description-most-replayed",
    getAttribute(name) { return name === "target-id" ? this.id : null; },
    querySelector(selector) {
      if (selector.includes("ytd-macro-markers-list-renderer")) return chapterList;
      if (selector.includes("ytd-engagement-panel-title-header-renderer") && selector.includes("#title")) return mostReplayedTitle;
      return null;
    }
  };
  const videoListeners = new Map();
  const video = {
    currentTime: 9.8, duration: 40, paused: false,
    addEventListener(type, handler) { videoListeners.set(type, handler); },
    removeEventListener(type) { videoListeners.delete(type); },
    play() { return Promise.resolve(); },
    emit(type) { videoListeners.get(type)?.(); }
  };
  let adShowing = false;
  const document = {
    documentElement: {},
    createElement: () => button(),
    querySelector(selector) {
      if (selector === "video.html5-main-video") return video;
      if (selector === ".ytp-chapter-container") return nativeChapterUi ? chapterContainer : null;
      const placement = selector.match(/data-random-chapters-placement="(player|panel)"/);
      if (placement) {
        return buttonList.find((item) => item.parentNode && item.dataset.randomChaptersPlacement === placement[1]) || null;
      }
      if (selector === ".ad-showing, .ad-interrupting, .ytp-ad-player") return adShowing ? {} : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".random-chapters-toggle") return buttonList.filter((item) => item.parentNode);
      if (selector === "ytd-engagement-panel-section-list-renderer") return [mostReplayedPanel, chapterPanel];
      return [];
    }
  };
  const location = { href: "https://www.youtube.com/watch?v=A", origin: "https://www.youtube.com" };
  const timeoutQueue = new Map();
  let nextTimerId = 0;
  const window = {
    getComputedStyle: (element) => element === chapterTitleContent
      ? { fontSize: "13px", fontFamily: "Arial", fontWeight: "500", fontStyle: "italic", letterSpacing: "0.1px", lineHeight: "normal", color: "rgb(255, 255, 255)", textShadow: "none" }
      : { height: "36px", backgroundColor: "rgba(0, 0, 0, 0.3)", backgroundImage: "none", backdropFilter: "blur(2px)", boxShadow: "none", opacity: "1", paddingTop: "2px", paddingRight: "6px", paddingBottom: "2px", paddingLeft: "6px", border: "0px none rgb(255, 255, 255)", borderRadius: "2px" },
    setInterval: () => 1, clearInterval() {},
    setTimeout(fn) { const id = ++nextTimerId; timeoutQueue.set(id, fn); return id; },
    clearTimeout(id) { timeoutQueue.delete(id); },
    addEventListener(type, fn) { const group = listeners.get(type) || []; group.push(fn); listeners.set(type, group); },
    postMessage() {}
  };
  function flushTimers() {
    while (timeoutQueue.size) {
      const [id, callback] = timeoutQueue.entries().next().value;
      timeoutQueue.delete(id);
      callback();
    }
  }
  let storageChangeListener = null;
  let contentMessageListener = null;
  const chrome = {
    storage: {
      local: {
        get(key, callback) { callback({ [key]: Boolean(store[key]) }); },
        set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          storageChangeListener?.(changes, "local");
        }
      },
      onChanged: { addListener(handler) { storageChangeListener = handler; } }
    },
    runtime: {
      lastError: null,
      onMessage: { addListener(handler) { contentMessageListener = handler; } },
      sendMessage(_message, callback) { callback?.(); }
    }
  };
  class MutationObserver { observe() {} disconnect() {} }
  const vmUtils = {
    ...require("../chapter-utils.js"),
    chooseUnplayedOtherChapter: (items, finishedIndex, played, allowRepeats) =>
      chooseUnplayedOtherChapter(items, finishedIndex, played, allowRepeats, () => 0)
  };
  const sandbox = {
    URL,
    document, location, window, chrome, MutationObserver,
    RandomChapterUtils: vmUtils
  };
  vm.runInNewContext(source, sandbox);
  assert.equal(buttonList.filter((item) => item.parentNode && item.dataset.randomChaptersPlacement === "player").length, 0,
    "empty native chapter placeholder stays hidden");
  assert.equal(buttonList.filter((item) => item.parentNode && item.dataset.randomChaptersPlacement === "panel").length, 0,
    "chapter pane has no random toggle");
  chapterTitleContent.textContent = "Opening";
  for (const handler of listeners.get("yt-navigate-finish") || []) handler();
  assert.equal(buttonList.filter((item) => item.parentNode && item.dataset.randomChaptersPlacement === "player").length, 1,
    "visible native chapter title allows the fallback toggle");
  assert.equal(buttonList.find((item) => item.dataset.randomChaptersPlacement === "player").style.properties["--random-chapters-height"], "36px",
    "controller toggle copies the native chapter control height");
  const styledToggle = buttonList.find((item) => item.dataset.randomChaptersPlacement === "player");
  assert.equal(styledToggle.style.properties["--random-chapters-font-size"], "13px",
    "controller toggle copies typography from the native title text");
  assert.equal(styledToggle.style.properties["--random-chapters-background"], "rgba(0, 0, 0, 0.3)",
    "controller toggle copies the native control background");
  assert.equal(styledToggle.style.properties["--random-chapters-backdrop-filter"], "blur(2px)",
    "controller toggle copies the native control backdrop filter");
  nativeChapterUi = false;
  for (const handler of listeners.get("yt-navigate-finish") || []) handler();
  assert.equal(buttonList.some((item) => item.parentNode && item.dataset.randomChaptersPlacement === "player"), false,
    "player toggle is removed when the native chapter affordance is absent");
  nativeChapterUi = true;
  for (const handler of listeners.get("yt-navigate-finish") || []) handler();
  containerIsButton = true;
  for (const handler of listeners.get("yt-navigate-finish") || []) handler();
  assert.equal(buttonList.find((item) => item.dataset.randomChaptersPlacement === "player").previousElementSibling, chapterContainer,
    "legacy chapter-container button receives an adjacent toggle");
  containerIsButton = false;
  for (const handler of listeners.get("yt-navigate-finish") || []) handler();
  assert.equal(buttonList.find((item) => item.dataset.randomChaptersPlacement === "player").previousElementSibling, chapterContainer,
    "toggle stays outside the chapter container that clips its title");
  function deliver(id) {
    for (const handler of listeners.get("message") || []) handler({
      source: window, origin: location.origin,
      data: { type: "random-chapters:player-data", videoId: id, chapters: [
        { start: 0, title: "A" }, { start: 10, title: "B" }, { start: 20, title: "C" }, { start: 30, title: "D" }
      ] }
    });
    flushTimers();
  }
  deliver("A");
  for (const handler of listeners.get("yt-navigate-finish") || []) handler();
  for (const handler of listeners.get("yt-navigate-finish") || []) handler();
  const toggleA = buttonList.find((item) => item.parentNode);
  assert.equal(buttonList.filter((item) => item.parentNode && item.dataset.randomChaptersPlacement === "player").length, 1,
    "repeated sync does not insert duplicate player controls");
  assert.ok(toggleA);
  toggleA.click();
  assert.equal(store["randomChapters:A"], true);
  assert.equal(toggleA.textContent, "Random chapter: On");
  assert.equal(toggleA.querySelector(".random-chapters-status").textContent, "On");
  assert.equal(toggleA.querySelector(".random-chapters-status").className, "random-chapters-status is-enabled");
  assert.equal(toggleA.getAttribute("aria-label"), "Random chapters: On");
  let rpcState = null;
  contentMessageListener({ type: "random-chapters:get-state" }, {}, (state) => { rpcState = state; });
  assert.equal(rpcState.videoId, "A");
  assert.equal(rpcState.hasChapters, true);
  contentMessageListener({ type: "random-chapters:set-enabled", videoId: "stale", enabled: false }, {}, (state) => { rpcState = state; });
  assert.equal(store["randomChapters:A"], true, "stale popup requests cannot change the active video's setting");

  video.emit("playing");

  video.currentTime = 10.1;
  video.emit("timeupdate");
  flushTimers();
  assert.equal(video.currentTime, 10.05, "chapter A ends and the first unplayed chapter is selected");

  video.currentTime = 19.8;
  video.emit("timeupdate");
  video.currentTime = 20.1;
  video.emit("timeupdate");
  flushTimers();
  assert.equal(video.currentTime, 20.05, "chapter B ends and the next unplayed chapter is selected");

  store.allowPlayedChapterRepeats = true;
  storageChangeListener({ allowPlayedChapterRepeats: { oldValue: false, newValue: true } }, "local");
  video.currentTime = 29.8;
  video.emit("timeupdate");
  video.currentTime = 30.1;
  video.emit("timeupdate");
  flushTimers();
  assert.equal(video.currentTime, 0.05, "the saved repeat option permits an earlier visited chapter");

  video.emit("seeking");
  video.currentTime = 10.1;
  video.emit("timeupdate");
  video.emit("seeked");
  assert.equal(video.currentTime, 10.1, "manual seek across chapter boundary does not trigger a jump");

  adShowing = true;
  video.currentTime = 29.8;
  video.emit("playing");
  video.currentTime = 30.1;
  video.emit("timeupdate");
  assert.equal(video.currentTime, 30.1, "ad playback does not trigger a chapter jump");
  adShowing = false;

  video.currentTime = 39.7;
  video.emit("playing");
  video.emit("timeupdate");
  flushTimers();
  assert.equal(video.currentTime, 0.05, "last chapter end selects a chapter other than the last one");

  location.href = "https://www.youtube.com/watch?v=B";
  for (const handler of listeners.get("yt-navigate-finish") || []) handler();
  deliver("B");
  const toggleB = buttonList.find((item) => item.parentNode);
  assert.equal(toggleB.attributes["aria-pressed"], "false", "video B remains off by default");
  assert.equal(toggleB.getAttribute("aria-label"), "Random chapters: Off");
  assert.equal(toggleB.textContent, "Random chapter: Off");
  assert.equal(toggleB.querySelector(".random-chapters-status").className, "random-chapters-status");
  assert.equal(store["randomChapters:A"], true);
  contentMessageListener({ type: "random-chapters:set-enabled", videoId: "A", enabled: false }, {}, (state) => { rpcState = state; });
  assert.equal(rpcState.videoId, "B");
  assert.equal(store["randomChapters:A"], true, "a popup from the previous video cannot toggle the new video");
  assert.equal(typeof contentMessageListener, "function", "content script registers popup RPC handling");

  location.href = "https://www.youtube.com/watch?v=C";
  chapterTitleContent.textContent = "";
  for (const handler of listeners.get("yt-navigate-finish") || []) handler();
  for (const handler of listeners.get("message") || []) handler({
    source: window, origin: location.origin,
    data: { type: "random-chapters:player-data", videoId: "C", chapters: [], authoritative: true }
  });
  flushTimers();
  assert.equal(buttonList.some((item) => item.parentNode && item.dataset.randomChaptersPlacement === "player"), false,
    "chapterless video stays hidden after authoritative empty bridge data");

  location.href = "https://www.youtube.com/watch?v=A";
  for (const handler of listeners.get("yt-navigate-finish") || []) handler();
  deliver("A");
  const restoredToggleA = buttonList.find((item) => item.parentNode);
  assert.ok(restoredToggleA, "valid current-video chapter data restores the toggle without a native title");
  assert.equal(restoredToggleA.attributes["aria-pressed"], "true", "returning to A restores its saved setting");
  assert.equal(restoredToggleA.textContent, "Random chapter: On");
  for (const handler of listeners.get("message") || []) handler({
    source: window, origin: location.origin,
    data: { type: "random-chapters:player-data", videoId: "A", chapters: [], authoritative: false }
  });
  flushTimers();
  assert.ok(buttonList.some((item) => item.parentNode && item.dataset.randomChaptersPlacement === "player"),
    "unknown empty bridge data does not erase confirmed chapters");
});
