/**
 * 019G (RoketPuncha AYG lane): the member hover-preview controller. Consumes
 * ONLY the exact shared thumbnail API/result from the Papers host bridge
 * (`host.windowThumbnailCapability(capability, { maxWidth, maxHeight })`).
 *
 * On member hover the caller shows the full title immediately and calls
 * `schedule(layoutId, memberId)`: capture is debounced 120 ms, the member's
 * current capability is resolved through the existing runtime logic, a 240x135
 * thumbnail is requested, and an `<img>` is rendered ONLY for a strictly valid
 * success (`outcome:'success'`, a `data:image/png;base64,...` URL, integer
 * bounded dimensions). A generation/latest-only guard drops old replies when
 * hovering rapidly; `cancel()` (pointer leave, card removal, picker start,
 * pagehide) discards pending work and clears the preview. Fallback stays
 * icon/name-only — a placeholder thumbnail is never fabricated. The controller
 * writes NO state/store; its only side-effect seams are setPreviewImage and
 * clearPreview.
 */

export const WINDOW_LAYOUT_PREVIEW_DEBOUNCE_MS = 120;
export const WINDOW_LAYOUT_PREVIEW_MAX_WIDTH = 240;
export const WINDOW_LAYOUT_PREVIEW_MAX_HEIGHT = 135;
export const WINDOW_LAYOUT_PREVIEW_DIMENSION_LIMIT = { maxWidth: 320, maxHeight: 180 };
export const WINDOW_LAYOUT_PREVIEW_MAX_DECODED_BYTES = 256 * 1024; // 256 KiB
export const WINDOW_LAYOUT_PREVIEW_MAX_URL_CHARS = 512 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DATA_PNG_PREFIX = 'data:image/png;base64,';
const SUCCESS_KEYS = ['height', 'imageUrl', 'outcome', 'width'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Strict base64 grammar (RFC 4648 alphabet, canonical padding) then decode.
 * Returns null for any alphabet/padding/length deviation; never trusts a
 * lenient platform decoder. */
function strictBase64ToBytes(base64) {
  if (typeof base64 !== 'string' || base64.length === 0 || base64.length % 4 !== 0) return null;
  const padMatch = /=+$/.exec(base64);
  const padding = padMatch ? padMatch[0].length : 0;
  if (padding > 2) return null;
  const core = base64.slice(0, base64.length - padding);
  if (core.length === 0) return null;
  if (!/^[A-Za-z0-9+/]+$/.test(core)) return null;
  const coreMod = core.length % 4;
  if (coreMod === 1) return null;
  if (coreMod === 2 && padding !== 2) return null;
  if (coreMod === 3 && padding !== 1) return null;
  if (coreMod === 0 && padding !== 0) return null;
  let binary;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  if (binary.length === 0) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decodes a `data:image/png;base64,...` URL and enforces the bounded data-URL
 * string, the decoded 256 KiB cap and the PNG magic signature. Null otherwise. */
function decodePngDataUrl(imageUrl) {
  if (typeof imageUrl !== 'string' || imageUrl.length === 0
    || imageUrl.length > WINDOW_LAYOUT_PREVIEW_MAX_URL_CHARS
    || !imageUrl.startsWith(DATA_PNG_PREFIX)) return null;
  const bytes = strictBase64ToBytes(imageUrl.slice(DATA_PNG_PREFIX.length));
  if (!bytes || bytes.length > WINDOW_LAYOUT_PREVIEW_MAX_DECODED_BYTES) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  return bytes;
}

/** 019GR strict success: exact `{ outcome:'success', imageUrl, width, height }`
 * keys, a bounded data-PNG URL with strict base64 grammar + PNG magic +
 * decoded <= 256 KiB, and positive integer dimensions within the 320x180
 * clamp. Anything else (typed fallback, extra keys, bad alphabet/padding/
 * signature, oversize) is rejected so no fabricated/oversized thumbnail ever
 * renders. */
export function isValidThumbnailSuccess(result) {
  if (!isPlainObject(result)) return false;
  const keys = Object.keys(result).sort();
  if (keys.length !== SUCCESS_KEYS.length
    || keys.some((key, index) => key !== SUCCESS_KEYS[index])) return false;
  if (result.outcome !== 'success') return false;
  if (decodePngDataUrl(result.imageUrl) === null) return false;
  const { width, height } = result;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width <= 0 || height <= 0) return false;
  if (width > WINDOW_LAYOUT_PREVIEW_DIMENSION_LIMIT.maxWidth
    || height > WINDOW_LAYOUT_PREVIEW_DIMENSION_LIMIT.maxHeight) return false;
  return true;
}

/** 019GR pure exact-member hover transition predicate. `targetMember` and
 * `relatedTargetMember` are the resolved member elements (or null) that the
 * delegated mouseover/mouseout computed via `closest('[data-wl-member]')`.
 * - 'outside': the pointer is not over a member (the delegated handler hides/
 *   cancels).
 * - 'inside': the pointer moved between descendants of the SAME member - do
 *   NOT reschedule or clear (the member has not changed).
 * - 'enter': the pointer entered a member from another member or the outside -
 *   show + schedule (and on mouseout: leave this exact member -> cancel). */
export function windowLayoutPreviewHoverState(targetMember, relatedTargetMember) {
  if (targetMember === null || targetMember === undefined) return 'outside';
  if (relatedTargetMember === targetMember) return 'inside';
  return 'enter';
}

export function createWindowLayoutMemberPreview({
  resolveCapability,
  requestThumbnail,
  debounceMs = WINDOW_LAYOUT_PREVIEW_DEBOUNCE_MS,
  setPreviewImage = () => undefined,
  clearPreview = () => undefined,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
}) {
  if (typeof resolveCapability !== 'function' || typeof requestThumbnail !== 'function') {
    throw new TypeError('the preview controller needs resolveCapability and requestThumbnail');
  }
  let generation = 0;
  let timer = null;

  async function capture(layoutId, memberId, gen) {
    if (gen !== generation) return;
    const capability = await resolveCapability(layoutId, memberId);
    if (gen !== generation) return;
    if (!capability) return; // icon/name-only fallback; no request
    let result;
    try {
      result = await requestThumbnail(capability, {
        maxWidth: WINDOW_LAYOUT_PREVIEW_MAX_WIDTH,
        maxHeight: WINDOW_LAYOUT_PREVIEW_MAX_HEIGHT,
      });
    } catch {
      result = { outcome: 'failed' };
    }
    if (gen !== generation) return; // late response discarded (rapid A->B / leave)
    if (isValidThumbnailSuccess(result)) {
      setPreviewImage(result.imageUrl, result.width, result.height);
    }
    // otherwise: honest typed/name-only fallback, never a fabricated image
  }

  function schedule(layoutId, memberId) {
    const gen = ++generation;
    clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      timer = null;
      void capture(layoutId, memberId, gen);
    }, debounceMs);
    return gen;
  }

  function cancel() {
    generation += 1;
    clearTimeoutFn(timer);
    timer = null;
    clearPreview();
  }

  return { schedule, cancel };
}
