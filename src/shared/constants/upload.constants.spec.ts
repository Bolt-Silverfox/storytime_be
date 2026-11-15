describe('MAX_USER_UPLOAD_BYTES', () => {
  const MB = 1024 * 1024;
  const load = (env?: string) => {
    const saved = process.env.MAX_USER_UPLOAD_BYTES;
    if (env === undefined) delete process.env.MAX_USER_UPLOAD_BYTES;
    else process.env.MAX_USER_UPLOAD_BYTES = env;
    let value = 0;
    try {
      jest.isolateModules(() => {
        value =
          jest.requireActual<typeof import('./upload.constants')>(
            './upload.constants',
          ).MAX_USER_UPLOAD_BYTES;
      });
    } finally {
      if (saved === undefined) delete process.env.MAX_USER_UPLOAD_BYTES;
      else process.env.MAX_USER_UPLOAD_BYTES = saved;
    }
    return value;
  };

  it('is 200 MB when the override is unset', () => {
    expect(load()).toBe(200 * MB);
  });

  it('takes a positive override', () => {
    expect(load(String(100 * MB))).toBe(100 * MB);
  });

  it.each(['0', '-5', 'abc'])('ignores the invalid override %s', (bad) => {
    expect(load(bad)).toBe(200 * MB);
  });
});
