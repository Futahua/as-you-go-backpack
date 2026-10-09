import test from 'node:test';
import assert from 'node:assert/strict';
import {paneSnapshotIsNewer} from './public/app/coordinated-window-slices.js';
const current={binding:'active',bindingGeneration:4,stateRevision:10,geometryRevision:20,groups:[]};
test('native snapshots reject stale surfaces and independently stale state or geometry',()=>{
 for(const next of [{...current,binding:'old',bindingGeneration:3},{...current,binding:'other'},{...current,stateRevision:9},{...current,geometryRevision:19}])assert.equal(paneSnapshotIsNewer(current,next),false);
 assert.equal(paneSnapshotIsNewer(current,{...current,stateRevision:11,geometryRevision:21}),true);
 assert.equal(paneSnapshotIsNewer(current,{...current,binding:'remount',bindingGeneration:5,stateRevision:1,geometryRevision:1}),true);
});
