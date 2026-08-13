/**
 * 019C (RoketPuncha sole-editor lane): the AYG-owned same-origin compact-widget
 * channel. One native widget per (projectId, layoutId); the workspace and the
 * widget window share the same origin, so they talk over ONE named
 * BroadcastChannel with EXACT schemas and bounded values.
 *
 * The workspace is the SOLE durable writer and revision source. The widget
 * sends READY and bounded command intents carrying `layoutId`, `clientId`,
 * `commandId` and `baseRevision`; the workspace validates that the layout still
 * exists and the revision matches, applies the intent through the existing
 * functions/store, then answers with a typed committed snapshot/revision, a
 * stale re-sync, or an error. The widget NEVER calls saveWorkspace,
 * store.commit, store.replace or recording persistence.
 */
export const WINDOW_LAYOUT_WIDGET_CHANNEL = 'as-you-go:window-layout-widget';
export const WINDOW_LAYOUT_WIDGET_MAX_KEY_BYTES = 512;
export const WINDOW_LAYOUT_WIDGET_MAX_MEMBER_IDS = 64;
// 037: the ONE shared compact presentation maximum - a WIDTH bound (never a
// member/icon/column-count breakpoint) that is the same for attached and
// detached. The detached native window snaps its client width here (no empty
// surrounding canvas around a capped card), the persisted card geometry is the
// actual client/card width capped here, and the attached shell never exceeds
// it. The bound matches the creator-approved compact eight-icon presentation;
// larger sets wrap into balanced rows instead of stretching into a toolbar.
export const WINDOW_LAYOUT_CARD_MAX_WIDTH = 280;
// 019DR2: the real Papers pick-member ceiling (the preload parsePickMembers
// bound) bounds the picker-commit add/remove arrays.
export const PAPERS_PICK_MEMBER_LIMIT = 32;
// The candidate is NOT authoritative: the only display data consumed is the
// optional icon. Data URLs can exceed the 512-byte key bound, so the icon has
// its own generous-but-bounded ceiling.
export const WINDOW_LAYOUT_WIDGET_MAX_ICON_BYTES = 262144;

const COMMAND_KINDS = new Set(['member-toggle', 'group-action', 'range-toggle', 'picker-commit', 'reorder', 'remove-member', 'retire-closed-window']);
const GROUP_ACTIONS = new Set(['minimize', 'restore', 'isolate']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** UTF-8 byte length (TextEncoder), falling back to character count only where
 * the encoder is unavailable. The Papers string bounds are byte bounds. */
function utf8ByteLength(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return value.length;
}

function boundedString(value, name, max = WINDOW_LAYOUT_WIDGET_MAX_KEY_BYTES) {
  return typeof value === 'string' && value.length > 0 && utf8ByteLength(value) <= max;
}

function exactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 019DR2: exact Papers descriptor schema — keys version,title,
 * executableFingerprint; version 1; non-empty UTF-8 <= 512 bytes; 64-hex
 * fingerprint. Returns a copied descriptor or null for any deviation. */
function parseDescriptorLike(raw) {
  if (!isPlainObject(raw) || !exactKeys(raw, ['version', 'title', 'executableFingerprint'])) return null;
  if (raw.version !== 1) return null;
  if (!boundedString(raw.title, 'descriptor.title')) return null;
  if (typeof raw.executableFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.executableFingerprint)) return null;
  return { version: 1, title: raw.title, executableFingerprint: raw.executableFingerprint };
}

/** 019DR2: exact Papers capability schema — keys version,bindingId; version 1;
 * non-empty UTF-8 <= 512 bytes. Returns a copied capability or null. */
function parseCapabilityLike(raw) {
  if (!isPlainObject(raw) || !exactKeys(raw, ['version', 'bindingId'])) return null;
  if (raw.version !== 1) return null;
  if (!boundedString(raw.bindingId, 'capability.bindingId')) return null;
  return { version: 1, bindingId: raw.bindingId };
}

function parseMemberIdList(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > WINDOW_LAYOUT_WIDGET_MAX_MEMBER_IDS) return null;
  const ids = [];
  for (const item of raw) {
    if (!boundedString(item, 'memberId')) return null;
    ids.push(item);
  }
  return ids;
}

