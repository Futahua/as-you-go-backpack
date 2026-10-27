/** Preserve file types when a rename supplies only a new base name. */
export function preserveRenameExtension(path, name, kind) {
  const next = String(name || '').trim();
  if (!next || kind !== 'file') return next;
  const original = String(path || '').split(/[\\/]/).pop();
  const dot = original.lastIndexOf('.');
  const nextDot = next.lastIndexOf('.');
  return dot > 0 && dot < original.length - 1 && nextDot <= 0
    ? next + original.slice(dot) : next;
}
