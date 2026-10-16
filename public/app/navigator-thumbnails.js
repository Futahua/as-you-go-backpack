import {isPhoneResizeLocked} from './phone-control-scale.js';
/** The navigator's thumbnail view (the third view, after list and graph), like Opus's thumbnails:
 * the same rows laid out as a grid of tiles, so selection, double-click/double-tap, hold-to-select,
 * drag and drop and the action buttons all keep working. Folders use the graph's folder art.
 *
 * Owner-rendered previews load only for visible tiles, at most three at a time, through the
 * existing bounded thumbnail operation. Document previews carry their real file icon in a corner;
 * unavailable previews fall back to the owner's application icon or the common type icon.
 *
 * Tile size: Ctrl+wheel on a computer, pinch on the phone; remembered per device. */
export const FOLDER_ART = '<span class="folder-art" aria-hidden="true"><span></span></span>';
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif)$/i;
const SIZE_KEY = 'papers:ayg:thumbnail-size', MIN = 64, MAX = 320, DEFAULT = 112;

export function isThumbnailImage(path) { return IMAGE.test(String(path || '')); }

export function createThumbnailLoader({ host, window: w }) {
  const cache = new Map(), grants = new Set(), queue = []; let running = 0;
  const pump = () => {
    while (running < 3 && queue.length) {
      const job = queue.shift(); if (!job.art.isConnected) continue; running++;
      load(job.path).then((preview) => { if (preview && job.art.isConnected && !job.art.classList?.contains?.('has-custom-icon')) show(job.art, preview); }).finally(() => { running--; pump(); });
    }
  };
  function load(path) {
    if (!cache.has(path)) cache.set(path, Promise.resolve(host.fileCapability('thumbnail', { path })).then((result) => {
      const preview = result?.ok ? result.preview : null;
      if (!preview || preview.kind !== 'image') return null;
      if (preview.resourceId) grants.add(preview.resourceId);
      return preview;
    }).catch(() => null));
    return cache.get(path);
  }
  function show(art, preview) {
    const img = art.ownerDocument.createElement('img'); img.alt = ''; img.decoding = 'async'; img.loading = 'lazy'; img.src = preview.url||preview.dataUrl;
    img.className = 'navigator-thumbnail-image'; art.replaceChildren(img); art.classList.add('has-thumbnail');
    if(preview.renderKind!=='icon'&&preview.iconDataUrl&&!isThumbnailImage(art.dataset.thumbnailPath)&&!isThumbnailImage(art.dataset.thumbnailName)){const badge=art.ownerDocument.createElement('img');badge.className='navigator-filetype-badge';badge.src=preview.iconDataUrl;badge.alt='File type';badge.title='File type';art.append(badge);}
  }
  const observer = typeof w.IntersectionObserver === 'function' ? new w.IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); const path = entry.target.dataset.thumbnailPath; if (path) { queue.push({ art: entry.target, path }); pump(); } }
  }, { rootMargin: '200px' }) : null;
  return {
    /** Shows the real picture in `art` when `path` is an image, once the tile is near view. */
    observe(art, path, name = '') {
      // A phone file picked with the paperclip is addressed by a content:// URI that may not end in its
      // file name, so its name decides too.
      art.dataset.thumbnailPath = path;
      art.dataset.thumbnailName = name;
      if (observer) observer.observe(art); else { queue.push({ art, path }); pump(); }
    },
    /** Leaving the view: forget cached pictures and release the host's preview grants. */
    releaseAll() {
      queue.length = 0; cache.clear();
      for (const resourceId of grants) void Promise.resolve(host.fileCapability('preview-release', { resourceId })).catch(() => {});
      grants.clear();
    },
  };
}

/** Tile size for the thumbnail view: Ctrl+wheel (computer) and pinch (phone) over `surface`. */
export function installThumbnailZoom({ panel, surface, window: w, isActive }) {
  let size = DEFAULT;
  try { const saved = Number(w.localStorage.getItem(SIZE_KEY)); if (saved >= MIN && saved <= MAX) size = saved; } catch {}
  const apply = (next, save) => {
    size = Math.round(Math.max(MIN, Math.min(MAX, next)));
    panel.style.setProperty('--thumb-size', size + 'px');
    if (save) try { w.localStorage.setItem(SIZE_KEY, String(size)); } catch {}
  };
  apply(size, false);
  surface.addEventListener('wheel', (event) => {
    if (isPhoneResizeLocked(w) || !isActive() || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    apply(size * (event.deltaY < 0 ? 1.1 : 1 / 1.1), true);
  }, { passive: false });
  let pinch = null;
  const spread = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  surface.addEventListener('touchstart', (event) => {
    pinch = !isPhoneResizeLocked(w) && isActive() && event.touches.length === 2 ? { distance: spread(event.touches), size } : null;
  }, { passive: true });
  surface.addEventListener('touchmove', (event) => {
    if (isPhoneResizeLocked(w) || !pinch || event.touches.length !== 2) return;
    event.preventDefault();
    apply(pinch.size * spread(event.touches) / pinch.distance, false);
  }, { passive: false });
  surface.addEventListener('touchend', (event) => { if (pinch && event.touches.length < 2) { pinch = null; apply(size, true); } });
  return { size: () => size };
}
