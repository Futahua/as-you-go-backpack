import test from 'node:test';
import assert from 'node:assert/strict';
import {select,zoom,zoomIdentity} from './public/vendor/d3-zoom.js';

test('the actual vendored selection supports direct graph-fit transforms',()=>{
  const viewport={};
  const selection=select(viewport),behavior=zoom().extent([[0,0],[800,600]]);
  let reported;
  behavior.on('zoom',event=>{reported=event.transform;});
  const target=zoomIdentity.translate(50,70).scale(1.25);
  behavior.transform(selection,target);
  assert.equal(viewport.__zoom,target);
  assert.equal(reported,target);
});
