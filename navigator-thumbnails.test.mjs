import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbnailLoader, installThumbnailZoom, isThumbnailImage } from './public/app/navigator-thumbnails.js';

const art = () => ({ isConnected: true, dataset: {}, classList: { add(k) { this.k = k; } }, children: [], ownerDocument: { createElement: () => ({}) }, replaceChildren(...c) { this.children = c; }, append(...c) { this.children.push(...c); } });
const tick = () => new Promise((r) => setTimeout(r, 0));

test('native images and documents use the same bounded owner thumbnail operation', async () => {
  const calls = [];
  const host = { fileCapability: async (op, params) => { calls.push([op, params.path]); return { ok: true, preview: { kind: 'image', url: 'papers-file-preview://g/' + params.path, resourceId: 'r-' + calls.length } }; } };
  const loader = createThumbnailLoader({ host, window: {} });
  const photo = art(), doc = art();
  loader.observe(photo, 'D:\\Photos\\a.JPG'); loader.observe(doc, 'D:\\Docs\\b.pdf');
  await tick(); await tick();
  assert.deepEqual(calls, [['thumbnail', 'D:\\Photos\\a.JPG'], ['thumbnail', 'D:\\Docs\\b.pdf']]);
  assert.equal(photo.children[0].src, 'papers-file-preview://g/D:\\Photos\\a.JPG');
  assert.equal(photo.classList.k, 'has-thumbnail');
  assert.equal(doc.children.length, 1);
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

test('desktop remote files use owner thumbnails for app icons as well as pictures',async()=>{const calls=[];const loader=createThumbnailLoader({window:{location:{href:'papers-backpack://fixture/workspace.html?papers-device=owner'}},host:{fileCapability:async(op,p)=>{calls.push([op,p.path]);return{ok:true,preview:{kind:'image',dataUrl:'data:image/jpeg;base64,YQ=='}};}}});const tile=art();loader.observe(tile,'C:\\drawing.dwg');await tick();await tick();assert.deepEqual(calls,[['thumbnail','C:\\drawing.dwg']]);assert.equal(tile.children[0].src,'data:image/jpeg;base64,YQ==');});

test('rendered previews carry a small actual file icon; plain app icons are not badged twice',async()=>{for(const renderKind of ['thumbnail','icon']){const loader=createThumbnailLoader({window:{},host:{fileCapability:async()=>({ok:true,preview:{kind:'image',renderKind,dataUrl:'data:image/jpeg;base64,YQ==',iconDataUrl:'data:image/png;base64,Yg=='}})}});const tile=art();loader.observe(tile,'C:\\drawing.dwg');await tick();await tick();assert.equal(tile.children.length,renderKind==='thumbnail'?2:1);if(renderKind==='thumbnail'){assert.equal(tile.children[1].className,'navigator-filetype-badge');assert.equal(tile.children[1].src,'data:image/png;base64,Yg==');}}});

test('image thumbnails omit the file-type badge, including URI-addressed phone pictures',async()=>{
 for(const [path,name] of [['C:\\photo.png',''],['content://provider/123','photo.jpg']]){const loader=createThumbnailLoader({window:{},host:{fileCapability:async()=>({ok:true,preview:{kind:'image',renderKind:'thumbnail',dataUrl:'data:image/png;base64,YQ==',iconDataUrl:'data:image/png;base64,Yg=='}})}});const tile=art();loader.observe(tile,path,name);await tick();await tick();assert.equal(tile.children.length,1);}
});
