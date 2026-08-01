import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const graphCss = readFileSync(new URL('./public/styles/graph.css', import.meta.url), 'utf8');

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
