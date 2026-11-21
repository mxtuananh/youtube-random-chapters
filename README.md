# Random YouTube Chapters

A Chrome MV3 extension that adds a random-play toggle next to YouTube's View chapters button. Enable the feature for the current video with the Random button in the extension menu or the button beside the chapters. The enabled state is stored separately for each video and is off by default.

## Installation

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this project folder.
4. Reload any open YouTube watch page.

## Behavior and limitations

- Supports standard video pages in the `youtube.com/watch?v=...` format.
- Reads available chapter markers from YouTube's player data, with the chapter list DOM as a fallback. The extension makes no network requests and does not open the chapter panel automatically.
- During each playback, the extension tracks which chapters have started playing in the current page session. This history is preserved when navigating between videos within YouTube, but resets when the page is reloaded.
- By default, a chapter that has played is skipped until every other chapter has played; then the extension starts a new round automatically. Enable **Allow replaying played chapters** in the extension menu to allow earlier repeats. This option applies globally to the extension and is saved. The chapter that just ended is always excluded from the next selection.
- Manually seeking does not trigger a random jump. A chapter counts as played when the video actually starts or resumes playback at that chapter.
- Videos with fewer than two detected chapters are not skipped automatically.
- YouTube may change its player data structure. If the page does not provide chapter data, the extension may not detect chapters.

## Run utility tests

Run `node --test tests/chapter-utils.test.cjs` with Node.js.

## Updating the extension

After updating the extension files, open `chrome://extensions` and select **Reload** for this extension. Then reload the YouTube watch page.
