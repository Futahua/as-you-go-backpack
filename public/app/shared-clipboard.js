// One Papers clipboard per computer, shared by every Files pane and window (all As you Go pages on
// this computer share an origin and so this storage). A copy or cut anywhere replaces it; a paste
// anywhere reads it. Files are kept as paths: this computer's as they are, another device's as
// \\papers~<device>\..., so a paste elsewhere can link, download or send them. As you Go item ids
// are kept too, but only pages showing the same As you Go (same scope) can paste them as items.
const KEY = 'papers-shared-clipboard';
const REMOTE = /^\\\\papers~[0-9a-f-]{36}\\/i;

export function createSharedClipboard({ window: win, deviceId = null }) {
  const page = win.crypto.randomUUID();
  const scope = deviceId || 'local';
  const storage = (() => { try { return win.localStorage; } catch { return null; } })();
  const read = () => { try { const value = JSON.parse(storage?.getItem(KEY) || 'null'); return value && typeof value.id === 'string' ? value : null; } catch { return null; } };
  const save = (record) => { try { if (record) storage?.setItem(KEY, JSON.stringify(record)); else storage?.removeItem(KEY); } catch { /* this page still pastes its own copy */ } };
  // A view of another device shows that device's paths (C:\...); the shared record names the device.
  const qualify = (path) => deviceId && !REMOTE.test(path) ? `\\\\papers~${deviceId}\\${path}` : path;
  return {
    page,
    scope,
    write({ cut = false, paths = [], ayg = null }) {
      const record = { id: win.crypto.randomUUID(), page, scope, at: Date.now(), cut: Boolean(cut),
        paths: [...new Set(paths.filter((path) => typeof path === 'string' && path).map(qualify))], ayg, fingerprint: null };
      save(record);
      return record.id;
    },
    /** The Windows clipboard's fingerprint at copy time: a later Windows copy makes this record stale. */
    setFingerprint(id, fingerprint) { const record = read(); if (record?.id === id && fingerprint) { record.fingerprint = fingerprint; save(record); } },
    /** The record, unless the Windows clipboard has changed since it was written. */
    current(fingerprint) {
      const record = read();
      if (!record) return null;
      if (record.fingerprint && fingerprint && fingerprint !== record.fingerprint) return null;
      return record;
    },
    /** A cut is pasted once; afterwards the clipboard is empty everywhere. */
    consume(id) { if (read()?.id === id) save(null); },
  };
}

export const devicePathOwner = (path) => REMOTE.exec(path)?.[0].slice(9, -1).toLowerCase() || 'local';
