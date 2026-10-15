import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeviceFilesPane,deviceFilesUrl,installDeviceFilesPane} from './public/app/device-files-pane.js';
test('only desktop inline devices select Files-only composition',()=>{
 assert.equal(isDeviceFilesPane({href:'https://papers/app?papers-inline-device=1'}),true);
 assert.equal(isDeviceFilesPane({href:'https://papers/app?papers-inline-device=1&papers-phone=1'}),false);
 assert.equal(isDeviceFilesPane({href:'https://papers/app?papers-device=owner'}),false);
});
test('a device Files tab opens siblings in the parent group and sends owner paths to shared Preview',async()=>{
 let opened,selection,closed=false;
 class Channel {postMessage(value){if(value.requestId){opened=value;queueMicrotask(()=>this.onmessage({data:{requestId:value.requestId,ok:true}}));}else selection=value.selection;}close(){closed=true;}}
 const document={defaultView:{location:{href:'https://papers/app?papers-surface-key=child'},BroadcastChannel:Channel,crypto:{randomUUID:()=> 'request'}}};
 const pane=installDeviceFilesPane({document,host:{deviceId:'owner'}});
 const url=deviceFilesUrl(document.defaultView.location,'other');await pane.openDevice(url);
 assert.equal(new URL(opened.openDevice).searchParams.get('papers-device'),'other');assert.equal(opened.pageKey,'child');
 pane.previewPath('C:\\docs\\a.pdf','a.pdf');assert.equal(selection.item.path,'\\\\papers~owner\\C:\\docs\\a.pdf');
 pane.syncSelection({mode:'single',item:{path:'\\\\papers~other\\D:\\b'}});assert.equal(selection.item.path,'\\\\papers~other\\D:\\b');
 pane.destroy();assert.equal(closed,true);
});
