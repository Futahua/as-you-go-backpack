import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowLayoutSelection } from './public/app/window-layout-selection.js';
function harness() {
  const selectedMembers = new Map(); const selectionAnchor = new Map(); let syncs = 0;
  const selection = createWindowLayoutSelection({
    read: id => selectedMembers.get(id), write: (id,value) => selectedMembers.set(id,value),
    erase: id => selectedMembers.delete(id), anchors: selectionAnchor, orderedIds: () => ['a','b','c','d'],
  });
  const apply = (layoutId,memberId,ctrlKey,shiftKey) => {
    if(ctrlKey) selection.toggle(layoutId,memberId);
    else if(shiftKey) selection.range(layoutId,memberId);
    else selection.clear(layoutId,true);
    syncs++;
  };
  return {apply,selection,selectedMembers,selectionAnchor,get syncs(){return syncs;}};
}
test('Ctrl toggles a copied set and moves the anchor without touching another layout',()=>{
 const h=harness(); const original=new Set(['a']); h.selectedMembers.set('L',original); h.selectedMembers.set('other',new Set(['z']));
 h.apply('L','b',true,false); assert.deepEqual([...original],['a']); assert.deepEqual([...h.selectedMembers.get('L')],['a','b']);
 h.apply('L','a',true,true); assert.deepEqual([...h.selectedMembers.get('L')],['b']); assert.equal(h.selectionAnchor.get('L'),'a'); assert.deepEqual([...h.selectedMembers.get('other')],['z']);
});
for(const [anchor,clicked,expected] of [['a','c',['a','b','c']],['d','b',['b','c','d']],['gone','c',['c']],[undefined,'b',['b']],['a','gone',['gone']]]) {
 test(`Shift range ${anchor} to ${clicked}`,()=>{const h=harness();h.selectionAnchor.set('L',anchor);h.apply('L',clicked,false,true);assert.deepEqual([...h.selectedMembers.get('L')],expected);assert.equal(h.selectionAnchor.get('L'),clicked);});
}
test('plain attached click deletes both selection and anchor and synchronizes',()=>{const h=harness();h.selectedMembers.set('L',new Set(['a']));h.selectionAnchor.set('L','a');h.apply('L','b',false,false);assert.equal(h.selectedMembers.has('L'),false);assert.equal(h.selectionAnchor.has('L'),false);assert.equal(h.syncs,1);});

test('widget adapter preserves in-place Ctrl toggle, range replacement and empty clear no-op',()=>{
 let selected=new Set(['a']); const original=selected; const anchors=new Map([['L','old']]);
 const selection=createWindowLayoutSelection({read:()=>selected,write:(_id,value)=>{selected=value;},erase:()=>selected.clear(),anchors,orderedIds:()=>['a','b','c'],copyOnToggle:false});
 selection.toggle('L','b'); assert.equal(selected,original); assert.deepEqual([...selected],['a','b']);
 selection.range('L','c'); assert.notEqual(selected,original); assert.deepEqual([...selected],['b','c']);
 const ranged=selected; assert.equal(selection.clear('L'),true);assert.equal(selected,ranged);assert.equal(anchors.has('L'),false);
 anchors.set('L','stale');assert.equal(selection.clear('L'),false);assert.equal(anchors.get('L'),'stale');
});
test('repair preserves each existing retirement/startup anchor and empty-set policy',()=>{
 const h=harness();h.selectedMembers.set('L',new Set(['a','b']));h.selectionAnchor.set('L','a');
 assert.equal(h.selection.repair('L',new Set(['a']),{eraseEmpty:true,repairAnchor:true}),true);
 assert.deepEqual([...h.selectedMembers.get('L')],['b']);assert.equal(h.selectionAnchor.has('L'),false);
 h.selectionAnchor.set('L','b');h.selection.repair('L',new Set(['b']),{eraseEmpty:true});
 assert.equal(h.selectedMembers.has('L'),false);assert.equal(h.selectionAnchor.get('L'),'b');
});
test('single retirement and snapshot pruning keep live set identity without repairing anchors',()=>{
 const h=harness();const selected=new Set(['a','b','c']);h.selectedMembers.set('L',selected);h.selectionAnchor.set('L','c');
 assert.equal(h.selection.remove('L','a'),true);assert.equal(h.selection.remove('L','gone'),false);
 h.selection.retain('L',new Set(['b']));assert.equal(h.selectedMembers.get('L'),selected);assert.deepEqual([...selected],['b']);assert.equal(h.selectionAnchor.get('L'),'c');
});
