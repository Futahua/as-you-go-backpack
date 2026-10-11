import test from 'node:test';
import assert from 'node:assert/strict';
import {paneSpanTargets,paneSpanDrop} from './public/app/pane-span-drop.js';
const group=(id,x,y,width,height)=>({id,presentation:'normal',slot:{x,y,width,height}});
const groups=[group('a',0,0,1200,600),group('phone',0,600,600,600),group('b',600,600,600,300),group('c',600,900,600,300)];
test('three facing bands expose all six adjoining spans including a crossing T junction',()=>{
  const targets=paneSpanTargets(groups,'phone').filter(t=>t.edge==='right'&&t.at===1200);
  assert.deepEqual(targets.map(t=>t.ids.join('+')).sort(),['a','b','c','a+b','b+c','a+b+c'].sort());
  for(const t of targets)assert.equal(paneSpanDrop(t.x,t.y,targets),t);
});
test('rows are the transposed column gesture, with the same six selectable spans',()=>{
  const transposed=groups.map(g=>({...g,slot:{x:g.slot.y,y:g.slot.x,width:g.slot.height,height:g.slot.width}}));
  const targets=paneSpanTargets(transposed,'phone').filter(t=>t.edge==='bottom'&&t.at===1200);
  assert.equal(targets.length,6);for(const t of targets)assert.equal(paneSpanDrop(t.x,t.y,targets),t);
});
test('coincident midpoints fan inward: the smallest span remains nearest the edge',()=>{
  const targets=paneSpanTargets([group('a',0,0,900,300),group('b',0,300,900,300),group('c',0,600,900,300)]).filter(t=>t.edge==='right');
  const single=targets.find(t=>t.ids.join()==='b'),whole=targets.find(t=>t.ids.length===3);
  assert.equal(single.y,whole.y);assert.ok(single.x>whole.x);assert.ok(Math.abs(single.x-whole.x)>=24);
  assert.equal(paneSpanDrop(single.x,single.y,targets),single);assert.equal(paneSpanDrop(whole.x,whole.y,targets),whole);
});
test('gaps, minimized groups and the dragged group cannot fabricate a spanning handle',()=>{
  const targets=paneSpanTargets([group('a',0,0,600,200),{...group('b',0,200,600,200),presentation:'minimized'},group('c',0,500,600,200)],'a');
  assert.ok(targets.every(t=>t.ids.join()==='c'));assert.equal(paneSpanDrop(200,200,targets),null);
});
