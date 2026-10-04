/** Preview capability resolution/identity retention. Existing cache is injected;
 * native identity remains in Papers, and snapshots/store remain caller-owned. */
import { windowLayoutMemberKey, resolveWindowLayoutDescriptorWithFallback } from './window-layout-runtime.js';
export function createWindowLayoutPreviewCapabilities({
  WIDGET_SURFACE, document, host, capabilityForMember,
  resolveWindowLayoutMemberDescriptor, windowLayoutWidgetPreviewCapabilities, getSnapshot,
}) {
function widgetPreviewIdentity(member) {
  return JSON.stringify([
    member?.descriptor?.version ?? '',
    member?.descriptor?.title ?? '',
    member?.descriptor?.executableFingerprint ?? '',
    member?.windowInstanceId ?? '',
  ]);
}

/** Drop only the cached preview capabilities whose WINDOW IDENTITY changed, so a
 * state-only re-render keeps its warm capabilities. A capability names a window;
 * a member's minimize/restore does not rename it.
 *
 * The blanket clear this replaces had one accidental virtue: it guaranteed
 * eventual recovery after a helper restart replaced the underlying tokens.
 * Retaining capabilities longer means a stale one must be evicted explicitly,
 * which `forgetWidgetPreviewCapability` does when Papers reports it missing. */
function evictStaleWidgetPreviewCapabilities(snapshot) {
  const identities = new Map();
  for (const member of snapshot?.members ?? []) {
    identities.set(
      windowLayoutMemberKey(snapshot?.id ?? '', member.id),
      widgetPreviewIdentity(member),
    );
  }
  for (const key of [...windowLayoutWidgetPreviewCapabilities.keys()]) {
    const identity = identities.get(key);
    if (identity === undefined || identity !== windowLayoutWidgetPreviewIdentities.get(key)) {
      windowLayoutWidgetPreviewCapabilities.delete(key);
      windowLayoutWidgetPreviewIdentities.delete(key);
    }
  }
}

/** Window identity each cached preview capability was resolved for. */
const windowLayoutWidgetPreviewIdentities = new Map();

/** A capability Papers no longer recognises (helper restart, window gone) must
 * not be retried forever now that the card no longer clears the cache. */
function forgetWidgetPreviewCapability(layoutId, memberId) {
  const key = windowLayoutMemberKey(layoutId, memberId);
  windowLayoutWidgetPreviewCapabilities.delete(key);
  windowLayoutWidgetPreviewIdentities.delete(key);
}

function resolveWindowLayoutPreviewCapability(layoutId, memberId) {
  if (!WIDGET_SURFACE) return capabilityForMember(layoutId, memberId);
  // 040: composite layout\u0000member cache identity so the widget preview for
  // one layout never reuses a capability cached under another layout's member.
  const key = windowLayoutMemberKey(layoutId, memberId);
  const member = (getSnapshot()?.members ?? [])
    .find((candidate) => candidate.id === memberId);
  if (!member || !member.descriptor || typeof member.descriptor !== 'object' || Array.isArray(member.descriptor)) {
    if (WIDGET_SURFACE) document.title = 'preview: no member descriptor';
    windowLayoutWidgetPreviewCapabilities.delete(key);
    return Promise.resolve(null);
  }
  const cached = windowLayoutWidgetPreviewCapabilities.get(key);
  if (cached) return Promise.resolve(cached);
  // THE EXACT-IDENTITY PATH MUST RETURN A CAPABILITY.
  //
  // resolveWindowInstance is an EXISTENCE probe: it answers success with a
  // descriptor and NO capability, deliberately, so a two-second sweep cannot mint a
  // binding per member. This resolver requires a capability, and the fallback only
  // fires on a missing outcome - so success-without-capability fell straight
  // through and the preview returned null. Hover and Shift-peek both died there,
  // before any capture was ever requested, which is why neither ever appeared.
  //
  // The descriptor can carry its own windowInstanceId, and THAT path returns a
  // capability: Papers matches the exact instance and issues one binding.
  const exactDescriptor = typeof member.windowInstanceId === 'string'
    ? { ...member.descriptor, windowInstanceId: member.windowInstanceId }
    : member.descriptor;
  const resolve = typeof member.windowInstanceId === 'string' && typeof host.resolveWindowDescriptor === 'function'
    ? resolveWindowLayoutDescriptorWithFallback({
      descriptor: exactDescriptor,
      exactIdentity: member.windowInstanceId,
      members: getSnapshot()?.members,
      resolveExact: () => host.resolveWindowDescriptor(exactDescriptor),
      resolveFallback: (value) => host.resolveWindowDescriptor(value),
    })
    : resolveWindowLayoutMemberDescriptor(member.descriptor, layoutId, getSnapshot()?.members);
  return Promise.resolve(resolve).then((resolved) => {
    if (WIDGET_SURFACE) document.title = 'preview resolve: ' + String(resolved?.outcome ?? 'empty')
      + ' cap=' + (resolved?.capability ? 'yes' : 'no');
    if (!resolved || resolved.outcome !== 'success' || !resolved.capability) {
      windowLayoutWidgetPreviewCapabilities.delete(key);
      return null;
    }
    windowLayoutWidgetPreviewCapabilities.set(key, resolved.capability);
    windowLayoutWidgetPreviewIdentities.set(key, widgetPreviewIdentity(member));
    return resolved.capability;
  }).catch((error) => {
    if (WIDGET_SURFACE) document.title = 'preview resolve error: ' + String(error).slice(0, 90);
    return null;
  });
}


return { resolve: resolveWindowLayoutPreviewCapability, evict: evictStaleWidgetPreviewCapabilities, forget: forgetWidgetPreviewCapability };
}
