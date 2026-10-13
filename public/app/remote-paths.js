// Another device's drives are addressed as \\papers~<deviceId>\D:\..., served by Papers.
export const REMOTE_ROOT = /^\\\\papers~[0-9a-f-]{36}/i;
/** Device names by lower-cased root, filled whenever the paired devices are listed. */
export const remoteDeviceNames = new Map();
/** Shows \\papers~<id>\C:\x as \\LapDog\C:\x wherever a path is displayed. */
export function displayPath(value) {
  const text = String(value ?? '');
  const root = text.match(REMOTE_ROOT);
  return root ? '\\\\' + (remoteDeviceNames.get(root[0].toLowerCase()) || 'Device') + text.slice(root[0].length) : text;
}
