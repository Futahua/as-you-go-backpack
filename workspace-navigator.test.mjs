import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import {
  aygNavigatorNativePaths,
  beginNavigatorNativeDrag,
  navigatorAyGDragPayload,
  navigatorBreadcrumbMovePlan,
  navigatorDropDragSources,
  navigatorDragItemIds,
  navigatorNativeDragSourceMatches,
  navigatorSelectedPaths,
  navigatorSavedStateForItem,
  activateNavigatorFilePill,
  deleteNavigatorSelection,
} from './public/app/workspace-navigator.js';

test('navigator placement selection resolves its exact location for the AYG bin', async () => {
  const source=await readFile(new URL('./public/workspace-20260730b.js',import.meta.url),'utf8');
  const start=source.indexOf('function visiblePlacementIdFor(');
  const end=source.indexOf('\n}',start)+2;
  const record={placements:[{id:'other',parentId:'elsewhere'},{id:'selected',parentId:'here'}]};
  const resolve=vm.runInNewContext(`(${source.slice(start,end)})`,{
    shortcutByRecordOrPlacementId:()=>record,
    graph:{_getNode:()=>null},anyActivePlacementId:()=> 'other',
  });
  assert.equal(resolve('selected'),'selected');
  assert.equal(resolve('record'),'other');
});

test('file pills preview on click and leave Shift-click to the launcher', async () => {
  const calls=[];
  const o={getState:()=>({}),currentAyG:()=> 'root',itemsIn:()=>[{id:'placement',shortcutId:'file'}],
    isAbsoluteWindowsPath:path=>path.startsWith('D:'),nativeDragPaths:()=>['D:\\plan.rvt'],
    selectAyG:(...args)=>calls.push(['select',...args]),previewMachinePath:(...args)=>calls.push(['preview',...args])};
  const saved={itemId:'file',name:'Plan'};
  assert.equal(await activateNavigatorFilePill(saved,{},o),true);
  assert.deepEqual(calls,[['select','placement',['placement'],{}],['preview','D:\\plan.rvt','Plan']]);
  calls.length=0;
  assert.equal(await activateNavigatorFilePill(saved,{run:true},o),false);
  assert.deepEqual(calls,[]);
});

test('delete bins AYG items and requires confirmation for actual machine files', async () => {
  const calls=[];
  let allowed=false;
  const o={deleteAyG:()=>calls.push('ayg-bin'),confirm:message=>{assert.match(message,/actual file or folder/);return allowed;},
    host:{fileCapability:(...args)=>calls.push(args)}};
  const selected={name:'Plan',path:'D:\\plan.rvt'};
  await deleteNavigatorSelection('ayg',selected,o);
  await deleteNavigatorSelection('machine',selected,o);
  assert.deepEqual(calls,['ayg-bin']);
  allowed=true;
  await deleteNavigatorSelection('machine',selected,o);
  assert.deepEqual(calls,['ayg-bin',['delete',{paths:['D:\\plan.rvt']}]]);
});

test('navigator native drag cancels Chromium drag before starting one Windows drag', async () => {
  const calls = [];
  let prevented = 0;
  const event = {
    dataTransfer: {
    },
    preventDefault() { prevented++; },
  };
  const host = {
    fileCapability(operation, params) {
      calls.push([operation, params]);
      return Promise.resolve({ ok: true });
    },
  };

  assert.equal(beginNavigatorNativeDrag({
    event,
    paths: ['D:\\Work\\plan.rvt', 'D:\\Work\\plan.rvt'],
    host,
  }), true);
  await Promise.resolve();

  assert.equal(prevented, 1);
  assert.deepEqual(calls, [[
    'native-drag',
    { paths: ['D:\\Work\\plan.rvt'] },
  ]]);
});

test('navigator native drag fails closed without a usable DataTransfer or path', () => {
  assert.equal(beginNavigatorNativeDrag({
    event: {},
    paths: ['D:\\Work\\plan.rvt'],
    host: {},
  }), false);
  assert.equal(beginNavigatorNativeDrag({
    event: { dataTransfer: {}, preventDefault() {} },
    paths: [''],
    host: {},
  }), false);
});

test('AYG navigator drags the whole current selection only when the dragged row is selected', () => {
  const calls = [];
  const resolvePaths = (ids) => {
    calls.push(ids);
    return ids.map((id) => `D:\\Files\\${id}.txt`);
  };

  assert.deepEqual(aygNavigatorNativePaths({
    itemId: 'b',
    selectedIds: new Set(['a', 'b']),
    resolvePaths,
  }), ['D:\\Files\\a.txt', 'D:\\Files\\b.txt']);
  assert.deepEqual(aygNavigatorNativePaths({
    itemId: 'c',
    selectedIds: new Set(['a', 'b']),
    resolvePaths,
  }), ['D:\\Files\\c.txt']);
  assert.deepEqual(calls, [['a', 'b'], ['c']]);
});

test('navigator drag identity follows the dragged row unless it belongs to the current selection', () => {
  assert.deepEqual(navigatorDragItemIds('b', new Set(['a', 'b'])).sort(), ['a', 'b']);
  assert.deepEqual(navigatorDragItemIds('c', new Set(['a', 'b'])), ['c']);
});


