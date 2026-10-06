import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { decodeNavigatorSavedStates, uniqueNavigatorSavedStates } from './public/app/navigator-saved-states.js';

test('saved navigator state decoder keeps only bounded semantic state kinds', () => {
  assert.deepEqual(decodeNavigatorSavedStates(JSON.stringify([
    { mode: 'ayg', name: 'Home' },
    { mode: 'machine', name: 'Files' },
    { mode: 'action', name: 'Wikipedia' },
    { mode: 'bogus', name: 'Nope' },
    null,
  ])), [
    { mode: 'ayg', name: 'Home' },
    { mode: 'machine', name: 'Files' },
    { mode: 'action', name: 'Wikipedia' },
  ]);
  assert.deepEqual(decodeNavigatorSavedStates('{broken'), []);
});

test('saved navigator states synchronize open tabs and require two clicks to clear all', async () => {
  const source = await readFile(new URL('./public/app/navigator-saved-states.js', import.meta.url), 'utf8');
  assert.match(source, /addEventListener\?\.\('storage'/);
  assert.match(source, /BroadcastChannel\('papers:ayg:navigator-saved-states-v1'\)/);
  assert.match(source, /if \(!clearArmed\)[\s\S]*classList\.add\('armed'\)[\s\S]*states = \[\]/);
  assert.match(source, /persistStates\(\);[\s\S]*render\(\);/);
});

test('navigator keeps the height grip invisible and toolbar controls present', async () => {
  const [css, source] = await Promise.all([
    readFile(new URL('./public/styles/navigator.css', import.meta.url), 'utf8'),
    readFile(new URL('./public/app/workspace-navigator.js', import.meta.url), 'utf8'),
  ]);
  assert.match(css, /\.navigator-pills-height-grip\{[^}]*background:transparent/);
  assert.match(css, /\.navigator-saved-clear\{[^}]*opacity:0/);
  assert.match(css, /\.navigator-saved-clear\.armed\{[^}]*#9f3434/);
  assert.doesNotMatch(source, /back\.hidden = fwd\.hidden = up\.hidden = home\.hidden = !nav/);
  assert.doesNotMatch(source, /saveState\.remove\(\)/);
  assert.doesNotMatch(source, /Save current navigation/);
});

test('pills for the same file deduplicate across native and AYG saved states',()=>{
  const first={mode:'action',itemId:'a',name:'Drawing',art:{target:'D:\\Work\\Drawing.dwg'}};
  const duplicate={mode:'action',path:'d:/work/drawing.dwg',name:'Drawing'};
  const other={mode:'action',path:'D:/other/Drawing.dwg',name:'Drawing'};
  assert.deepEqual(uniqueNavigatorSavedStates([first,duplicate,other]),[first,other]);
  assert.deepEqual(decodeNavigatorSavedStates(JSON.stringify([first,duplicate,other])),[first,other]);
});
test('resolved quick-run targets and duplicate folder snapshots keep only the first pill',()=>{
  const file={mode:'action',path:'D:/work/a.txt',name:'a'};
  const quick={mode:'action',quickRunKey:'item:a',name:'a'};
  const folder={mode:'ayg',currentId:'group-a',view:'nav',name:'Folder'};
  assert.deepEqual(uniqueNavigatorSavedStates([file,quick,folder,{...folder,view:'tree',expanded:['child']}],
    saved=>saved.quickRunKey?'d:\\WORK\\A.TXT':null),[file,folder]);
});


test('dragging an AYG item replaces a filename-only duplicate with its authored name',()=>{
  const file={mode:'action',path:'D:/123.jpg',name:'123.jpg'};
  const ayg={mode:'action',itemId:'image-a',path:'d:/123.jpg',name:'tien 2'};
  assert.deepEqual(uniqueNavigatorSavedStates([file,ayg]),[ayg]);
});
