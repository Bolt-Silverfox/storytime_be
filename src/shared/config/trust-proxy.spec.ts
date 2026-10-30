import { applyTrustProxy } from './trust-proxy';

describe('applyTrustProxy', () => {
  it('leaves Express untouched when hops is 0 (default, local/dev)', () => {
    const set = jest.fn();
    expect(applyTrustProxy({ set }, 0)).toBe(0);
    expect(set).not.toHaveBeenCalled();
  });

  it('sets express "trust proxy" to the hop count when hops > 0', () => {
    const set = jest.fn();
    expect(applyTrustProxy({ set }, 1)).toBe(1);
    expect(set).toHaveBeenCalledWith('trust proxy', 1);
  });

  it('treats undefined / negative / NaN as 0', () => {
    const set = jest.fn();
    expect(applyTrustProxy({ set }, undefined)).toBe(0);
    expect(applyTrustProxy({ set }, -2)).toBe(0);
    expect(applyTrustProxy({ set }, Number.NaN)).toBe(0);
    expect(set).not.toHaveBeenCalled();
  });
});