/** 019DR2: exact inner command schemas at the widget BroadcastChannel boundary.
 * Applies exactKeys to every command-kind object and the nested pick shape, and
 * validates/copies descriptor and capability exactly as Papers does. Returns
 * null for any missing/extra/invalid field — never forwards an arbitrary object
 * or reference. */
export function windowLayoutWidgetParseCommand(raw) {
  if (!isPlainObject(raw) || typeof raw.kind !== 'string' || raw.kind.length === 0) return null;
  if (!COMMAND_KINDS.has(raw.kind)) return null;
  if (raw.kind === 'member-toggle') {
    if (!exactKeys(raw, ['kind', 'memberId']) || !boundedString(raw.memberId, 'memberId')) return null;
    return { kind: 'member-toggle', memberId: raw.memberId };
  }
  if (raw.kind === 'remove-member') {
    // 040: the widget's `Remove from this layout` context action routes through
    // the workspace writer with the exact memberId; the layout is implied by the
    // channel's layoutId. Bounded memberId only.
    if (!exactKeys(raw, ['kind', 'memberId']) || !boundedString(raw.memberId, 'memberId')) return null;
    return { kind: 'remove-member', memberId: raw.memberId };
  }
  if (raw.kind === 'retire-closed-window') {
    if (!exactKeys(raw, ['kind', 'descriptor'])) return null;
    const descriptor = parseDescriptorLike(raw.descriptor);
    return descriptor ? { kind: 'retire-closed-window', descriptor } : null;
  }
  if (raw.kind === 'group-action') {
    if (!exactKeys(raw, ['kind', 'action', 'memberIds'])) return null;
    if (!GROUP_ACTIONS.has(raw.action)) return null;
    const memberIds = parseMemberIdList(raw.memberIds);
    if (memberIds === null) return null;
    return { kind: 'group-action', action: raw.action, memberIds };
  }
  if (raw.kind === 'range-toggle') {
    if (!exactKeys(raw, ['kind', 'memberId', 'memberIds'])) return null;
    if (!boundedString(raw.memberId, 'memberId')) return null;
    const memberIds = parseMemberIdList(raw.memberIds);
    if (memberIds === null) return null;
    return { kind: 'range-toggle', memberId: raw.memberId, memberIds };
  }
  if (raw.kind === 'reorder') {
    // 024: the widget drag-reorder intent - move `memberId` to `toIndex`
    // (0-based within the persisted member order). Bounded.
    if (!exactKeys(raw, ['kind', 'memberId', 'toIndex'])) return null;
    if (!boundedString(raw.memberId, 'memberId')) return null;
    if (typeof raw.toIndex !== 'number' || !Number.isInteger(raw.toIndex)
      || raw.toIndex < 0 || raw.toIndex > WINDOW_LAYOUT_WIDGET_MAX_MEMBER_IDS) return null;
    return { kind: 'reorder', memberId: raw.memberId, toIndex: raw.toIndex };
  }
  if (raw.kind === 'picker-commit') {
    if (!exactKeys(raw, ['kind', 'pick'])) return null;
    const pick = raw.pick;
    if (!isPlainObject(pick)) return null;
    if (pick.outcome === 'cancelled') {
      if (!exactKeys(pick, ['outcome'])) return null;
      return { kind: 'picker-commit', pick: { outcome: 'cancelled' } };
    }
    if (pick.outcome !== 'committed') return null;
    if (!exactKeys(pick, ['outcome', 'adds', 'removes'])) return null;
    if (!Array.isArray(pick.adds) || !Array.isArray(pick.removes)) return null;
    if (pick.adds.length > PAPERS_PICK_MEMBER_LIMIT || pick.removes.length > PAPERS_PICK_MEMBER_LIMIT) return null;
    // 019DR2: an ENTIRE malformed picker-commit command is rejected instead of
    // silently filtering malformed add/remove entries.
    const adds = [];
    for (const add of pick.adds) {
      const parsed = parsePickerCommitAdd(add);
      if (!parsed) return null;
      adds.push(parsed);
    }
    const removes = [];
    for (const remove of pick.removes) {
      if (!isPlainObject(remove) || !exactKeys(remove, ['descriptor'])) return null;
      const descriptor = parseDescriptorLike(remove.descriptor);
      if (!descriptor) return null;
      removes.push({ descriptor });
    }
    return { kind: 'picker-commit', pick: { outcome: 'committed', adds, removes } };
  }
  return null;
}

