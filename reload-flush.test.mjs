import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./public/workspace-20260730b.js',import.meta.url),'utf8');
const hook=source.slice(source.indexOf('window.__papersFlushBeforeClose = async () => {'),source.indexOf('\n};',source.indexOf('window.__papersFlushBeforeClose = async () => {'))+3);
function fixture(mode,failure,widget=null,device=null){
 const calls=[];const context={window:{},commandSurfaceMode:mode,WIDGET_SURFACE:widget,REMOTE_DEVICE:device,graph:{_saveRestPositionsNow(){calls.push('graph');}},PROJECT_SURFACE_KEY:'page',detachSaveGate:{isReadOnly:()=>false},state:{},pendingRestSave:Promise.resolve(),pendingSurfaceLocationSave:Promise.resolve(),captureWorkspaceView:()=>({}),setStatus:()=>{},store:{replace:s=>s,save:async()=>{calls.push('save');},flush:async()=>{calls.push('flush');if(failure)throw failure;}}};
 vm.runInNewContext(hook,context);return {calls,flush:context.window.__papersFlushBeforeClose};
}
test('reload does not ask the read-only launcher to write or flush its document queue',async()=>{const f=fixture('overlay',Error('not the writer'));const result=await f.flush();assert.equal(result.ok,true);assert.equal(result.skipped,'command-surface');assert.deepEqual(f.calls,[]);});
test('workspace reload still flushes the document and propagates save failures',async()=>{const f=fixture(null);assert.equal((await f.flush()).ok,true);assert.deepEqual(f.calls,['graph','save','flush']);const failed=fixture(null,Error('disk save failed'));await assert.rejects(failed.flush(),/disk save failed/);});
test('the compact widget closes without saving: it never writes the document',async()=>{const f=fixture(null,Error('not the writer'),{layoutKey:'x'});const result=await f.flush();assert.equal(result.ok,true);assert.equal(result.skipped,'compact-widget');assert.deepEqual(f.calls,[]);});
test('a device Files tab skips view saving but waits for its edit queue',async()=>{const f=fixture(null,null,null,'device-id');const result=await f.flush();assert.equal(result.ok,true);assert.equal(result.skipped,'device-view');assert.deepEqual(f.calls,['flush']);const failed=fixture(null,Error('pending edit failed'),null,'device-id');await assert.rejects(failed.flush(),/pending edit failed/);});
