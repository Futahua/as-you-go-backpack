import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { windowLayoutControlButton, windowLayoutMemberMarkup } from './public/app/window-layout-control-icons.js';
import { windowLayoutPresentationMode } from './public/app/window-layout-detached.js';
import { createWindowLayoutView as makeView } from './public/app/window-layout-view.js';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const member={id:'m1',descriptor:{title:'Doc <one>'},state:'normal'};
const layout={id:'L<1>',arrangement:{members:[member]},tracking:{enabled:true}};
const cases=[
 {name:'attached',layout,options:{}},
 {name:'widget',layout,options:{widgetSurface:true}},
 {name:'detached-placeholder',layout,options:{detached:true}},
 {name:'read-only',layout,options:{},readOnly:true},
 {name:'widget-during-handoff',layout,options:{widgetSurface:true},readOnly:true,mode:'detached'},
 {name:'empty',layout:{id:'empty',arrangement:{members:[]}},options:{}},
];
function viewFor(entry) {
 return makeView({escapeHtml,windowLayoutControlButton,windowLayoutMemberMarkup,windowLayoutPresentationMode,
 windowLayoutDetachment:{isReadOnly:()=>entry.readOnly??false,getState:()=>({mode:entry.mode??'workspace'})},
 windowLayoutStatusText:()=>'<pending>',windowLayoutMemberIcon:()=>null,windowLayoutMemberNote:()=>'',
 windowLayoutRuntime:{isolateMode:{isActive:()=>true}},windowLayoutFromState:()=>entry.layout});
}
const fixtureUrl=new URL('./test-fixtures/window-layout-view.json',import.meta.url);
const fixtures=JSON.parse(await readFile(fixtureUrl,'utf8'));
for(const entry of cases) test(`shared card HTML remains byte-identical: ${entry.name}`,()=>assert.equal(viewFor(entry).card(entry.layout,entry.options),fixtures[entry.name]));
test('picker rows and empty fallback remain byte-identical',()=>{
 const view=viewFor(cases[0]);assert.equal(view.picker(layout.id,[{id:'candidate',title:member.descriptor.title,state:'normal',icon:'data:image/png;base64,abc'}]),fixtures.picker);assert.equal(view.picker(layout.id,[]),fixtures.emptyPicker);
});

test('the original widget retains its controls without offering deletion',()=>{
 const markup=viewFor(cases[1]).card(layout,{widgetSurface:true});
 assert.doesNotMatch(markup,/data-wl-delete/);
 for(const control of ['data-wl-list','data-wl-min-all','data-wl-restore-all','data-wl-track','data-wl-clear'])assert.ok(markup.includes(control));
});