/** 019DR2: an add is descriptor+capability (exact Papers schemas) plus the
 * candidate's bounded display data ONLY (the optional icon). The candidate is
 * not authoritative; an arbitrary object/reference is never forwarded. */
function parsePickerCommitAdd(add) {
  if (!isPlainObject(add) || !exactKeys(add, ['descriptor', 'capability', 'candidate'])) return null;
  const descriptor = parseDescriptorLike(add.descriptor);
  const capability = parseCapabilityLike(add.capability);
  if (!descriptor || !capability) return null;
  if (!isPlainObject(add.candidate)) return null;
  let candidate = {};
  if (add.candidate.icon !== undefined) {
    if (typeof add.candidate.icon !== 'string' || add.candidate.icon.length === 0
      || utf8ByteLength(add.candidate.icon) > WINDOW_LAYOUT_WIDGET_MAX_ICON_BYTES) return null;
    candidate = { icon: add.candidate.icon };
  }
  return { descriptor, capability, candidate };
}

/** 019DR2: the bounded persisted member descriptor identity required by the
 * Papers direct-pick begin validation (exact keys version/title/
 * executableFingerprint), validated/copied field-by-field. Returns NULL for an
 * invalid descriptor so the snapshot fails closed per member instead of
 * emitting a partial `{}` that later poisons pickWindowBegin. Never carries a
 * runtime capability, token or any extra field. */
function memberDescriptorSnapshot(member) {
  return parseDescriptorLike(member?.descriptor);
}

/** The bounded snapshot the workspace broadcasts and the widget renders: the
 * layout identity plus the minimal member card fields (including a bounded
 * icon data URL when the workspace can supply one, and the persisted layout
 * name). Members with an invalid persisted descriptor are OMITTED (fail
 * closed) so every descriptor the widget later forwards to pickWindowBegin is
 * accepted. Never the whole state, never a capability/token. */
export function windowLayoutWidgetSnapshot(layout, memberIcon = () => null) {
  const members = [];
  for (const member of layout?.arrangement?.members ?? []) {
    const descriptor = memberDescriptorSnapshot(member);
    if (descriptor === null) continue;
    let icon = null;
    const rawIcon = memberIcon?.(layout?.id ?? '', member.id);
    if (typeof rawIcon === 'string' && rawIcon.length > 0
      && utf8ByteLength(rawIcon) <= WINDOW_LAYOUT_WIDGET_MAX_ICON_BYTES) {
      icon = rawIcon;
    }
    members.push({
      id: member.id,
      descriptor,
      state: member.state === 'minimized' ? 'minimized' : 'normal',
      icon,
    });
  }
  // 035: the shared card geometry rides the snapshot so an opening widget can
  // restore the window to the layout's persisted size. Bounded to [1, 2000].
  const rawCardSize = layout?.cardSize;
  const cardSize = rawCardSize && typeof rawCardSize === 'object' && !Array.isArray(rawCardSize)
    && typeof rawCardSize.width === 'number' && Number.isFinite(rawCardSize.width)
    && typeof rawCardSize.height === 'number' && Number.isFinite(rawCardSize.height)
    && rawCardSize.width >= 1 && rawCardSize.width <= 2000
    && rawCardSize.height >= 1 && rawCardSize.height <= 2000
    ? { width: Math.round(rawCardSize.width), height: Math.round(rawCardSize.height) }
    : null;
  return { id: layout?.id ?? '', name: layout?.name ?? layout?.id ?? '', members, cardSize };
}

/** 019G/021: bounded retry for a transient channel failure (e.g. a widget
 * snapshot requested before the workspace finished loading -> 'unknown-layout').
 * Pure and timer-injected so tests run without real time. `request` returns a
 * result; `shouldRetry(result)` decides; `onResult(result)` receives the final
 * result after the last attempt or a non-retryable one. */
