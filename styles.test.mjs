import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const graphCss = readFileSync(new URL('./public/styles/graph.css', import.meta.url), 'utf8');
const dialogCss = readFileSync(new URL('./public/styles/dialogs.css', import.meta.url), 'utf8');
const toolbarCss = readFileSync(new URL('./public/styles/toolbar.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('./public/styles/tokens.css', import.meta.url), 'utf8');
const itemsCss = readFileSync(new URL('./public/styles/items.css', import.meta.url), 'utf8');
const baseCss = readFileSync(new URL('./public/styles/base.css', import.meta.url), 'utf8');

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
  assert.ok(/background:\s*var\(--danger\)/.test(boxRule), 'exclude must read red, distinct from the green accent');
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

test('workspace warnings are overlay toasts with a fade state', () => {
  const statusRule = toolbarCss.match(/\.status\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/position:\s*fixed/.test(statusRule), 'warnings overlay the workspace instead of taking layout space');
  assert.ok(/width:\s*max-content/.test(statusRule), 'the popup wraps its message rather than becoming a full-width bar');
  assert.ok(/pointer-events:\s*none/.test(statusRule), 'a transient warning cannot block workspace controls');
  assert.ok(/opacity:\s*0\.5/.test(statusRule), 'the whole popup pill is 50% opaque');
  const fadingRule = toolbarCss.match(/\.status\.status-fading\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/opacity:\s*0/.test(fadingRule), 'the dismissal has a visible fade state');
});

test('graph connector opacity is controlled by one container variable with the accepted default', () => {
  const edgeRule = graphCss.match(/\.graph-edge\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/opacity:\s*var\(--graph-edge-opacity,\s*\.5\)/.test(edgeRule));
});

test('set outlines and named-set glyphs share outline opacity, while selected regions stay stronger', () => {
  const outlineRule = graphCss.match(/\.graph-set-outline\s*\{[^}]*\}/)?.[0] ?? '';
  const glyphRule = graphCss.match(/\.graph-set-glyphs\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/opacity:\s*var\(--graph-outline-opacity,\s*1\)/.test(outlineRule));
  assert.ok(/opacity:\s*var\(--graph-outline-opacity,\s*1\)/.test(glyphRule), 'named set glyphs follow outline opacity');
  const baseRegion = graphCss.match(/\.graph-set-region\s*\{[^}]*\}/)?.[0] ?? '';
  const selectedRegion = graphCss.match(/\.graph-set-region\.region-selected\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/calc\(12% \* var\(--graph-region-opacity,\s*1\)\)/.test(baseRegion));
  assert.ok(/calc\(24% \* var\(--graph-region-opacity,\s*1\)\)/.test(selectedRegion), 'selected fill remains 2x the base strength');
});

test('settings visual controls share a five-column layout and wrap on narrow panels', () => {
  const rule = dialogCss.match(/\.settings-preferences\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(rule));
  assert.ok(/@media\s*\(max-width:\s*560px\)/.test(dialogCss));
});

test('dark theme defines a warm palette and preserves the accent picking ladder', () => {
  assert.match(tokensCss, /:root\[data-theme="dark"\]/);
  assert.match(tokensCss, /--page-background:\s*#201e1a/);
  const dark = tokensCss.slice(tokensCss.indexOf(':root[data-theme="dark"]'));
  for (const token of ['--accent-wash-faint', '--accent-wash-partial', '--accent-fill-selected', '--accent-stroke-soft', '--accent-stroke-partial', '--accent-stroke-selected', '--item-accent-wash']) {
    assert.match(dark, new RegExp(`${token}:`));
  }
  assert.notEqual(dark.match(/--accent-wash-faint:\s*[^;]+/)?.[0], dark.match(/--accent-fill-selected:\s*[^;]+/)?.[0]);
});

test('shortcut and folder artwork remains unfiltered and unrecoloured', () => {
  const iconRule = itemsCss.match(/\.item-icon img\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(iconRule, 'the artwork rule must remain explicit');
  assert.doesNotMatch(iconRule, /filter\s*:|opacity\s*:|mix-blend-mode\s*:/);
  assert.doesNotMatch(itemsCss, /\.item-icon\s+img[^}]*\bfilter\s*:/);
});

test('workspace body uses a plain page surface without a square grid', () => {
  const bodyRule = baseCss.match(/body\s*\{(?=[^}]*min-height:\s*100vh)[^}]*\}/)?.[0] ?? '';
  assert.match(bodyRule, /background:\s*var\(--page-background\)/);
  assert.doesNotMatch(bodyRule, /linear-gradient|background-size/);
});

test('transparent background opt-in overrides page surface without changing dark tokens', () => {
  assert.match(tokensCss, /:root\[data-transparent-background="true"\]/);
  assert.match(tokensCss, /--page-background:\s*transparent/);
  assert.match(graphCss, /\.graph-set-region\s*\{[^}]*color-mix/);
  assert.match(itemsCss, /\.icon-item/);
});

test('floating surfaces use theme variables, including the breadcrumb handle', () => {
  const breadcrumbRule = toolbarCss.match(/\.breadcrumbs\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(breadcrumbRule, /background:\s*var\(--paper\)/);
  for (const source of [toolbarCss, dialogCss]) {
    assert.doesNotMatch(source, /background:\s*#[0-9a-f]{3,8}\b/i, 'floating surfaces must not hide literal light backgrounds');
  }
});

test('prompt modal separates navigation tabs from create actions', () => {
  const headerRule = dialogCss.match(/\.prompt-library-header\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/border-bottom:\s*1px solid/.test(headerRule), 'tabs get a dedicated header boundary');
  const tabsRule = dialogCss.match(/\.prompt-library-tabs\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/background:\s*var\(--surface-muted\)/.test(tabsRule), 'tabs have a navigation treatment');
  const actionRule = dialogCss.match(/\.prompt-library-add-actions\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/border-bottom:\s*1px solid/.test(actionRule), 'create actions get their own separation');
});
