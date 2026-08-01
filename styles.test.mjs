import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const graphCss = readFileSync(new URL('./public/styles/graph.css', import.meta.url), 'utf8');
const dialogCss = readFileSync(new URL('./public/styles/dialogs.css', import.meta.url), 'utf8');

test('graph node shells have a bounded width so long names wrap', () => {
  const shellRule = graphCss.match(/\.graph-node-shell\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(
    !/\bwidth:\s*max-content\b/.test(shellRule),
    'shell width must not be content-sized (that leaves no wrapping boundary)',
  );
  assert.ok(
    /\bwidth:\s*clamp\(/.test(shellRule),
    'shell width must be a finite clamp derived from the icon size',
  );
});

test('graph node labels wrap spaced names and break unbroken words', () => {
  assert.ok(/\bwhite-space:\s*normal\b/.test(graphCss), 'labels must wrap onto lines');
  assert.ok(
    /\boverflow-wrap:\s*anywhere\b/.test(graphCss),
    'labels must break long unbroken words',
  );
  assert.ok(/\bword-break:\s*break-word\b/.test(graphCss), 'labels must break long words');
  assert.ok(
    /\.graph-node-shell \.icon-item\b/.test(graphCss),
    'the wrap rules must be scoped to graph node labels',
  );
});

test('collapsed prompt-tree rows are not text-selectable', () => {
  const rowRule = dialogCss.match(/\.prompt-tree-row\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(
    /user-select:\s*none/.test(rowRule),
    'row labels must not be selectable: drag-selecting text fights row selection and drag',
  );
});

test('prompt editors opt back into text selection', () => {
  const editorRule = dialogCss.match(
    /\.prompt-card-title,\s*\.prompt-card-text,\s*\.prompt-folder-rename\s*\{[^}]*\}/,
  )?.[0] ?? '';
  assert.ok(
    /user-select:\s*text/.test(editorRule),
    'title, body and rename inputs must stay selectable for normal text editing',
  );
});

test('folder exclude-all renders as a red box with a minus, not a green check', () => {
  const boxRule = dialogCss.match(
    /\.prompt-folder-checkbox\[data-batch-state="exclude"\]\s*\{[^}]*\}/,
  )?.[0] ?? '';
  assert.ok(/appearance:\s*none/.test(boxRule), 'the box must be drawn, not left as a native check');
  assert.ok(/background:\s*#963d30/.test(boxRule), 'exclude must read red, distinct from the green accent');
  const minusRule = dialogCss.match(
    /\.prompt-folder-checkbox\[data-batch-state="exclude"\]::after\s*\{[^}]*\}/,
  )?.[0] ?? '';
  assert.ok(/content:\s*""/.test(minusRule), 'a minus bar must be drawn inside the box');
});

test('rows under a folder override take that override colour', () => {
  assert.ok(
    /\.prompt-batch-include \.prompt-prompt-title/.test(dialogCss),
    'descendants of an included folder must read green',
  );
  assert.ok(
    /\.prompt-batch-exclude \.prompt-prompt-title/.test(dialogCss),
    'descendants of an excluded folder must read red',
  );
});
