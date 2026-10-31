import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv } from './env.validation';
import { nonProdThrottleMultiplier } from './throttle.config';

// Guards the zod 3 -> 4 upgrade (dependency audit fix): defaults, coercion and
// the blank-means-default preprocess must behave exactly as before.
const base = {
  ELEVEN_LABS_KEY: 'k',
  CLOUDINARY_CLOUD_NAME: 'c',
  CLOUDINARY_API_KEY: 'k',
  CLOUDINARY_API_SECRET: 's',
  DEFAULT_SENDER_EMAIL: 'a@example.com',
  DEFAULT_SENDER_NAME: 'n',
  SMTP_HOST: 'localhost',
  SMTP_USER: 'u@example.com',
  SMTP_PASS: 'p',
  JWT_SECRET: 'j',
  ADMIN_SECRET: 'a',
  SECRET: 's',
  WEB_APP_BASE_URL: 'https://app.example.com',
  GOOGLE_CLIENT_ID: 'g',
  GOOGLE_CLIENT_SECRET: 'g',
  GOOGLE_WEB_CLIENT_ID: 'g',
  GOOGLE_ANDROID_CLIENT_ID: 'g',
  GOOGLE_IOS_CLIENT_ID: 'g',
  BACKEND_BASE_URL: 'https://api.example.com',
  DEEPGRAM_API_KEY: 'd',
  APPLE_CLIENT_ID: 'a',
  APPLE_SERVICE_ID: 'a',
  GEMINI_API_KEY: 'g',
  HF_TOKEN: 'h',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.MAIL_ENCRYPTION).toBe('TLS');
    expect(env.NODE_ENV).toBe('production');
  });

  it('transforms SMTP_SECURE strings to booleans', () => {
    expect(validateEnv({ ...base, SMTP_SECURE: 'true' }).SMTP_SECURE).toBe(
      true,
    );
    expect(validateEnv({ ...base, SMTP_SECURE: 'false' }).SMTP_SECURE).toBe(
      false,
    );
  });

  it('coerces numeric strings', () => {
    expect(validateEnv({ ...base, PORT: '4000' }).PORT).toBe(4000);
  });

  it('treats a blank quota cooldown as unset but rejects junk', () => {
    expect(
      validateEnv({ ...base, ELEVEN_LABS_QUOTA_COOLDOWN_MS: '  ' })
        .ELEVEN_LABS_QUOTA_COOLDOWN_MS,
    ).toBeUndefined();
    expect(() =>
      validateEnv({ ...base, ELEVEN_LABS_QUOTA_COOLDOWN_MS: 'abc' }),
    ).toThrow('Invalid environment variables');
    expect(() =>
      validateEnv({ ...base, ELEVEN_LABS_QUOTA_COOLDOWN_MS: '0' }),
    ).toThrow();
  });

  it('rejects missing required keys, bad urls and partial firebase config', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: undefined })).toThrow();
    expect(() => validateEnv({ ...base, WEB_APP_BASE_URL: 'nope' })).toThrow();
    expect(() => validateEnv({ ...base, FIREBASE_PROJECT_ID: 'p' })).toThrow();
  });

  it('TRUST_PROXY_HOPS defaults to 0, coerces strings, blank means default', () => {
    expect(validateEnv(base).TRUST_PROXY_HOPS).toBe(0);
    expect(
      validateEnv({ ...base, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS,
    ).toBe(1);
    expect(
      validateEnv({ ...base, TRUST_PROXY_HOPS: ' ' }).TRUST_PROXY_HOPS,
    ).toBe(0);
  });

  it('TRUST_PROXY_HOPS rejects junk, negatives and fractions at startup', () => {
    for (const v of ['abc', '-1', '1.5']) {
      expect(() => validateEnv({ ...base, TRUST_PROXY_HOPS: v })).toThrow();
    }
  });

  describe('unset NODE_ENV stays strict (rate limits are not relaxed)', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    it('validateEnv -> production -> multiplier 1', () => {
      const withoutNodeEnv: Record<string, unknown> = { ...base };
      delete withoutNodeEnv.NODE_ENV;
      const env = validateEnv(withoutNodeEnv);
      expect(env.NODE_ENV).toBe('production');
      expect(nonProdThrottleMultiplier(env.NODE_ENV)).toBe(1);
    });

    it('through ConfigModule with NODE_ENV absent from process.env', async () => {
      delete process.env.NODE_ENV;
      Object.assign(process.env, base);
      const mod = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ ignoreEnvFile: true, validate: validateEnv }),
        ],
      }).compile();
      const nodeEnv = mod.get(ConfigService).get<string>('NODE_ENV');
      expect(nodeEnv).toBe('production');
      expect(nonProdThrottleMultiplier(process.env.NODE_ENV)).toBe(1);
      expect(nonProdThrottleMultiplier(nodeEnv)).toBe(1);
    });
  });
});
