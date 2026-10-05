/** Distinguishes a new workspace selection from a refresh of the same one. */
export function createBrowserSourceSelection() {
  let selected = null;
  return {
    update(source, url) {
      const key = source?.shortcutId ? 'shortcut:' + source.shortcutId : 'url:' + url;
      if (selected?.key === key && selected.url === url) return false;
      selected = { key, url };
      return true;
    },
    clear() { selected = null; },
  };
}
