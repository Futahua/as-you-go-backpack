/**
 * Quick Run — the globally invoked chord.
 *
 * The host half of "Alt+A anywhere" is Lane 4's: Alt+Shift+A brings Papers to the front, and Alt+A brings
 * Papers to the front and then relays a neutral event to the focused project. The host never learns what
 * Quick Run is, which is what keeps the AGENTS.md boundary intact — so this module is the whole project
 * side of the contract, and it is a decision rather than a second launcher.
 *
 * It arrives at the same place as the chord pressed inside Papers and as a letter typed on the canvas: one
 * command surface, one behaviour, one set of rules about what happens to whatever is underneath. The
 * caller opens the same surface the other two entrances open, which is why opening over a dialog resolves
 * nothing and why focus returns afterwards — those rules live in the surface itself, not here.
 */


/** Why a relayed event was left alone. Named, so a caller can say what happened rather than shrug. */
export const QUICK_RUN_GLOBAL_INVOKE_IGNORE = Object.freeze({
  /** Not the chord: the host relays other neutral events down the same channel. */
  reason: 'not-a-global-accelerator',
  /** Nothing to read a reason from. */
  malformed: 'the-event-carried-no-payload',
});

/** The only `reason` this listener acts on. Everything else down the channel is somebody else's. */
export const GLOBAL_INVOKE_REASON = 'global-accelerator';

/**
 * Whether this surface should answer a relayed event: `{ kind: 'invoke' }` to open the command surface the
 * way the in-app chord does, `{ kind: 'ignore', reason }` to leave the keystroke alone.
 *
 * Everything this deliberately does NOT consult, each measured rather than assumed:
 *
 * - **surfaceId.** Lane 4's caveat is that the relay cannot identify the RECEIVING surface, and measuring it
 *   here made it worse rather than better: the payload's surfaceId is host-generated (`sf-2f79607b-...`) and
 *   appears nowhere in the surface's own URL (`papers-backpack://<projectId>/_papers-open/14f6949b-.../...`
 *   - a different uuid). A receiving surface cannot check it against itself, so a filter on it would either
 *   drop real invocations or act on somebody else's.
 * - **projectId.** Same reason: it names the project the host focused, not the surface reading this.
 * - **document.hasFocus().** Tried first, as the one fact a surface might check for itself, and it failed its
 *   own test. Measured in the host with Electron's `webContents.isFocused()` as the oracle, the project
 *   view's `document.hasFocus()` stayed TRUE while the host view held focus
 *   (`{projectViewIsFocused: false, hostViewIsFocused: true}` with `documentHasFocus: true`). It reports the
 *   WINDOW's focus, so every surface in a focused window answers the same way and it discriminates nothing.
 *   A filter that never filters is worse than no filter, so it is not here.
 *
 * What follows, stated rather than hidden: if the host delivers the relay to two surfaces of one project,
 * both answer and each opens its own palette. Nothing a receiving surface can verify distinguishes them. The
 * mitigations that do exist are structural - the palette is transient and writes nothing, so the second is an
 * empty search line in a window the creator is not looking at, and one Escape or one chord closes it.
 * Closing the gap properly needs the host to name the receiving surface in a field the project can check, or
 * the project to declare a command surface through the host's `resolveCommandSurface` hook, which it does not
 * register today.
 */
export function planQuickRunGlobalInvoke(payload) {
  if (!payload || typeof payload !== 'object') {
    return { kind: 'ignore', reason: QUICK_RUN_GLOBAL_INVOKE_IGNORE.malformed };
  }
  if (payload.reason !== GLOBAL_INVOKE_REASON) {
    return { kind: 'ignore', reason: QUICK_RUN_GLOBAL_INVOKE_IGNORE.reason };
  }
  return { kind: 'invoke' };
}

/**
 * The payload of a relayed message, whatever shape the transport used.
 *
 * The bridge hands over `event.data.detail ?? event.data` and the host sends a flat payload, so the flat
 * shape is what arrives today. Both are still read: the host side is not in this repository, and this must
 * not be the thing that breaks when a transport detail changes.
 */
export function globalInvokePayload(message) {
  if (!message || typeof message !== 'object') return null;
  for (const candidate of [message.detail, message.data, message]) {
    if (candidate && typeof candidate === 'object' && typeof candidate.reason === 'string') return candidate;
  }
  return null;
}
