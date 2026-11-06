import { isIPv4, isIPv6 } from 'net';

const UNKNOWN = 'unknown';

export function ipBlock(ip: string | undefined): string {
  if (!ip) return UNKNOWN;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const address = mapped ? mapped[1] : ip;

  if (isIPv4(address)) return address.split('.').slice(0, 3).join('.');
  if (!isIPv6(address)) return UNKNOWN;

  const [head, tail] = address.toLowerCase().split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail === undefined ? [] : tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups];
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':');
}
