/** The As you Go pill's six places: each device (this one and the paired ones) in two modes, its real
 * files ('files') or its As you Go ('ayg').
 *
 * Another device's As you Go is a separate page (a layer on the phone, the same tab on a computer).
 * Choosing anything else from there leaves that page and hands the choice to this device's own page
 * through localStorage, which the own page reads on load or from the storage event. That is what
 * makes "This device" land on this device instead of on whatever the own page was showing before. */
const INTENT = 'papers:ayg:navigate-intent', FRESH_MS = 20000;
const REMOTE = /^\\\\papers~([0-9a-f-]{36})/i;

export function currentDeviceMode({ remoteDevice = null, mode = 'ayg', path = '' } = {}) {
  if (remoteDevice) return { device: String(remoteDevice).toLowerCase(), mode: mode === 'machine' ? 'files' : 'ayg' };
  const remote = mode === 'machine' && REMOTE.exec(String(path || ''));
  if (remote) return { device: remote[1].toLowerCase(), mode: 'files' };
  return { device: 'self', mode: mode === 'machine' ? 'files' : 'ayg' };
}
export const sameDeviceMode = (a, b) => Boolean(a && b) && a.device === b.device && a.mode === b.mode;

export function writeNavigateIntent(storage, target, now = Date.now()) {
  try { storage.setItem(INTENT, JSON.stringify({ device: target.device, mode: target.mode, at: now })); return true; } catch { return false; }
}
/** Takes a fresh hand-off once (null when there is none). */
export function takeNavigateIntent(storage, now = Date.now()) {
  let raw = null; try { raw = storage.getItem(INTENT); } catch { return null; }
  if (!raw) return null;
  try { storage.removeItem(INTENT); } catch {}
  try {
    const value = JSON.parse(raw);
    if (!value || now - Number(value.at) > FRESH_MS || now < Number(value.at) - 1000) return null;
    if (!['files', 'ayg'].includes(value.mode) || !(value.device === 'self' || /^[0-9a-f-]{36}$/i.test(value.device))) return null;
    return { device: value.device === 'self' ? 'self' : value.device.toLowerCase(), mode: value.mode };
  } catch { return null; }
}
export const NAVIGATE_INTENT_KEY = INTENT;
