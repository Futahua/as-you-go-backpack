import test from 'node:test';
import assert from 'node:assert/strict';
import {splitSlice,sliceIds,sliceRectangles,validSliceTree,sliceDropSide,followSliceLeft} from './public/app/window-slices.js';
test('nested slices cover the page without overlap and retain identities',()=>{const tree=splitSlice(splitSlice({id:'main'},'main','second','right'),'second','third','bottom');assert.deepEqual(sliceIds(tree),['main','second','third']);assert.equal(validSliceTree(tree),true);const r=sliceRectangles(tree,{x:0,y:0,width:800,height:600});assert.deepEqual(r.main,{x:0,y:0,width:400,height:600});assert.deepEqual(r.third,{x:400,y:300,width:400,height:300});assert.equal(Object.values(r).reduce((sum,b)=>sum+b.width*b.height,0),480000);});
test('minimizing preserves a restore strip and maximizing isolates only the selected slice',()=>{const tree=splitSlice({id:'main'},'main','second','right');const box={x:8,y:8,width:800,height:600};const mini=sliceRectangles(tree,box,['second']);assert.equal(mini.main.height,568);assert.equal(mini.second.height,32);assert.deepEqual(sliceRectangles(tree,box,[],'second'),{second:box});assert.deepEqual(sliceIds(tree),['main','second']);});
test('invalid duplicate slice identities fail validation and strip center is not a split',()=>{assert.equal(validSliceTree({axis:'x',first:{id:'main'},second:{id:'main'}}),false);assert.equal(sliceDropSide(50,50,{x:0,y:0,width:100,height:100}),'center');assert.equal(sliceDropSide(99,50,{x:0,y:0,width:100,height:100}),'right');assert.equal(sliceDropSide(101,50,{x:0,y:0,width:100,height:100}),null);});

test('a secondary native left edge moves its own seam and converges without changing the outer edge',()=>{const tree=splitSlice({id:'main'},'main','second','right'),box={x:100,y:0,width:1000,height:600};const followed=followSliceLeft(tree,'second',450,box);const regions=sliceRectangles(followed,box);assert.equal(regions.second.x,450);assert.equal(regions.main.x,100);assert.equal(regions.main.width,350);assert.equal(followSliceLeft(followed,'second',450,box),followed);assert.equal(followSliceLeft(followed,'main',200,box),followed);});

test('minimizing another slice does not disable following between the remaining slices',()=>{const tree=splitSlice(splitSlice({id:'main'},'main','second','right'),'second','third','right'),box={x:100,y:0,width:1000,height:600};const next=followSliceLeft(tree,'third',500,{...box,height:568},['main']);const r=sliceRectangles(next,box,['main']);assert.equal(r.third.x,500);assert.equal(r.second.x,100);assert.equal(r.main.height,32);assert.equal(followSliceLeft(next,'third',500,{...box,height:568},['main']),next);});

test('removing a group collapses its split and keeps a destination for every tab',async()=>{
 const {closeSlicePlan}=await import('./public/app/window-slices.js');
 const tree=splitSlice(splitSlice({id:'main'},'main','second','right'),'second','third','bottom');
 const plan=closeSlicePlan(tree,'second');assert.deepEqual(sliceIds(plan.tree),['main','third']);assert.equal(plan.remap('second'),'main');assert.equal(plan.remap('third'),'third');assert.deepEqual(sliceIds(tree),['main','second','third']);
 const primary=closeSlicePlan(tree,'main');assert.deepEqual(sliceIds(primary.tree),['main','third']);assert.equal(primary.remap('second'),'main');assert.equal(primary.remap('main'),'main');assert.equal(primary.remap('third'),'third');
 assert.equal(closeSlicePlan({id:'main'},'main'),null);
});

test('outer divider follows placement as well as resize but ignores internal and unavailable edges',async()=>{
 const {followsNativeOuterEdge}=await import('./public/app/window-slices.js');
 const box={x:500,y:8,width:800,height:600},boxes={main:box,second:{...box,x:900,width:400}};
 for(const reason of ['placement','resize'])assert.equal(followsNativeOuterEdge({x:750,reason},boxes,box),true);
 assert.equal(followsNativeOuterEdge({x:750,reason:'placement',sliceId:'second'},boxes,box),false);
 assert.equal(followsNativeOuterEdge({x:750,reason:'placement'},boxes,box,['main']),false);
 assert.equal(followsNativeOuterEdge({x:750,reason:'placement'},boxes,box,[],true),false);
});