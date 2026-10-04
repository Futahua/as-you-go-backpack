/** Bind the retained chooser row; recover expired ids only through one unambiguous match.
 * Owns no document state, membership, recording, or persistence. */
export function createWindowLayoutCandidateBinder({ bindWindowCandidate, windowCandidates }) {
  return async function bindWindowLayoutPickerCandidate(candidateId, row) {
    let bound = await bindWindowCandidate(candidateId);
    if (bound?.outcome !== 'missing' || !row) return { bound, row };
    const refreshed = await windowCandidates({ includeNativeIcons: false });
    if (refreshed?.outcome !== 'success') return { bound, row };
    const matches = (refreshed.candidates ?? []).filter((candidate) => {
      if (candidate.title !== row.title) return false;
      if (typeof row.applicationLabel === 'string' && typeof candidate.applicationLabel === 'string') {
        return candidate.applicationLabel === row.applicationLabel;
      }
      return true;
    });
    if (matches.length !== 1) return { bound, row };
    const rebound = await bindWindowCandidate(matches[0].id);
    if (rebound?.outcome === 'success') return { bound: rebound, row: matches[0] };
    return { bound: rebound, row: matches[0] };
  };
}
