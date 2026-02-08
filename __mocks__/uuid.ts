// Mock for uuid module
export const v4 = jest.fn(() => 'test-uuid-v4');
export const v1 = jest.fn(() => 'test-uuid-v1');
export const validate = jest.fn(() => true);
export const version = jest.fn(() => 4);
export const NIL = '00000000-0000-0000-0000-000000000000';
export const MAX = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

export default {
  v4,
  v1,
  validate,
  version,
  NIL,
  MAX,
};
