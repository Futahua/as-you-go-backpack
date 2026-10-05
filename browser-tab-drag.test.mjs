import test from 'node:test';
import assert from 'node:assert/strict';
import {droppedBrowserUrl,insertBrowserTab} from './public/app/browser-tab-drag.js';
test('dropped links navigate and selected phrases become encoded Google searches',()=>{
  const data=values=>({getData:type=>values[type]||''});
  assert.equal(droppedBrowserUrl(data({'text/plain':'Ary Minh & friends'})),'https://www.google.com/search?q=Ary%20Minh%20%26%20friends');
  assert.equal(droppedBrowserUrl(data({'text/uri-list':'# link\nhttps://example.com/a','text/plain':'label'})),'https://example.com/a');
  assert.equal(droppedBrowserUrl(data({})),null);
});
test('tab positions insert new tabs and reorder existing tabs in both directions',()=>{
  const tabs=['a','b','c'].map(id=>({id}));
  assert.deepEqual(insertBrowserTab(tabs,tabs[0],3).map(t=>t.id),['b','c','a']);
  assert.deepEqual(insertBrowserTab(tabs,tabs[2],0).map(t=>t.id),['c','a','b']);
  assert.deepEqual(insertBrowserTab(tabs,{id:'new'},1).map(t=>t.id),['a','new','b','c']);
  assert.deepEqual(tabs.map(t=>t.id),['a','b','c']);
});
