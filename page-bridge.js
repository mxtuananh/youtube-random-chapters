(() => {
  "use strict";
  const messageType = "random-chapters:player-data";

  function findCurrentEndpointId(value, depth = 0, visited = new WeakSet()) {
    if (!value || typeof value !== "object" || depth > 12 || visited.has(value)) return "";
    visited.add(value);
    if (value.currentVideoEndpoint?.watchEndpoint?.videoId) return value.currentVideoEndpoint.watchEndpoint.videoId;
    if (Array.isArray(value)) {
      for (const item of value) {
        const id = findCurrentEndpointId(item, depth + 1, visited);
        if (id) return id;
      }
    } else {
      for (const child of Object.values(value)) {
        const id = findCurrentEndpointId(child, depth + 1, visited);
        if (id) return id;
      }
    }
    return "";
  }

  function idIn(data) {
    return data?.videoDetails?.videoId
      || data?.playerResponse?.videoDetails?.videoId
      || data?.videoId
      || data?.currentVideoEndpoint?.watchEndpoint?.videoId
      || data?.response?.currentVideoEndpoint?.watchEndpoint?.videoId
      || data?.response?.videoDetails?.videoId
      || findCurrentEndpointId(data)
      || "";
  }

  function readData(element) {
    try { return element?.data || null; } catch (_) { return null; }
  }

  function matchingPayloads(expectedId) {
    const player = document.getElementById("movie_player");
    let playerResponse = null;
    try { playerResponse = player?.getPlayerResponse?.() || null; } catch (_) {}
    const flexy = document.querySelector("ytd-watch-flexy");
    const app = document.querySelector("ytd-app");
    const candidates = [
      playerResponse,
      window.ytInitialPlayerResponse,
      readData(flexy),
      readData(app),
      window.ytInitialData
    ].filter(Boolean);
    return candidates
      .map((payload) => ({ payload, id: idIn(payload) }))
      .filter((candidate) => candidate.id === expectedId);
  }

  function hasChapterSections(payload) {
    return Boolean(payload?.playerOverlays || payload?.engagementPanels
      || payload?.response?.playerOverlays || payload?.response?.engagementPanels);
  }

  function sendPlayerData() {
    try {
      const videoId = new URL(location.href).searchParams.get("v") || "";
      if (!videoId) return;
      let chapters = [];
      const candidates = matchingPayloads(videoId);
      for (const { payload } of candidates) {
        chapters = RandomChapterUtils.parseChapterPayload(payload);
        if (chapters.length > 1) break;
      }
      // Repeat delivery so the isolated content script cannot miss the initial event.
      window.postMessage({
        type: messageType,
        videoId,
        chapters,
        authoritative: candidates.some(({ payload }) => hasChapterSections(payload))
      }, location.origin);
    } catch (_) {
      // Player data may be incomplete while YouTube is replacing its player.
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== "random-chapters:request") return;
    sendPlayerData();
  });
  window.addEventListener("yt-navigate-finish", sendPlayerData);
  window.addEventListener("yt-page-data-updated", sendPlayerData);
  const timer = window.setInterval(sendPlayerData, 1000);
  window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true });
})();
