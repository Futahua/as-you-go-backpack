/** Pure AYG membership policy. Host descriptors remain the native identity authority.
 * No host calls, store, persistence, runtime caches or lifecycle ownership. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validWindowInstanceId(value) {
  return typeof value === 'string' && /^W[0-9a-f]{16}$/i.test(value);
}

export function validExecutableFingerprint(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/** Compare descriptors across identity generations.
 * Exact ids decide when both exist. For a mixed WID/legacy pair, a shared
 * executable fingerprint stays ambiguous across title changes; differing
 * valid fingerprints allow an add. Papers defines this fingerprint as a hash
 * of the normalized process image path, so this bridge relies on stable path
 * reporting across observations. It does not identify file contents or a
 * process. Missing or malformed fingerprints remain ambiguous. Both-legacy
 * matching retains the title+fingerprint pair. */
export function windowDescriptorIdentityRelation(memberDescriptor, pickedDescriptor) {
  if (!isPlainObject(memberDescriptor) || !isPlainObject(pickedDescriptor)) return 'different';
  const memberHasInstanceIdentity = memberDescriptor.windowInstanceId !== undefined;
  const pickedHasInstanceIdentity = pickedDescriptor.windowInstanceId !== undefined;
  const memberHasValidInstanceIdentity = validWindowInstanceId(memberDescriptor.windowInstanceId);
  const pickedHasValidInstanceIdentity = validWindowInstanceId(pickedDescriptor.windowInstanceId);
  if (memberHasInstanceIdentity || pickedHasInstanceIdentity) {
    if ((memberHasInstanceIdentity && !memberHasValidInstanceIdentity)
      || (pickedHasInstanceIdentity && !pickedHasValidInstanceIdentity)) return 'ambiguous';
    if (memberHasValidInstanceIdentity && pickedHasValidInstanceIdentity) {
      return memberDescriptor.windowInstanceId === pickedDescriptor.windowInstanceId ? 'same' : 'different';
    }
    const executableIdentityAvailable = validExecutableFingerprint(memberDescriptor.executableFingerprint)
      && validExecutableFingerprint(pickedDescriptor.executableFingerprint);
    if (executableIdentityAvailable
      && memberDescriptor.executableFingerprint !== pickedDescriptor.executableFingerprint) return 'different';
    return 'ambiguous';
  }
  const executableIdentityAvailable = validExecutableFingerprint(memberDescriptor.executableFingerprint)
    && validExecutableFingerprint(pickedDescriptor.executableFingerprint);
  const executableMatches = executableIdentityAvailable
    && memberDescriptor.executableFingerprint === pickedDescriptor.executableFingerprint;
  const pairMatches = typeof memberDescriptor.title === 'string'
    && typeof pickedDescriptor.title === 'string'
    && executableMatches
    && memberDescriptor.title === pickedDescriptor.title;
  return pairMatches ? 'same' : 'different';
}

export function windowLayoutHasValidInstanceId(value) {
  return isPlainObject(value) && validWindowInstanceId(value.windowInstanceId);
}

/** The native Direct Pick seed keeps exact instance ids when available so the
 * host can distinguish same-title siblings. Legacy descriptors still collapse
 * by title and executable fingerprint; malformed present ids fail closed
 * rather than being silently downgraded to that weaker identity. */
export function windowLayoutPickMemberDescriptors(members) {
  const unique = new Map();
  for (const member of Array.isArray(members) ? members : []) {
    const descriptor = member?.descriptor ?? member;
    if (!isPlainObject(descriptor) || descriptor.version !== 1
      || typeof descriptor.title !== 'string'
      || typeof descriptor.executableFingerprint !== 'string') continue;
    const hasInstanceId = descriptor.windowInstanceId !== undefined;
    if (hasInstanceId && !validWindowInstanceId(descriptor.windowInstanceId)) return null;
    const identity = hasInstanceId
      ? `window:${descriptor.windowInstanceId}`
      : `legacy:${descriptor.executableFingerprint}|${descriptor.title}`;
    if (!unique.has(identity)) {
      unique.set(identity, {
        version: 1,
        title: descriptor.title,
        executableFingerprint: descriptor.executableFingerprint,
        ...(hasInstanceId ? { windowInstanceId: descriptor.windowInstanceId } : {}),
      });
    }
  }
  return [...unique.values()];
}

/** Candidate rows have an exact host-observed identity, but no persisted
 * executable fingerprint. Only an exact, valid instance id can establish
 * current membership before binding; title-only matching can confuse sibling
 * windows and retitled members. Duplicate persisted ids still count as current
 * here, while the commit applier refuses their ambiguous removal. */
export function windowLayoutCandidateIsMember(members, candidate) {
  if (!windowLayoutHasValidInstanceId(candidate)) return false;
  return (Array.isArray(members) ? members : []).some((member) =>
    windowDescriptorIdentityRelation(member?.descriptor, candidate) === 'same');
}

export function windowLayoutPickForBoundCandidate(members, bound, candidate = null) {
  if (!isPlainObject(bound) || !isPlainObject(bound.descriptor)) return null;
  const descriptor = bound.descriptor;
  const current = Array.isArray(members) ? members : [];
  if (descriptor.windowInstanceId !== undefined && !validWindowInstanceId(descriptor.windowInstanceId)) return null;
  if (descriptor.windowInstanceId === undefined
    && !validExecutableFingerprint(descriptor.executableFingerprint)) return null;
  if (isPlainObject(candidate) && candidate.windowInstanceId !== undefined
    && (!validWindowInstanceId(candidate.windowInstanceId)
      || !validWindowInstanceId(descriptor.windowInstanceId)
      || candidate.windowInstanceId !== descriptor.windowInstanceId)) return null;
  const relations = current.map((member) =>
    windowDescriptorIdentityRelation(member?.descriptor, descriptor));
  if (relations.includes('ambiguous')) return null;
  const isMember = relations.includes('same');
  return isMember
    ? { outcome: 'committed', adds: [], removes: [{ descriptor }] }
    : { outcome: 'committed', adds: [{ descriptor, capability: bound.capability, candidate }], removes: [] };
}

/** A native-list remove intent can only remove this exact bound identity.
 * Unlike a toggle pick, absence is a no-op and can never turn into an add. */
export function windowLayoutRemoveForBoundCandidate(members, bound) {
  const pick = windowLayoutPickForBoundCandidate(members, bound);
  if (!pick) return null;
  return { outcome: 'committed', adds: [], removes: pick.removes };
}
