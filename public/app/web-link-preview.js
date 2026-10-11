/** Ephemeral link views; the host owns the shared persistent browser profile. */
export function createWebLinkPreview({ host, onSession = () => {} }) {
  let generation = 0, sessionId = null, queue = Promise.resolve();
  const enqueue = action => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const release = async () => {
    const id = sessionId;
    sessionId = null;
    onSession(null);
    if (id) await host.fileCapability('browser-close', { sessionId: id }).catch(() => {});
  };
  return {
    open(url, rect, current = () => true) {
      const ticket = ++generation;
      return enqueue(async () => {
        if (ticket !== generation || !current()) return null;
        const result = await host.fileCapability('browser-open', { url, rect });
        if (result?.ok && result.sessionId) {
          sessionId = result.sessionId;
          if (ticket !== generation || !current()) { await release(); return null; }
          onSession(sessionId);
        }
        return ticket === generation && current() ? result : null;
      });
    },
    close() { ++generation; return enqueue(release); },
  };
}
