/**
 * 019C (RoketPuncha sole-editor lane): the workspace-side durable writers the
 * entry wires. The workspace is the SOLE durable writer; these factories only
 * mutate through the injected model/commit hooks and never touch the widget
 * channel or recording persistence directly.
 *
 * - createWindowLayoutPickApplier: applies Winter's one typed committed pick
 *   set - every remove data-only, every successful add capability/descriptor -
 *   and persists ONCE through commitState. Cancel is byte-zero. Partial add
 *   failures are counted, never fatal.
 * - createWindowLayoutRetirementWriter: applies Ning's onRetireMember intent to
 *   one data-only removal/save; ignores the intent when the member or layout no
 *   longer exists. Never persists counters.
 *
 * 040: every capability/icon cache entry is keyed by the composite
 * `layoutId\u0000memberId` identity (the same key the pure runtime uses), so a
 * member cached for one layout never leaks into another layout that happens to
 * reference the same real window. The key function is injected so the entry and
 * these writers provably agree on one composite identity.
 */
import { windowLayoutMemberKey } from './window-layout-runtime.js';

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createWindowLayoutPickApplier({
  getState,
  commitState,
  observeCapability,
  model,
  capabilities,
  icons,
  isReadOnly = () => false,
  memberKey = windowLayoutMemberKey,
}) {
  /**
   * Every member of a layout whose persisted descriptor IS the one the pick named.
   *
   * This used to match on the descriptor's TITLE alone, and that was the last place in this project that found
   * a member by a mutable, non-unique string. A picker-commit removal carries exactly one thing - a persisted
   * descriptor, `{version, title, executableFingerprint}` - because the wire parser rejects any other key, and
   * even the caller that holds a member id in hand sends the descriptor alone. So the narrowest identity a
   * removal actually carries is that PAIR, and a pair is only usable when exactly one member carries it: two
   * windows of one application can share a title, and a title is not identity - the same defect the host fixed
   * on its session-token path. Returning every match is what lets the caller refuse rather than take whichever
   * happened to come first in the layout.
   */
  function membersMatchingDescriptor(next, layoutId, descriptor) {
    if (!isPlainObject(descriptor)) return [];
    const fingerprint = descriptor.executableFingerprint;
    const title = descriptor.title;
    if (typeof fingerprint !== 'string' || typeof title !== 'string') return [];
    return (next.windowLayouts ?? [])
      .find((layout) => layout.id === layoutId)
      ?.arrangement?.members
      ?.filter((member) => member.descriptor?.executableFingerprint === fingerprint
        && member.descriptor?.title === title) ?? [];
  }
  async function apply(layoutId, result) {
    if (!isPlainObject(result) || result.outcome === 'cancelled') return { outcome: 'cancelled' };
    if (result.outcome !== 'committed') return { outcome: 'failed', error: result.error ?? 'pick failed' };
    if (isReadOnly()) return { outcome: 'superseded' };
    const adds = Array.isArray(result.adds) ? result.adds : [];
    const removes = Array.isArray(result.removes) ? result.removes : [];
    let next = getState();
    let removed = 0;
    let added = 0;
    let failures = 0;
    // A removal the pick named but this layout cannot resolve to exactly one member. Counted and reported
    // rather than skipped silently: "nothing happened" and "I could not tell which member you meant" look
    // identical to the caller otherwise.
    let unmatched = 0;
    let ambiguous = 0;
    // 019DR2: stage ALL runtime-map changes locally. The durable state and the
    // capability/icon maps must commit TOGETHER or not at all, so a superseded
    // mid-observation apply cannot leave a retained member without its
    // binding/icon or orphan entries for an uncommitted new member.
    const capabilityDeletes = new Set();
    const iconDeletes = new Set();
    const capabilitySets = new Map();
    const iconSets = new Map();
    for (const remove of removes) {
      const matches = membersMatchingDescriptor(next, layoutId, remove?.descriptor);
      if (matches.length === 0) {
        // No member carries this descriptor: the window was retitled, or it is not in this layout at all.
        // Removing nothing is the only safe answer - the pick cannot name a member it did not match.
        unmatched += 1;
        continue;
      }
      if (matches.length > 1) {
        // More than one member carries it, so the pick does not say which; refusing beats removing the wrong
        // window, and beats removing both.
        ambiguous += 1;
        continue;
      }
      const existing = matches[0];
      next = model.removeWindowLayoutMember(next, layoutId, existing.id);
      capabilityDeletes.add(memberKey(layoutId, existing.id));
      iconDeletes.add(memberKey(layoutId, existing.id));
      removed += 1;
    }
    for (const add of adds) {
      if (!isPlainObject(add) || !isPlainObject(add.descriptor) || !isPlainObject(add.capability)) {
        failures += 1;
        continue;
      }
      let observed;
      try {
        observed = await observeCapability(add.capability);
      } catch {
        observed = null;
      }
      if (!observed || observed.outcome !== 'success' || !observed.observation) {
        failures += 1;
        continue;
      }
      const memberId = generateId();
      const member = {
        id: memberId,
        descriptor: add.descriptor,
        bounds: observed.observation.bounds ?? null,
        state: observed.observation.state === 'minimized' ? 'minimized' : 'normal',
      };
      next = model.addWindowLayoutMember(next, layoutId, member);
      capabilitySets.set(memberKey(layoutId, memberId), add.capability);
      if (add.candidate?.icon) iconSets.set(memberKey(layoutId, memberId), add.candidate.icon);
      added += 1;
    }
    // 019DR2 transactional boundary: re-check read-only, THEN commit state and
    // apply the staged runtime-map changes as one accepted path. A superseded
    // apply must leave state, capabilities and icons untouched.
    const hasChanges = next !== getState()
      || capabilityDeletes.size > 0 || capabilitySets.size > 0
      || iconDeletes.size > 0 || iconSets.size > 0;
    if (hasChanges) {
      if (isReadOnly()) return { outcome: 'superseded' };
      if (next !== getState()) commitState(next);
      for (const key of capabilityDeletes) capabilities?.delete(key);
      for (const key of iconDeletes) icons?.delete(key);
      for (const [key, capability] of capabilitySets) capabilities?.set(key, capability);
      for (const [key, icon] of iconSets) icons?.set(key, icon);
    }
    return { outcome: 'committed', added, removed, failures, unmatched, ambiguous };
  }
  return { apply };
}

export function createWindowLayoutRetirementWriter({
  getState,
  commitState,
  model,
  capabilities,
  icons,
  memberKey = windowLayoutMemberKey,
}) {
  function retire(layoutId, memberId) {
    const layout = getState().windowLayouts?.find((candidate) => candidate.id === layoutId);
    const member = layout?.arrangement?.members?.find((candidate) => candidate.id === memberId);
    if (!member) return { outcome: 'ignored' };
    const next = model.removeWindowLayoutMember(getState(), layoutId, memberId);
    capabilities?.delete(memberKey(layoutId, memberId));
    icons?.delete(memberKey(layoutId, memberId));
    if (next !== getState()) commitState(next);
    return { outcome: 'removed' };
  }
  return { retire };
}
