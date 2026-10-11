import test from 'node:test';
import assert from 'node:assert/strict';
import {paneColumnDrop} from './public/app/pane-column-drop.js';
const groups=[{id:'source',presentation:'normal',slot:{x:0,y:0,width:800,height:800}},{id:'files',presentation:'normal',slot:{x:800,y:0,width:400,height:400}},{id:'preview',presentation:'normal',slot:{x:800,y:400,width:400,height:400}}];
test('shared seam outer endpoint selects the full column rather than either half',()=>{const target=paneColumnDrop(1195,402,groups,'source');assert.equal(target.side,'column-r');assert.deepEqual(target.box,{x:800,y:0,width:400,height:800});assert.equal(paneColumnDrop(805,398,groups,'source').side,'column-l');});
test('ordinary pane edges and seam interior retain their existing drop choices',()=>{assert.equal(paneColumnDrop(1195,150,groups,'source'),null);assert.equal(paneColumnDrop(1000,400,groups,'source'),null);assert.equal(paneColumnDrop(1195,400,groups,'files'),null);});
test('hidden/minimized or unaligned panes cannot fabricate a column target',()=>{assert.equal(paneColumnDrop(1195,400,[groups[1],{...groups[2],presentation:'minimized'}]),null);assert.equal(paneColumnDrop(1195,400,[groups[1],{...groups[2],slot:{...groups[2].slot,x:900}}]),null);});
