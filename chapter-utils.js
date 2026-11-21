(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RandomChapterUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeChapters(input) {
    if (!Array.isArray(input)) return [];
    const chapters = input
      .map((item) => ({ start: Number(item.start), title: String(item.title || "").trim() }))
      .filter((item) => Number.isFinite(item.start) && item.start >= 0 && item.title)
      .sort((a, b) => a.start - b.start);
    return chapters.filter((chapter, index) => index === 0 || chapter.start > chapters[index - 1].start);
  }

  function textValue(value) {
    if (typeof value === "string") return value.trim();
    return value?.simpleText?.trim?.() || value?.runs?.map((run) => run.text || "").join("").trim() || "";
  }

  function parseTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parts = String(value || "").trim().split(":");
    if (parts.length < 2 || parts.length > 3 || !parts.every((part) => /^\d+(?:\.\d+)?$/.test(part))) return NaN;
    return parts.reduce((total, part) => total * 60 + Number(part), 0);
  }

  function chaptersFromRenderers(items) {
    if (!Array.isArray(items)) return [];
    return normalizeChapters(items.map((item) => {
      const renderer = item?.chapterRenderer;
      return renderer ? {
        start: Number(renderer.timeRangeStartMillis) / 1000,
        title: textValue(renderer.title)
      } : null;
    }).filter(Boolean));
  }

  function chaptersFromMacroMarkers(renderer) {
    const contents = renderer?.contents;
    if (!Array.isArray(contents)) return [];
    return normalizeChapters(contents.map((item) => {
      const marker = item?.macroMarkersListItemRenderer;
      return marker ? {
        start: parseTimestamp(textValue(marker.timeDescription)),
        title: textValue(marker.title)
      } : null;
    }).filter(Boolean));
  }

  function parseChapterPayload(payload) {
    const visited = new WeakSet();
    const candidates = { playerBar: [], macroMarkers: [] };
    function visit(value, depth) {
      if (!value || typeof value !== "object" || depth > 32 || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, depth + 1));
        return;
      }
      if (Array.isArray(value.chapters)) {
        const chapters = chaptersFromRenderers(value.chapters);
        if (chapters.length > candidates.playerBar.length) candidates.playerBar = chapters;
      }
      if (value.macroMarkersListRenderer) {
        const chapters = chaptersFromMacroMarkers(value.macroMarkersListRenderer);
        if (chapters.length > candidates.macroMarkers.length) candidates.macroMarkers = chapters;
      }
      if (Array.isArray(value.markersMap)) {
        for (const entry of value.markersMap) {
          if (String(entry?.key || "").toUpperCase() !== "CHAPTERS") continue;
          const chapters = normalizeChapters((entry.value?.markers || []).map((marker) => ({
            start: Number(marker.startMillis) / 1000,
            title: textValue(marker.title)
          })));
          if (chapters.length > candidates.playerBar.length) candidates.playerBar = chapters;
        }
      }
      Object.values(value).forEach((child) => visit(child, depth + 1));
    }
    visit(payload, 0);
    return candidates.playerBar.length >= 2 ? candidates.playerBar : candidates.macroMarkers;
  }

  function chapterIndexAt(chapters, time) {
    let result = -1;
    for (let i = 0; i < chapters.length; i += 1) {
      if (chapters[i].start > time) break;
      result = i;
    }
    return result;
  }

  function chooseOtherChapter(chapters, finishedIndex, random = Math.random) {
    const candidates = chapters.map((_, index) => index).filter((index) => index !== finishedIndex);
    if (candidates.length === 0) return -1;
    const position = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
    return candidates[position];
  }

  function chooseUnplayedOtherChapter(chapters, finishedIndex, playedStarts, allowRepeats, random = Math.random) {
    const played = new Set(playedStarts || []);
    const otherIndices = chapters.map((_, index) => index).filter((index) => index !== finishedIndex);
    if (allowRepeats) return { index: chooseOtherChapter(chapters, finishedIndex, random), played };
    let candidates = otherIndices.filter((index) => !played.has(chapters[index].start));
    if (candidates.length === 0) {
      played.clear();
      if (finishedIndex >= 0 && chapters[finishedIndex]) played.add(chapters[finishedIndex].start);
      candidates = otherIndices;
    }
    if (candidates.length === 0) return { index: -1, played };
    const position = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
    return { index: candidates[position], played };
  }

  function shouldTriggerBoundary(previousTime, currentTime, boundary, options = {}) {
    if (!options.enabled || options.seeking) return false;
    const nearSeconds = options.nearSeconds ?? 2;
    return currentTime >= boundary && previousTime < boundary && previousTime >= boundary - nearSeconds;
  }

  function shouldTriggerFinalEnd(currentTime, duration, options = {}) {
    if (!options.enabled || options.seeking || !Number.isFinite(duration)) return false;
    const leadSeconds = options.leadSeconds ?? 0.5;
    return duration - currentTime <= leadSeconds && duration - currentTime >= 0;
  }

  return {
    normalizeChapters,
    parseChapterPayload,
    parseTimestamp,
    chapterIndexAt,
    chooseOtherChapter,
    chooseUnplayedOtherChapter,
    shouldTriggerBoundary,
    shouldTriggerFinalEnd
  };
});
