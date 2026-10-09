import test from 'node:test';
import assert from 'node:assert/strict';
import {paneSnapshotIsNewer} from './public/app/coordinated-window-slices.js';
const current={binding:'active',bindingGeneration:4,stateRevision:10,geometryRevision:20,groups:[]};
test('native snapshots reject stale surfaces and independently stale state or geometry',()=>{
 for(const next of [{...current,binding:'old',bindingGeneration:3},{...current,binding:'other'},{...current,stateRevision:9},{...current,geometryRevision:19}])assert.equal(paneSnapshotIsNewer(current,next),false);
 assert.equal(paneSnapshotIsNewer(current,{...current,stateRevision:11,geometryRevision:21}),true);
 assert.equal(paneSnapshotIsNewer(current,{...current,binding:'remount',bindingGeneration:5,stateRevision:1,geometryRevision:1}),true);
});

import {readPagePaneSettings,writePagePaneSettings} from './public/app/page-pane-settings.js';
test('new pages are independent, while a legacy page claims root settings only once',()=>{
 const old={root:{pinned:[{id:'one',path:'D:/doc.pdf'}]}};
 assert.equal(readPagePaneSettings(old,'new','root'),undefined);
 const migrated=readPagePaneSettings(old,'first','root',true);assert.deepEqual(migrated,old.root);
 const saved=writePagePaneSettings(old,'first','root',migrated,true);
 assert.equal(readPagePaneSettings(saved,'second','root',true),undefined);
 const independent=writePagePaneSettings(saved,'second','root',{pinned:[]});
 assert.deepEqual(readPagePaneSettings(independent,'first','root'),old.root);
 assert.deepEqual(readPagePaneSettings(independent,'second','root'),{pinned:[]});
 assert.deepEqual(readPagePaneSettings(independent,'first','root-2'),undefined);
});
