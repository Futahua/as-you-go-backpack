import { addWindowLayoutMember } from '../workspace-model-20260730b.js';

/** Add one host-confirmed window lifecycle event to the durable Auto owner.
 * Host events are hints: exact instance resolution and a live observation must
 * both succeed, then owner/duplicate/suppression state is checked again after
 * the asynchronous calls before a commit is attempted. */
export function createWindowLayoutAutoTracking({
  getState,
  resolveWindowInstance,
  resolveWindowDescriptor,
  observeWindowCapability,
  commit,
  createMemberId = () => crypto.randomUUID(),
  onCommitted = () => {},
}) {
  if (typeof getState !== 'function'
    || typeof resolveWindowInstance !== 'function'
    || typeof observeWindowCapability !== 'function'
    || typeof commit !== 'function') {
    throw new TypeError('Auto tracking requires state, resolver, observer and durable commit adapters');
  }

  async function addFromEvent(event) {
    const instanceId = event?.windowInstanceId;
    if (typeof instanceId !== 'string' || !/^W[0-9a-f]{16}$/i.test(instanceId)) return { outcome: 'invalid' };
    const initialLayout = (getState().windowLayouts ?? []).find((layout) => layout.tracking?.enabled === true);
    if (!initialLayout) return { outcome: 'disabled' };
    if ((initialLayout.arrangement?.members ?? []).some((member) => member.descriptor?.windowInstanceId === instanceId)) {
      return { outcome: 'duplicate' };
    }
    if (initialLayout.tracking?.suppressedInstanceIds?.includes(instanceId)) return { outcome: 'suppressed' };

    let probe;
    try {
      probe = await resolveWindowInstance(instanceId);
    } catch {
      return { outcome: 'resolve-failed' };
    }
    if (probe?.outcome !== 'success' || !probe.descriptor
      || probe.descriptor.windowInstanceId !== instanceId) return { outcome: 'unresolved' };
    // Existence probes deliberately do not mint capabilities. Auto-add is an
    // explicit one-window action, so bind the exact freshly probed identity here
    // instead of expecting a disposable capability from the watcher event.
    let resolved = probe;
    if (!probe.capability) {
      if (typeof resolveWindowDescriptor !== 'function') return { outcome: 'unresolved' };
      try {
        resolved = await resolveWindowDescriptor(probe.descriptor);
      } catch {
        return { outcome: 'resolve-failed' };
      }
    }
    if (resolved?.outcome !== 'success' || !resolved.capability || !resolved.descriptor
      || resolved.descriptor.windowInstanceId !== instanceId) return { outcome: 'unresolved' };
    let observed;
    try {
      observed = await observeWindowCapability(resolved.capability);
    } catch {
      return { outcome: 'unobserved' };
    }
    if (observed?.outcome !== 'success') return { outcome: 'unobserved' };
    if (typeof observed.observation?.windowInstanceId === 'string'
      && observed.observation.windowInstanceId !== instanceId) return { outcome: 'unobserved' };

    const currentState = getState();
    const currentLayout = (currentState.windowLayouts ?? []).find((layout) =>
      layout.id === initialLayout.id && layout.tracking?.enabled === true);
    if (!currentLayout) return { outcome: 'disabled' };
    if ((currentLayout.arrangement?.members ?? []).some((member) => member.descriptor?.windowInstanceId === instanceId)) {
      return { outcome: 'duplicate' };
    }
    if (currentLayout.tracking?.suppressedInstanceIds?.includes(instanceId)) return { outcome: 'suppressed' };

    const member = {
      id: createMemberId(),
      descriptor: resolved.descriptor,
      bounds: observed.observation?.bounds ?? event.observation?.bounds ?? null,
      state: observed.observation?.state === 'minimized' ? 'minimized' : 'normal',
    };
    const nextState = addWindowLayoutMember(currentState, currentLayout.id, member);
    if (nextState === currentState) return { outcome: 'duplicate' };
    try {
      if (!(await commit(nextState))) return { outcome: 'persistence-failed' };
    } catch {
      return { outcome: 'persistence-failed' };
    }
    try {
      await onCommitted({ layoutId: currentLayout.id, member, capability: resolved.capability });
    } catch {
      // Membership is already durable; notification failures cannot turn an
      // added member into a failed result or prevent later lifecycle events.
    }
    return { outcome: 'added', layoutId: currentLayout.id, member };
  }

  return { addFromEvent };
}
