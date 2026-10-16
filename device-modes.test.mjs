import test from 'node:test'; import assert from 'node:assert/strict';
import { currentDeviceMode, sameDeviceMode, writeNavigateIntent, takeNavigateIntent } from './public/app/device-modes.js';
const LAP = 'b2b514db-668a-4092-bda4-67e33c52c807';
const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
test('the current place: own As you Go, own files, another device\'s files or As you Go', () => {
  assert.deepEqual(currentDeviceMode({ mode: 'ayg' }), { device: 'self', mode: 'ayg' });
  assert.deepEqual(currentDeviceMode({ mode: 'machine', path: 'D:\Work' }), { device: 'self', mode: 'files' });
  assert.deepEqual(currentDeviceMode({ mode: 'machine', path: '\\\\papers~phone\\primary' }), { device: 'self', mode: 'files' });
  assert.deepEqual(currentDeviceMode({ mode: 'machine', path: '\\\\papers~' + LAP.toUpperCase() + '\\C:' }), { device: LAP, mode: 'files' });
  assert.deepEqual(currentDeviceMode({ remoteDevice: LAP, mode: 'ayg', path: '\\\\papers~' + LAP }), { device: LAP, mode: 'ayg' });
  assert.ok(sameDeviceMode({ device: 'self', mode: 'ayg' }, { device: 'self', mode: 'ayg' }));
  assert.ok(!sameDeviceMode({ device: 'self', mode: 'ayg' }, { device: 'self', mode: 'files' }));
});
test('"This device" chosen on LapDog\'s As you Go reaches the phone\'s own page once, then is gone', () => {
  const s = store(), now = 1_000_000;
  assert.ok(writeNavigateIntent(s, { device: 'self', mode: 'ayg' }, now));
  assert.deepEqual(takeNavigateIntent(s, now + 500), { device: 'self', mode: 'ayg' });
  assert.equal(takeNavigateIntent(s, now + 600), null);
});
test('stale or malformed hand-offs are ignored', () => {
  const s = store();
  writeNavigateIntent(s, { device: LAP, mode: 'files' }, 0);
  assert.equal(takeNavigateIntent(s, 60_000), null);
  s.setItem('papers:ayg:navigate-intent', JSON.stringify({ device: '../x', mode: 'files', at: 5 }));
  assert.equal(takeNavigateIntent(s, 10), null);
  s.setItem('papers:ayg:navigate-intent', '{nope');
  assert.equal(takeNavigateIntent(s, 10), null);
});
test('a place survives an address round trip; junk does not', async () => {
  const { formatNavigateTarget, parseNavigateTarget } = await import('./public/app/device-modes.js');
  assert.deepEqual(parseNavigateTarget(formatNavigateTarget({ device: 'self', mode: 'files' })), { device: 'self', mode: 'files' });
  assert.deepEqual(parseNavigateTarget(formatNavigateTarget({ device: LAP, mode: 'ayg' })), { device: LAP, mode: 'ayg' });
  assert.deepEqual(parseNavigateTarget({ device: LAP.toUpperCase(), mode: 'files' }), { device: LAP, mode: 'files' });
  for (const bad of [null, '', 'self', 'self:open', 'x:ayg', '../..:files', { device: 'self' }]) assert.equal(parseNavigateTarget(bad), null);
});

test('one visit trail crosses native devices and As you Go without losing forward history',async()=>{
 const {createNavigatorHistory}=await import('./public/app/device-modes.js');const h=createNavigatorHistory();
 const own={device:'self',mode:'ayg',currentId:'root'},phone={device:'self',mode:'machine',path:'\\\\papers~phone\\primary\\Download'},pc={device:'self',mode:'machine',path:'\\\\papers~11111111-1111-1111-1111-111111111111\\D:\\Inbox'},remoteAyg={device:'11111111-1111-1111-1111-111111111111',mode:'ayg',currentId:'root',surface:'remote'};
 for(const visit of [own,phone,pc,remoteAyg])h.record(visit);assert.equal(h.canBack,true);assert.equal(h.canForward,false);
 assert.deepEqual(h.go(-1),pc);h.record({...pc,view:'tree'});assert.equal(h.canForward,true);assert.deepEqual(h.go(-1),phone);assert.deepEqual(h.go(-1),own);assert.equal(h.go(-1),null);
 h.go(1);h.record({device:'self',mode:'ayg',currentId:'new'});assert.equal(h.canForward,false);assert.equal(h.go(1),null);
});
test('visit history retains exact Android case and is bounded',async()=>{const {createNavigatorHistory}=await import('./public/app/device-modes.js');const h=createNavigatorHistory(2);h.record({mode:'machine',path:'Download/Test'});h.record({mode:'machine',path:'Download/test'});h.record({mode:'ayg',currentId:'root'});assert.equal(h.go(-1).path,'Download/test');assert.equal(h.go(-1),null);});

test('Bin visits and nested Bin folders participate in Back and Forward independently of live folders',async()=>{
 const {createNavigatorHistory}=await import('./public/app/device-modes.js'),h=createNavigatorHistory();
 const live={device:'self',mode:'ayg',currentId:'folder',binMode:false},bin={device:'self',mode:'ayg',currentId:'bin',binMode:true},nested={...bin,currentId:'folder'};
 for(const v of [live,bin,nested])h.record(v);
 assert.deepEqual(h.go(-1),bin);h.record({...bin});assert.equal(h.canForward,true);assert.deepEqual(h.go(-1),live);assert.deepEqual(h.go(1),bin);assert.deepEqual(h.go(1),nested);
});