export function createBoundedRetry({
  attempts = 3,
  delayMs = 250,
  request,
  shouldRetry,
  onResult,
  setTimer = (fn) => setTimeout(fn, delayMs),
  clearTimer = (id) => clearTimeout(id),
}) {
  if (typeof request !== 'function' || typeof shouldRetry !== 'function') {
    throw new TypeError('request and shouldRetry are required');
  }
  let timer = null;
  let cancelled = false;
  let attempt = 0;
  async function run() {
    if (cancelled) return;
    let result;
    try {
      result = await request();
    } catch (error) {
      result = { error };
    }
    if (cancelled) return;
    attempt += 1;
    if (!shouldRetry(result) || attempt >= attempts) {
      onResult?.(result);
      return;
    }
    timer = setTimer(() => { timer = null; void run(); });
  }
  return {
    start: () => { void run(); },
    cancel: () => {
      cancelled = true;
      if (timer !== null) { clearTimer(timer); timer = null; }
    },
  };
}

/** Workspace side: validates every widget intent, applies it through the
 * injected writer, owns the per-layout revision, and posts typed responses.
 * `noteCommitted(layoutId)` is the single broadcast the workspace calls after
 * ITS OWN durable window-layout commits so open widgets re-sync.
 * 035: the workspace also tracks a layout's detached-widget lifecycle:
 * `onWidgetOpen` fires when a widget announces itself, `onWidgetDispose` when
 * it reports closing, and `onCardSize` when a live widget reports its window
 * content size (persisted to the shared card geometry). */
