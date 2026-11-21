const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadPopup({ url = "https://www.youtube.com/watch?v=A", state = null, initialSaved = {} } = {}) {
  const source = fs.readFileSync(require.resolve("../popup.js"), "utf8");
  const elements = new Map(["video-enabled", "allow-repeats", "video-status"].map((id) => [id, {
    id, checked: false, disabled: id !== "video-status", textContent: "", handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; }
  }]));
  const saved = { ...initialSaved };
  const messages = [];
  const storageListeners = [];
  const dom = { getElementById: (id) => elements.get(id) };
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(handler) { this.handler = handler; } }
    },
    storage: {
      local: {
        get(_key, callback) { callback({ ...saved }); },
        set(values) { Object.assign(saved, values); }
      },
      onChanged: { addListener(handler) { storageListeners.push(handler); } }
    },
    tabs: {
      query(_query, callback) { callback([{ id: 12, url }]); },
      sendMessage(tabId, message, callback) {
        messages.push({ tabId, message });
        callback(message.type === "random-chapters:get-state" ? state : {
          type: "random-chapters:state", videoId: "A", enabled: message.enabled, hasChapters: true
        });
      }
    }
  };
  vm.runInNewContext(source, { document: dom, chrome });
  return { elements, saved, messages, storageListeners };
}

test("popup loads default-off preference, saves it, and toggles the active video through RPC", () => {
  const popup = loadPopup({ state: { type: "random-chapters:state", videoId: "A", enabled: false, hasChapters: true } });
  const enabled = popup.elements.get("video-enabled");
  const repeats = popup.elements.get("allow-repeats");
  assert.equal(repeats.checked, false, "repeat permission defaults off");
  assert.equal(repeats.disabled, false, "repeat preference is enabled after loading its saved value");
  assert.equal(enabled.disabled, false, "a chaptered active video can be toggled");

  repeats.checked = true;
  repeats.handlers.change();
  assert.equal(popup.saved.allowPlayedChapterRepeats, true);
  enabled.checked = true;
  enabled.handlers.change();
  const sent = popup.messages.at(-1);
  assert.equal(sent.tabId, 12);
  assert.equal(sent.message.type, "random-chapters:set-enabled");
  assert.equal(sent.message.videoId, "A");
  assert.equal(sent.message.enabled, true);
});

test("popup disables the video switch outside YouTube", () => {
  const popup = loadPopup({ url: "https://example.com/", state: null });
  assert.equal(popup.elements.get("video-enabled").disabled, true);
  assert.match(popup.elements.get("video-status").textContent, /YouTube/);
  assert.equal(popup.messages.length, 0);
});

test("popup restores a saved repeat preference", () => {
  const popup = loadPopup({ initialSaved: { allowPlayedChapterRepeats: true } });
  assert.equal(popup.elements.get("allow-repeats").checked, true);
});