test('AYG drag payload captures exact placement identity at gesture start', () => {
  assert.deepEqual(navigatorAyGDragPayload({
    itemId: 'placement-b',
    selectedIds: new Set(['placement-a', 'placement-b']),
    resolveIdentity: (id) => ({
      itemId: id === 'placement-a' ? 'shortcut-a' : 'shortcut-b',
      placementId: id,
    }),
  }), {
    itemIds: ['shortcut-a', 'shortcut-b'],
    placementIds: [['shortcut-a', 'placement-a'], ['shortcut-b', 'placement-b']],
  });
});
test('breadcrumb move plans preserve AYG reparenting and Opus filesystem move as separate authorities', () => {
  assert.deepEqual(navigatorBreadcrumbMovePlan({
    segment: { item: { id: 'folder-b' } },
    rootId: 'root',
    aygDrag: {
      itemIds: ['a', 'b', 'a'],
      placementIds: [['a', 'placement-a'], ['b', 'placement-b']],
    },
  }), {
    kind: 'ayg-move',
    itemIds: ['a', 'b'],
    placementIds: [['a', 'placement-a'], ['b', 'placement-b']],
    destination: 'folder-b',
  });
  assert.deepEqual(navigatorBreadcrumbMovePlan({
    segment: { path: 'D:\\Work' },
    rootId: 'root',
    machinePaths: ['D:\\Desk\\one.txt', 'D:\\Desk\\one.txt'],
  }), {
    kind: 'machine-move',
    paths: ['D:\\Desk\\one.txt'],
    destination: 'D:\\Work',
  });
});

test('navigator drop falls back to renderer-owned drag identity when DataTransfer payload is missing', () => {
  assert.deepEqual(navigatorDropDragSources({
    transferredAyG: { itemIds: [], placementIds: [] },
    transferredMachine: [],
    internalDragSource: {
      mode: 'ayg',
      itemIds: ['shortcut-a'],
      placementIds: [['shortcut-a', 'placement-a']],
    },
  }), {
    ayg: {
      itemIds: ['shortcut-a'],
      placementIds: [['shortcut-a', 'placement-a']],
    },
    machine: [],
  });
  assert.deepEqual(navigatorDropDragSources({
    transferredAyG: { itemIds: [], placementIds: [] },
    transferredMachine: [],
    internalDragSource: { mode: 'machine', paths: ['D:\\Work\\a.rvt'] },
  }), {
    ayg: null,
    machine: ['D:\\Work\\a.rvt'],
  });
});

test('a native drag can return through Files only when its exact recent source paths match', () => {
  const source = {
    mode: 'ayg',
    itemIds: ['a'],
    placementIds: [['a', 'placement-a']],
    paths: ['D:\\Files\\a.txt'],
    startedAt: 1000,
  };
  assert.equal(navigatorNativeDragSourceMatches(source, ['d:\\files\\a.txt'], 2000), true);
  assert.equal(navigatorNativeDragSourceMatches(source, ['D:\\Files\\other.txt'], 2000), false);
  assert.equal(navigatorNativeDragSourceMatches(source, ['D:\\Files\\a.txt'], 31_001), false);
  assert.deepEqual(navigatorBreadcrumbMovePlan({
    segment: { item: { id: 'folder-b' } },
    rootId: 'root',
    nativeSource: source,
    droppedPaths: ['D:\\Files\\a.txt'],
    now: 2000,
  }), {
    kind: 'ayg-move',
    itemIds: ['a'],
    placementIds: [['a', 'placement-a']],
    destination: 'folder-b',
  });
});

test('copy selected paths deduplicates AYG paths and uses the selected Opus path', () => {
  assert.deepEqual(navigatorSelectedPaths({
    mode: 'ayg',
    selectedIds: new Set(['a', 'b']),
    resolvePaths: () => ['D:\\A.txt', 'd:\\a.txt', 'D:\\B.txt'],
  }), ['D:\\A.txt', 'D:\\B.txt']);
  assert.deepEqual(navigatorSelectedPaths({
    mode: 'machine',
    selected: { path: 'D:\\Machine\\file.rvt' },
  }), ['D:\\Machine\\file.rvt']);
});

test('provider switching stays inline and the navigator no longer constructs a Home button', async () => {
  const source = await readFile(new URL('./public/app/workspace-navigator.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function switchProvider()');
  const end = source.indexOf('\n  function rememberNativeDrag', start);
  const switchProvider = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(switchProvider, /pickTarget\(/);
  assert.doesNotMatch(source, /button\(d,'Home'/);
});


test('tree rows and the tree root remain real drop targets', async () => {
  const source = await readFile(new URL('./public/app/workspace-navigator.js', import.meta.url), 'utf8');
  assert.match(source, /if\(x\.kind==='group'\)installNavigatorDropTarget\(row,\{item:x\}\)/);
  assert.match(source, /if\(folder&&!searchResult\)installNavigatorDropTarget\(row,\{path:x\.path\}\)/);
  assert.doesNotMatch(source, /else crumb\.disabled = true/);
});

test('navigator composition preserves placement ids when it reaches AYG move authority', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  assert.match(source, /resolveAyGDragIdentity:\(id\)=>\{/);
  assert.match(source, /shortcutByRecordOrPlacementId\(id\)/);
  assert.match(source, /itemId:record\.id,placementId:visiblePlacementIdFor\(id\)/);
  assert.match(source, /moveAyGItemsToFolder:\(itemIds,placementIds,folderId\)=>commands\.dragDropToFolder\(\{/);
  assert.match(source, /placementIds:new Map\(placementIds\|\|\[\]\)/);
});
test('saved navigator shortcuts retain the identity needed to hydrate the same icon as their row', () => {
  assert.deepEqual(navigatorSavedStateForItem({
    id: 'placement-1', shortcutId: 'shortcut-1', kind: 'shortcut', name: 'Report.pptx',
    target: 'D:\\Files\\Report.pptx', icon: null,
  }), {
    mode: 'action', itemId: 'shortcut-1', name: 'Report.pptx', icon: null,
    art: { kind: 'shortcut', icon: null, target: 'D:\\Files\\Report.pptx', shortcutId: 'shortcut-1' },
  });
});
