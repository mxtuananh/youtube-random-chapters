(() => {
  "use strict";
  const repeatKey = "allowPlayedChapterRepeats";
  const enabledInput = document.getElementById("video-enabled");
  const repeatsInput = document.getElementById("allow-repeats");
  const status = document.getElementById("video-status");
  let activeTabId = null;
  let ready = false;
  let videoId = "";

  function renderState(state) {
    if (!state || state.type !== "random-chapters:state") return;
    videoId = state.videoId || "";
    enabledInput.disabled = !state.videoId || !state.hasChapters;
    enabledInput.checked = Boolean(state.enabled);
    status.textContent = !state.videoId
      ? "Open a YouTube video to use this feature."
      : state.hasChapters
        ? ""
        : "No chapters found for this video.";
    ready = Boolean(state.videoId && state.hasChapters);
  }

  chrome.storage.local.get(repeatKey, (items) => {
    repeatsInput.checked = Boolean(items[repeatKey]);
    repeatsInput.disabled = false;
  });
  repeatsInput.addEventListener("change", () => {
    chrome.storage.local.set({ [repeatKey]: repeatsInput.checked });
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    activeTabId = tab?.id ?? null;
    if (!tab?.url?.startsWith("https://www.youtube.com/")) {
      renderState({ type: "random-chapters:state", videoId: "", hasChapters: false });
      return;
    }
    chrome.tabs.sendMessage(activeTabId, { type: "random-chapters:get-state" }, (state) => {
      if (chrome.runtime.lastError) {
        renderState({ type: "random-chapters:state", videoId: "", hasChapters: false });
        status.textContent = "YouTube is still loading. Reopen the menu after the video finishes loading.";
        return;
      }
      renderState(state);
    });
  });

  enabledInput.addEventListener("change", () => {
    if (!ready || activeTabId == null) return;
    chrome.tabs.sendMessage(activeTabId, {
      type: "random-chapters:set-enabled",
      videoId,
      enabled: enabledInput.checked
    }, (state) => {
      if (chrome.runtime.lastError) {
        ready = false;
        enabledInput.disabled = true;
        status.textContent = "Could not update the playback state. Reopen the menu to try again.";
        return;
      }
      renderState(state);
    });
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.tab?.id === activeTabId) renderState(message);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[repeatKey]) repeatsInput.checked = Boolean(changes[repeatKey].newValue);
  });
})();
