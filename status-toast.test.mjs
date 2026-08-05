import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatusToast } from './public/app/components/status-toast.js';

function harness() {
  const classes = new Set();
  const element = {
    textContent: '',
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
  };
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  const setTimer = (callback, delay) => {
    const id = nextId++;
    tasks.set(id, { callback, at: now + delay });
    return id;
  };
  const clearTimer = (id) => tasks.delete(id);
  const advance = (duration) => {
    const end = now + duration;
    while (true) {
      const due = [...tasks]
        .filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      const [id, task] = due;
      tasks.delete(id);
      now = task.at;
      task.callback();
    }
    now = end;
  };
  const toast = createStatusToast({ element, visibleMs: 100, fadeMs: 20, setTimer, clearTimer });
  return { element, classes, toast, advance, tasks };
}

test('an ordinary warning fades and removes itself', () => {
  const h = harness();
  h.toast.show('Could not save');
  assert.equal(h.element.textContent, 'Could not save');
  h.advance(99);
  assert.equal(h.classes.has('status-fading'), false, 'it stays readable for the visible period');
  h.advance(1);
  assert.equal(h.classes.has('status-fading'), true, 'then starts fading');
  assert.equal(h.element.textContent, 'Could not save', 'the live region keeps its text during the fade');
  h.advance(20);
  assert.equal(h.element.textContent, '', 'the toast is removed after the fade');
  assert.equal(h.classes.has('status-fading'), false);
});

test('a later warning cannot be cleared by an earlier warning timer', () => {
  const h = harness();
  h.toast.show('First');
  h.advance(80);
  h.toast.show('Second');
  h.advance(40);
  assert.equal(h.element.textContent, 'Second', 'the first deadline did not touch the replacement');
  assert.equal(h.classes.has('status-fading'), false);
  h.advance(60);
  assert.equal(h.classes.has('status-fading'), true, 'the replacement gets its own full lifetime');
  h.advance(20);
  assert.equal(h.element.textContent, '');
});

test('a repeatedly reported host error cannot keep or resurrect the toast', () => {
  const h = harness();
  h.toast.show('Save failed');
  for (let i = 0; i < 6; i += 1) {
    h.advance(30);
    h.toast.show('Save failed');
  }
  assert.equal(h.element.textContent, '', 'retries did not restart the original lifetime');
  h.toast.show('Save failed');
  assert.equal(h.element.textContent, '', 'the dismissed duplicate stays suppressed');

  h.toast.show('');
  h.toast.show('Save failed');
  assert.equal(h.element.textContent, 'Save failed', 'an explicit clear begins a new notification cycle');
});

test('active-mode instructions persist until explicitly cleared', () => {
  const h = harness();
  h.toast.show('Enter confirms, Escape cancels.', { persistent: true });
  h.advance(1000);
  assert.equal(h.element.textContent, 'Enter confirms, Escape cancels.');
  assert.equal(h.classes.has('status-fading'), false);
  assert.equal(h.tasks.size, 0, 'persistent instructions schedule no dismissal');
  h.toast.show('');
  assert.equal(h.element.textContent, '');
});
