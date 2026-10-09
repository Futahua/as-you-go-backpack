import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewGeometryScheduler} from './public/app/preview-geometry-scheduler.js';
test('resize bursts send newest geometry and never overlap host calls',async()=>{
  const frames=[],sent=[];let release;
  const scheduler=createPreviewGeometryScheduler({schedule:f=>frames.push(f),send:r=>{sent.push(r);return new Promise(resolve=>release=resolve);}});
  scheduler.update({width:600});scheduler.update({width:300});scheduler.update({width:500});
  assert.equal(frames.length,1);const pending=frames.shift()();assert.deepEqual(sent,[{width:500}]);
  scheduler.update({width:250});scheduler.update({width:450});assert.equal(frames.length,0);
  release();await pending;assert.equal(frames.length,1);const final=frames.shift()();assert.deepEqual(sent,[{width:500},{width:450}]);release();await final;
  scheduler.update({width:450});await frames.shift()();assert.equal(sent.length,2);
  scheduler.update({width:200});scheduler.dispose();await frames.shift()();assert.equal(sent.length,2);
});

test('hiding and showing a retained preview are delivered even when its rectangle is unchanged',async()=>{
  const frames=[],sent=[];
  const scheduler=createPreviewGeometryScheduler({schedule:frame=>frames.push(frame),send:async value=>{sent.push(value);}});
  const rect={x:12,y:40,width:640,height:460};
  for(const visible of [true,false,true]){
    scheduler.update({rect,visible});
    await frames.shift()();
  }
  assert.deepEqual(sent,[{rect,visible:true},{rect,visible:false},{rect,visible:true}]);
  scheduler.dispose();
});
