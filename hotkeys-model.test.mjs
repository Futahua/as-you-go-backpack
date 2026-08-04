import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, normalizeState } from './public/workspace-model-20260730b.js';
import {
  HOTKEY_CATALOG,
  HOTKEY_SCOPE_PROMPTS,
  HOTKEY_SCOPE_WORKSPACE,
  assignHotkey,
  canonicalizeBinding,
  clearHotkeyOverride,
  createHotkeyCatalog,
  effectiveBindings,
  findHotkeyConflict,
  normalizeHotkeyPreferences,
  normalizeViewPreferences,
  resetAllHotkeyOverrides,
  resetHotkeyOverride,
  setHotkeyOverride,
} from './public/app/hotkeys-model.js';

test('the explicit catalog contains every current Backpack action exactly once', () => {
  assert.deepEqual(HOTKEY_CATALOG.map(({ id, group, scope, defaults }) => ({ id, group, scope, defaults })), [
    { id: 'workspace.escape', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Escape'] },
    { id: 'workspace.group-selection', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['G'] },
    { id: 'workspace.edit-set-membership', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+G'] },
    { id: 'workspace.select-all', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+A'] },
    { id: 'workspace.copy', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+C'] },
    { id: 'workspace.cut', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+X'] },
    { id: 'workspace.paste', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+V'] },
    { id: 'workspace.undo', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+Z'] },
    { id: 'workspace.redo', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
    { id: 'workspace.delete', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Delete'] },
    { id: 'workspace.reveal-selection', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+Enter'] },
    { id: 'workspace.open-selection', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Enter'] },
    { id: 'sets.rename-selected', group: 'Sets', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['F2'] },
    { id: 'copy-prompts.focus-up', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['ArrowUp'] },
    { id: 'copy-prompts.focus-down', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['ArrowDown'] },
    { id: 'copy-prompts.navigate-left', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['ArrowLeft'] },
    { id: 'copy-prompts.navigate-right', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['ArrowRight'] },
    { id: 'copy-prompts.open-or-toggle', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Enter'] },
    { id: 'copy-prompts.edit-or-rename', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['F2'] },
    { id: 'copy-prompts.delete', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Delete', 'Backspace'] },
    { id: 'copy-prompts.undo', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+Z'] },
    { id: 'copy-prompts.redo', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
    { id: 'copy-prompts.copy', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+C'] },
    { id: 'copy-prompts.cut', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+X'] },
    { id: 'copy-prompts.paste', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+V'] },
    { id: 'copy-prompts.select-all', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+A'] },
    { id: 'copy-prompts.escape', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Escape'] },
  ]);
  assert.equal(new Set(HOTKEY_CATALOG.map((action) => action.id)).size, HOTKEY_CATALOG.length);
});

test('canonicalizeBinding produces stable modifier and key names', () => {
  assert.equal(canonicalizeBinding({ key: 'z', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Z');
  assert.equal(canonicalizeBinding('control+shift+z'), 'Ctrl+Shift+Z');
  assert.equal(canonicalizeBinding({ key: 'Esc' }), 'Escape');
  assert.equal(canonicalizeBinding({ key: ' ', altKey: true }), 'Alt+Space');
  assert.equal(canonicalizeBinding({ key: '+', ctrlKey: true }), 'Ctrl+Plus');
});

test('modifier-only presses are incomplete bindings', () => {
  for (const input of [
    { key: 'Control', ctrlKey: true },
    { key: 'Shift', shiftKey: true },
    { key: 'Alt', altKey: true },
    { key: 'Meta', metaKey: true },
    'Ctrl',
    'Ctrl+',
    'Ctrl+Shift',
  ]) assert.equal(canonicalizeBinding(input), null, String(input));
});

test('effective bindings use defaults until an override replaces the complete alias list', () => {
  const redo = effectiveBindings('workspace.redo', {});
  assert.deepEqual(redo, ['Ctrl+Y', 'Ctrl+Shift+Z']);
  const customized = setHotkeyOverride({}, 'workspace.redo', ['Alt+R']);
  assert.deepEqual(effectiveBindings('workspace.redo', customized), ['Alt+R']);
  assert.equal(effectiveBindings('workspace.redo', customized).includes('Ctrl+Y'), false);
});

test('clearing stores an explicit empty override and disables the default', () => {
  const cleared = clearHotkeyOverride({}, 'workspace.group-selection');
  assert.deepEqual(cleared, { overrides: { 'workspace.group-selection': [] } });
  assert.deepEqual(effectiveBindings('workspace.group-selection', cleared), []);
});

test('resetting one override restores defaults and removes the last known override payload', () => {
  const customized = setHotkeyOverride({}, 'workspace.group-selection', ['Alt+G']);
  assert.deepEqual(resetHotkeyOverride(customized, 'workspace.group-selection'), {});
  assert.deepEqual(effectiveBindings('workspace.group-selection', customized), ['Alt+G']);
  assert.deepEqual(effectiveBindings('workspace.group-selection', resetHotkeyOverride(customized, 'workspace.group-selection')), ['G']);
});

test('reset all removes known overrides but preserves unknown action records', () => {
  const preferences = normalizeHotkeyPreferences({
    overrides: {
      'workspace.group-selection': ['Alt+G'],
      'future.action': { bindings: ['Ctrl+K'], note: 'keep me' },
    },
  });
  assert.deepEqual(resetAllHotkeyOverrides(preferences), {
    overrides: { 'future.action': { bindings: ['Ctrl+K'], note: 'keep me' } },
  });
});

test('normalization canonicalizes known records, drops malformed known values, and keeps unknown values', () => {
  const normalized = normalizeHotkeyPreferences({
    version: 7,
    overrides: {
      'workspace.redo': ['control+y', 'Ctrl+Shift+z', 'Shift', null],
      'workspace.undo': 42,
      'removed.action': ['Ctrl+K'],
    },
  });
  assert.equal(normalized.version, 7);
  assert.deepEqual(normalized.overrides['workspace.redo'], ['Ctrl+Y', 'Ctrl+Shift+Z']);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.overrides, 'workspace.undo'), false);
  assert.deepEqual(normalized.overrides['removed.action'], ['Ctrl+K']);
});

test('same-scope conflicts identify the existing action and leave both choices available', () => {
  const conflict = findHotkeyConflict('workspace.cut', 'Ctrl+C', {});
  assert.equal(conflict?.id, 'workspace.copy');
  const attempt = assignHotkey({}, 'workspace.cut', 'Ctrl+C');
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'conflict');
  assert.equal(attempt.conflict.id, 'workspace.copy');
  assert.deepEqual(attempt.preferences, {});
});

test('mutually exclusive scopes may use the same binding', () => {
  const attempt = assignHotkey({}, 'copy-prompts.copy', 'Ctrl+C');
  assert.equal(attempt.ok, true);
  assert.deepEqual(effectiveBindings('copy-prompts.copy', attempt.preferences), ['Ctrl+C']);
});

test('assignment rejects incomplete bindings and unknown action ids without mutation', () => {
  assert.equal(assignHotkey({}, 'workspace.copy', { key: 'Control', ctrlKey: true }).reason, 'incomplete-binding');
  const unknown = assignHotkey({}, 'removed.action', 'Alt+X');
  assert.equal(unknown.reason, 'unknown-action');
  assert.deepEqual(unknown.preferences, {});
});

test('an injected catalog action is registered through the same model path', () => {
  const catalog = createHotkeyCatalog([{
    id: 'future.preview',
    label: 'Preview future action',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Alt+P'],
  }]);
  assert.equal(catalog.some((action) => action.id === 'future.preview'), true);
  assert.deepEqual(effectiveBindings('future.preview', {}, catalog), ['Alt+P']);
  const attempt = assignHotkey({}, 'future.preview', 'Alt+Q', catalog);
  assert.equal(attempt.ok, true);
  assert.deepEqual(effectiveBindings('future.preview', attempt.preferences, catalog), ['Alt+Q']);
});

test('workspace state owns hotkeys under view.preferences and normalizes unknown records', () => {
  assert.deepEqual(emptyState().view.preferences, {});
  const restored = normalizeState({
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    view: {
      preferences: {
        hotkeys: {
          overrides: {
            'workspace.group-selection': ['control+g'],
            'removed.action': { raw: true },
          },
        },
        futurePreference: { keep: true },
      },
    },
  });
  assert.deepEqual(restored.view.preferences, {
    hotkeys: {
      overrides: {
        'workspace.group-selection': ['Ctrl+G'],
        'removed.action': { raw: true },
      },
    },
    futurePreference: { keep: true },
  });
});

test('normalizing view preferences removes an empty hotkeys container but keeps unrelated preferences', () => {
  assert.deepEqual(normalizeViewPreferences({ hotkeys: { overrides: {} }, theme: 'paper' }), { theme: 'paper' });
});
