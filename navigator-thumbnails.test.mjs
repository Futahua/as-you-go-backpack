import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbnailLoader, installThumbnailZoom, isThumbnailImage } from './public/app/navigator-thumbnails.js';

const art = () => ({ isConnected: true, dataset: {}, classList: { add(k) { this.k = k; } }, children: [], ownerDocument: { createElement: () => ({}) }, replaceChildren(...c) { this.children = c; } });
const tick = () => new Promise((r) => setTimeout(r, 0));

test('only image files are fetched, and a tile then shows the real picture', async () => {
  const calls = [];
  const host = { fileCapability: async (op, params) => { calls.push([op, params.path]); return { ok: true, preview: { kind: 'image', url: 'papers-file-preview://g/' + params.path, resourceId: 'r-' + calls.length } }; } };
  const loader = createThumbnailLoader({ host, window: {} });
  const photo = art(), doc = art();
  loader.observe(photo, 'D:\\Photos\\a.JPG'); loader.observe(doc, 'D:\\Docs\\b.pdf');
  await tick(); await tick();
  assert.deepEqual(calls, [['preview', 'D:\\Photos\\a.JPG']]);
  assert.equal(photo.children[0].src, 'papers-file-preview://g/D:\\Photos\\a.JPG');
  assert.equal(photo.classList.k, 'has-thumbnail');
  assert.equal(doc.children.length, 0);
  assert.ok(isThumbnailImage('x.webp') && !isThumbnailImage('x.dwg'));
});

test('at most three pictures load at once; leaving the view releases the host grants', async () => {
  let active = 0, peak = 0; const released = [];
  const host = { fileCapability: async (op, params) => {
    if (op === 'preview-release') { released.push(params.resourceId); return { ok: true }; }
    active++; peak = Math.max(peak, active); await tick(); active--;
    return { ok: true, preview: { kind: 'image', url: 'u:' + params.path, resourceId: 'grant-' + params.path } };
  } };
  const loader = createThumbnailLoader({ host, window: {} });
  for (let i = 0; i < 8; i++) loader.observe(art(), `C:\\p${i}.png`);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(peak, 3);
  loader.releaseAll(); await tick();
  assert.equal(released.length, 8);
});

function surface() { const handlers = {}; return { handlers, addEventListener(type, f) { handlers[type] = f; } }; }
function storage() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; }

test('Ctrl+wheel resizes tiles within limits and remembers the size; plain wheel scrolls', () => {
  const panel = { style: { setProperty(k, v) { this[k] = v; } } }, s = surface(), localStorage = storage();
  const zoom = installThumbnailZoom({ panel, surface: s, window: { localStorage }, isActive: () => true });
  assert.equal(panel.style['--thumb-size'], '112px');
  let prevented = false;
  s.handlers.wheel({ ctrlKey: true, deltaY: -1, preventDefault() { prevented = true; } });
  assert.ok(prevented); assert.equal(zoom.size(), 123); assert.equal(localStorage.m.get('papers:ayg:thumbnail-size'), '123');
  s.handlers.wheel({ ctrlKey: false, deltaY: -1, preventDefault() { throw Error('plain wheel must scroll'); } });
  for (let i = 0; i < 40; i++) s.handlers.wheel({ ctrlKey: true, deltaY: -1, preventDefault() {} });
  assert.equal(zoom.size(), 320);
});

test('pinch resizes tiles by the change in finger spread and saves on release', () => {
  const panel = { style: { setProperty(k, v) { this[k] = v; } } }, s = surface(), localStorage = storage();
  const zoom = installThumbnailZoom({ panel, surface: s, window: { localStorage }, isActive: () => true });
  const touches = (d) => [{ clientX: 0, clientY: 0 }, { clientX: d, clientY: 0 }];
  s.handlers.touchstart({ touches: touches(100) });
  s.handlers.touchmove({ touches: touches(150), preventDefault() {} });
  assert.equal(zoom.size(), 168);
  s.handlers.touchend({ touches: [] });
  assert.equal(localStorage.m.get('papers:ayg:thumbnail-size'), '168');
});

test('nothing happens outside the thumbnail view', () => {
  const panel = { style: { setProperty() {} } }, s = surface();
  const zoom = installThumbnailZoom({ panel, surface: s, window: { localStorage: storage() }, isActive: () => false });
  s.handlers.wheel({ ctrlKey: true, deltaY: -1, preventDefault() { throw Error('not active'); } });
  s.handlers.touchstart({ touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] });
  s.handlers.touchmove({ touches: [{ clientX: 0, clientY: 0 }, { clientX: 200, clientY: 0 }], preventDefault() { throw Error('not active'); } });
  assert.equal(zoom.size(), 112);
});

test('mobile requests bounded thumbnails for PC PDFs instead of fetching full previews',async()=>{const calls=[];const loader=createThumbnailLoader({window:{location:{href:'https://papers.local/?papers-phone=1'}},host:{fileCapability:async(op,p)=>{calls.push(op);return {ok:true,preview:{kind:'image',dataUrl:'data:image/jpeg;base64,YQ=='}};}}});const tile=art();loader.observe(tile,'\\\\papers~pc\\file.pdf');await tick();await tick();assert.deepEqual(calls,['thumbnail']);assert.equal(tile.children[0].src,'data:image/jpeg;base64,YQ==');});