export function createWindowLayoutWidgetChannelWorkspace({
  channel,
  getLayout,
  snapshot = windowLayoutWidgetSnapshot,
  memberIcon,
  applyCommand = async () => ({ ok: false, error: 'no command handler wired' }),
  onWidgetOpen,
  onWidgetDispose,
  onCardSize,
}) {
  const revisions = new Map();
  const revisionOf = (layoutId) => revisions.get(layoutId) ?? 0;
  function bump(layoutId) {
    const next = revisionOf(layoutId) + 1;
    revisions.set(layoutId, next);
    return next;
  }
  const buildSnapshot = (layout) => snapshot(layout, memberIcon);
  const post = (message) => {
    try { channel.postMessage(message); } catch { /* channel closed */ }
  };
  async function reply(event) {
    const message = event.data;
    if (!isPlainObject(message) || typeof message.type !== 'string') return;
    if (message.type === 'widget-ready' || message.type === 'snapshot-request') {
      if (!exactKeys(message, ['type', 'layoutId', 'clientId'])) return;
      if (!boundedString(message.layoutId, 'layoutId') || !boundedString(message.clientId, 'clientId')) return;
      const { layoutId, clientId } = message;
      const layout = getLayout(layoutId);
      if (!layout) {
        post({ type: 'error', layoutId, clientId, code: 'unknown-layout' });
        return;
      }
      post({ type: 'snapshot', layoutId, clientId, revision: revisionOf(layoutId), snapshot: buildSnapshot(layout) });
      // 035: a widget announcing itself marks this layout's attached card as a
      // greyed placeholder (the widget is the sole live card).
      onWidgetOpen?.(layoutId);
      return;
    }
    // 035: a live widget reports its window content size so the workspace
    // persists the shared card geometry. Exact keys + bounded integers only.
    if (message.type === 'card-size') {
      if (!exactKeys(message, ['type', 'layoutId', 'clientId', 'width', 'height'])) return;
      if (!boundedString(message.layoutId, 'layoutId') || !boundedString(message.clientId, 'clientId')) return;
      const width = message.width;
      const height = message.height;
      if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width)
        || !Number.isFinite(height) || width < 1 || width > 2000 || height < 1 || height > 2000) return;
      onCardSize?.(message.layoutId, Math.round(width), Math.round(height));
      return;
    }
    // 035: the widget reports it is closing; the workspace restores the attached
    // card (no longer a placeholder).
    if (message.type === 'dispose') {
      if (!exactKeys(message, ['type', 'layoutId', 'clientId'])) return;
      if (!boundedString(message.layoutId, 'layoutId') || !boundedString(message.clientId, 'clientId')) return;
      onWidgetDispose?.(message.layoutId);
      return;
    }
    if (message.type === 'command') {
      if (!exactKeys(message, ['type', 'layoutId', 'clientId', 'commandId', 'baseRevision', 'command'])) return;
      if (!boundedString(message.layoutId, 'layoutId') || !boundedString(message.clientId, 'clientId')
        || !boundedString(message.commandId, 'commandId')
        || typeof message.baseRevision !== 'number' || !Number.isFinite(message.baseRevision)) return;
      const command = windowLayoutWidgetParseCommand(message.command);
      if (!command) return;
      const { layoutId, clientId, commandId, baseRevision } = message;
      const layout = getLayout(layoutId);
      if (!layout) {
        post({ type: 'error', layoutId, clientId, commandId, code: 'unknown-layout' });
        return;
      }
      if (baseRevision !== revisionOf(layoutId)) {
        post({ type: 'stale', layoutId, clientId, commandId, revision: revisionOf(layoutId), snapshot: buildSnapshot(layout) });
        return;
      }
      // 019DR: capture the starting revision and re-read the layout AFTER the
      // apply. The production command path calls noteCommitted() inside
      // applyCommand (already bumped + broadcast a FRESH snapshot), so the
      // committed response must NOT bump again or reuse the stale pre-apply
      // layout: it must carry the authoritative current revision and the
      // freshly re-read immutable layout, or a higher stale committed message
      // could overwrite the earlier fresh broadcast.
      const startingRevision = revisionOf(layoutId);
      let result;
      try {
        result = await applyCommand(layoutId, command);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (!result || result.ok !== true) {
        post({ type: 'error', layoutId, clientId, commandId, code: 'apply-failed', message: result?.error ?? 'command failed' });
        return;
      }
      const freshLayout = getLayout(layoutId);
      if (!freshLayout) {
        post({ type: 'error', layoutId, clientId, commandId, code: 'unknown-layout', message: 'layout disappeared during the apply' });
        return;
      }
      const revision = revisionOf(layoutId) === startingRevision ? bump(layoutId) : revisionOf(layoutId);
      post({ type: 'committed', layoutId, clientId, commandId, commandKind: command.kind, revision, snapshot: buildSnapshot(freshLayout) });
    }
  }
  const listener = (event) => { void reply(event); };
  channel.addEventListener('message', listener);
  return {
    revisionOf,
    noteCommitted(layoutId, { reason } = {}) {
      if (!boundedString(layoutId, 'layoutId')) return revisionOf(layoutId);
      const revision = bump(layoutId);
      const layout = getLayout(layoutId);
      if (layout) post({ type: 'snapshot', layoutId, revision, ...(reason ? { reason } : {}), snapshot: buildSnapshot(layout) });
      return revision;
    },
    /** 019G/021: readiness broadcast without a revision bump. The entry calls
     * this for each layout after durable state is loaded so an already-open
     * widget gets its real snapshot even before any user commit (fixes the
     * cold-open 'unknown-layout' stall). A same-revision message is a no-op
     * for a widget that already holds that snapshot. */
    broadcast(layoutId) {
      if (!boundedString(layoutId, 'layoutId')) return revisionOf(layoutId);
      const layout = getLayout(layoutId);
      if (layout) post({ type: 'snapshot', layoutId, revision: revisionOf(layoutId), snapshot: buildSnapshot(layout) });
      return revisionOf(layoutId);
    },
    close() {
      channel.removeEventListener('message', listener);
      try { channel.close(); } catch { /* already closed */ }
    },
  };
}

/** Widget side: a thin, bounded intent sender. The returned object exposes NO
 * store/save/commit/replace/recording surface - only the channel verbs. */
