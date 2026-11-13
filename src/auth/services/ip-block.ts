import { isIPv4, isIPv6 } from 'net';

const UNKNOWN = 'unknown';

function expandIPv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return null;
    const [a, b, c, d] = tail.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const restGroups = rest === undefined ? [] : rest ? rest.split(':') : [];
  const missing = 8 - headGroups.length - restGroups.length;
  if (rest === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...headGroups,
    ...(rest === undefined ? [] : Array<string>(missing).fill('0')),
    ...restGroups,
  ];
  return groups.length === 8 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))
    ? groups.map((g) => parseInt(g, 16))
    : null;
}

export function ipBlock(ip: string | undefined): string {
  if (!ip) return UNKNOWN;
  const address = ip.split('%')[0];
  if (isIPv4(address)) return address.split('.').slice(0, 3).join('.');
  if (!isIPv6(address)) return UNKNOWN;

  const groups = expandIPv6(address);
  if (!groups) return UNKNOWN;

  const leadingZeros = groups.slice(0, 5).every((g) => g === 0);
  const mapped = leadingZeros && groups[5] === 0xffff;
  const compatible = leadingZeros && groups[5] === 0 && groups[6] !== 0;
  if (mapped || compatible) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8].join('.');
  }
  return groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':');
}

export function canonicalIp(ip: string | undefined): string {
  if (!ip) return UNKNOWN;
  const address = ip.split('%')[0];
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return UNKNOWN;
  const groups = expandIPv6(address);
  if (!groups) return UNKNOWN;
  const leadingZeros = groups.slice(0, 5).every((g) => g === 0);
  if (leadingZeros && groups[5] === 0xffff) {
    return [
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ].join('.');
  }
  return groups.map((g) => g.toString(16)).join(':');
}
