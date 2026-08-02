/** Browser entry point.
 *
 * Nothing but the wiring to real globals lives here. The composition itself is
 * in workspace-app.js so it can be mounted against a fake document in tests —
 * this file is the only part that cannot be, and it is kept small enough that
 * inspection is enough for it. */

import { mountWorkspace } from './workspace-app.js';

mountWorkspace({
  document,
  window,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});