export function createWindowLayoutWidgetChannelClient({
  channel,
  layoutId,
  clientId = generateId(),
  onMessage,
  reorderAckTimeoutMs = 1500,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  if (!boundedString(layoutId, 'layoutId')) throw new TypeError('a bounded layout id is required');
  if (!boundedString(clientId, 'clientId')) throw new TypeError('a bounded client id is required');
  let revision = 0;
  const pendingReorders = [];
  let inFlightReorderId = null;
  let reorderTimer = null;
  const post = (message) => {
    try { channel.postMessage(message); } catch { /* channel closed */ }
  };
  const send = (message) => post({ ...message, layoutId, clientId });
  const listener = (event) => {
    const message = event.data;
    if (!isPlainObject(message) || typeof message.type !== 'string') return;
    if (message.layoutId !== layoutId) return;
    if (message.type === 'snapshot' || message.type === 'committed' || message.type === 'stale') {
      if (typeof message.revision === 'number' && Number.isFinite(message.revision)) revision = message.revision;
    }
    onMessage?.(message);
    if ((message.type === 'committed' || message.type === 'stale' || message.type === 'error')
      && message.commandId === inFlightReorderId) {
      if (reorderTimer !== null) {
        clearTimer(reorderTimer);
        reorderTimer = null;
      }
      if (message.type === 'stale') {
        // The authoritative revision was latched above; resend the same valid
        // reorder immediately rather than dropping it or requiring a ritual.
        const pending = pendingReorders[0];
        if (pending) {
          pending.baseRevision = revision;
          sendReorder(pending);
        }
      } else {
        pendingReorders.shift();
        inFlightReorderId = null;
        sendNextReorder();
      }
    }
  };
  function sendReorder(pending) {
    inFlightReorderId = pending.commandId;
    pending.attempts = (pending.attempts ?? 0) + 1;
    send({ type: 'command', commandId: pending.commandId, baseRevision: pending.baseRevision, command: pending.command });
    if (reorderTimer !== null) clearTimer(reorderTimer);
    reorderTimer = setTimer(() => {
      reorderTimer = null;
      if (inFlightReorderId !== pending.commandId || pendingReorders[0] !== pending) return;
      if (pending.attempts < 3) {
        pending.baseRevision = revision;
        sendReorder(pending);
        return;
      }
      // Never leave the queue wedged behind a lost acknowledgement. Re-sync
      // authoritative order, drop only the exhausted intent, then allow the
      // next consecutive drag to proceed immediately.
      pendingReorders.shift();
      inFlightReorderId = null;
      send({ type: 'snapshot-request' });
      sendNextReorder();
    }, reorderAckTimeoutMs);
  }
  function sendNextReorder() {
    if (inFlightReorderId || pendingReorders.length === 0) return;
    pendingReorders[0].baseRevision = revision;
    sendReorder(pendingReorders[0]);
  }
  channel.addEventListener('message', listener);
  return {
    ready: () => send({ type: 'widget-ready' }),
    requestSnapshot: () => send({ type: 'snapshot-request' }),
    /** 035: the live widget reports its window content size (debounced by the
     * page) so the workspace persists the shared card geometry. Bounded to the
     * same [1, 2000] range the workspace/IPC accepts. */
    sendCardSize: (width, height) => {
      if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width)
        || !Number.isFinite(height) || width < 1 || width > 2000 || height < 1 || height > 2000) {
        return false;
      }
      send({ type: 'card-size', width: Math.round(width), height: Math.round(height) });
      return true;
    },
    /** 035: the widget reports it is closing (pagehide) so the workspace stops
     * rendering its attached card as a greyed placeholder. */
    dispose: () => send({ type: 'dispose' }),
    sendCommand: (command, options = {}) => {
      const parsed = windowLayoutWidgetParseCommand(command);
      if (!parsed) return null;
      // The baseRevision defaults to the live-latched revision; a caller may
      // pin it to the revision of the snapshot it is acting on (e.g. a
      // widget re-issuing an action after a re-sync) - bounded and validated
      // workspace-side.
      const baseRevision = typeof options.baseRevision === 'number' && Number.isFinite(options.baseRevision)
        ? options.baseRevision
        : revision;
      const commandId = generateId();
      if (parsed.kind === 'reorder') {
        pendingReorders.push({ commandId, baseRevision, command: parsed, attempts: 0 });
        sendNextReorder();
      } else {
        send({ type: 'command', commandId, baseRevision, command: parsed });
      }
      return commandId;
    },
    get revision() { return revision; },
    close() {
      if (reorderTimer !== null) {
        clearTimer(reorderTimer);
        reorderTimer = null;
      }
      pendingReorders.length = 0;
      inFlightReorderId = null;
      channel.removeEventListener('message', listener);
      try { channel.close(); } catch { /* already closed */ }
    },
  };
}
