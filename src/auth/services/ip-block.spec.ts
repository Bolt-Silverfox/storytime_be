import { ipBlock } from './ip-block';

describe('ipBlock', () => {
  it.each([
    ['203.0.113.77', '203.0.113'],
    ['::ffff:203.0.113.77', '203.0.113'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2'],
    ['2001:DB8:1:2::1', '2001:db8:1:2'],
    ['2001:db8::1', '2001:db8:0:0'],
    ['::1', '0:0:0:0'],
    ['::ffff:0102:0304', '1.2.3'],
    ['0:0:0:0:0:ffff:1.2.3.4', '1.2.3'],
    ['0000:0000:0000:0000:0000:ffff:0102:0304', '1.2.3'],
    ['::1.2.3.4', '1.2.3'],
    ['fe80::1%eth0', 'fe80:0:0:0'],
    ['2001:db8:1:2::1%12', '2001:db8:1:2'],
    [undefined, 'unknown'],
    ['not-an-ip', 'unknown'],
  ])('maps %s to %s', (input, expected) => {
    expect(ipBlock(input)).toBe(expected);
  });
});
