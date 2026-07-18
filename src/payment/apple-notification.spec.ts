import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppleVerificationService } from './apple-verification.service';

/**
 * Exercises the ASSN v2 JWS signature verification + decoding in
 * AppleVerificationService.parseSignedNotification using a real, locally
 * generated EC (P-256) certificate chain. The generated root's fingerprint is
 * injected via APPLE_ROOT_CA_FINGERPRINT so the pinning check passes.
 */

const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString('base64url');

let opensslAvailable = true;
try {
  execFileSync('openssl', ['version']);
} catch {
  opensslAvailable = false;
}

interface Chain {
  x5c: string[];
  leafKey: crypto.KeyObject;
  rootFingerprint: string;
}

function buildChain(): Chain {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-jws-'));
  const p = (f: string) => path.join(dir, f);
  const run = (args: string[]) => execFileSync('openssl', args);

  run([
    'ecparam',
    '-name',
    'prime256v1',
    '-genkey',
    '-noout',
    '-out',
    p('root.key'),
  ]);
  run([
    'req',
    '-x509',
    '-new',
    '-key',
    p('root.key'),
    '-out',
    p('root.crt'),
    '-days',
    '2',
    '-subj',
    '/CN=Test Apple Root',
  ]);
  run([
    'ecparam',
    '-name',
    'prime256v1',
    '-genkey',
    '-noout',
    '-out',
    p('leaf.key'),
  ]);
  run([
    'req',
    '-new',
    '-key',
    p('leaf.key'),
    '-out',
    p('leaf.csr'),
    '-subj',
    '/CN=Test Apple Leaf',
  ]);
  run([
    'x509',
    '-req',
    '-in',
    p('leaf.csr'),
    '-CA',
    p('root.crt'),
    '-CAkey',
    p('root.key'),
    '-CAcreateserial',
    '-out',
    p('leaf.crt'),
    '-days',
    '1',
  ]);

  const rootCert = new crypto.X509Certificate(fs.readFileSync(p('root.crt')));
  const leafCert = new crypto.X509Certificate(fs.readFileSync(p('leaf.crt')));
  const leafKey = crypto.createPrivateKey(fs.readFileSync(p('leaf.key')));

  fs.rmSync(dir, { recursive: true, force: true });

  return {
    x5c: [
      Buffer.from(leafCert.raw).toString('base64'),
      Buffer.from(rootCert.raw).toString('base64'),
    ],
    leafKey,
    rootFingerprint: rootCert.fingerprint256,
  };
}

function nestedJws(payload: Record<string, unknown>): string {
  return `${b64url('{"alg":"ES256"}')}.${b64url(JSON.stringify(payload))}.${b64url('sig')}`;
}

function makeSignedPayload(
  chain: Chain,
  payload: Record<string, unknown>,
): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', x5c: chain.x5c }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: chain.leafKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${b64url(sig)}`;
}

const describeIf = opensslAvailable ? describe : describe.skip;

describeIf('AppleVerificationService.parseSignedNotification', () => {
  let chain: Chain;
  let service: AppleVerificationService;

  const notificationPayload = {
    notificationType: 'DID_RENEW',
    subtype: 'BILLING_RECOVERY',
    notificationUUID: 'uuid-123',
    signedDate: Date.now(),
    data: {
      bundleId: 'com.storytime.app',
      environment: 'Production',
      signedTransactionInfo: nestedJws({
        originalTransactionId: 'orig-999',
        productId: 'com.storytime.monthly',
        expiresDate: 1893456000000,
      }),
      signedRenewalInfo: nestedJws({
        originalTransactionId: 'orig-999',
        autoRenewStatus: 1,
      }),
    },
  };

  beforeAll(() => {
    chain = buildChain();
  });

  const build = async (fingerprint: string) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppleVerificationService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'APPLE_ROOT_CA_FINGERPRINT' ? fingerprint : undefined,
          },
        },
      ],
    }).compile();
    return module.get(AppleVerificationService);
  };

  beforeEach(async () => {
    service = await build(chain.rootFingerprint);
  });

  it('verifies a valid JWS and decodes the notification + nested transaction info', () => {
    const signedPayload = makeSignedPayload(chain, notificationPayload);
    const info = service.parseSignedNotification(signedPayload);

    expect(info.notificationType).toBe('DID_RENEW');
    expect(info.subtype).toBe('BILLING_RECOVERY');
    expect(info.notificationUUID).toBe('uuid-123');
    expect(info.transactionInfo?.originalTransactionId).toBe('orig-999');
    expect(info.transactionInfo?.productId).toBe('com.storytime.monthly');
    expect(info.renewalInfo?.autoRenewStatus).toBe(1);
  });

  it('rejects a tampered signature', () => {
    const signedPayload = makeSignedPayload(chain, notificationPayload);
    const parts = signedPayload.split('.');
    // Flip the payload but keep the original signature -> signature mismatch.
    parts[1] = b64url(
      JSON.stringify({ ...notificationPayload, notificationUUID: 'evil' }),
    );
    const tampered = parts.join('.');

    expect(() => service.parseSignedNotification(tampered)).toThrow(
      HttpException,
    );
  });

  it('rejects when the root CA fingerprint does not match the pin', async () => {
    const otherService = await build('AA:BB:CC');
    const signedPayload = makeSignedPayload(chain, notificationPayload);

    expect(() => otherService.parseSignedNotification(signedPayload)).toThrow(
      /root certificate is not trusted/i,
    );
  });

  it('rejects a payload missing the x5c chain', () => {
    const header = b64url(JSON.stringify({ alg: 'ES256' }));
    const body = b64url(JSON.stringify(notificationPayload));
    const bad = `${header}.${body}.${b64url('sig')}`;

    expect(() => service.parseSignedNotification(bad)).toThrow(
      /x5c certificate chain/i,
    );
  });

  it('rejects a non-JWS string', () => {
    expect(() => service.parseSignedNotification('not-a-jws')).toThrow(
      HttpException,
    );
  });

  it('rejects a notification addressed to a different bundleId (400)', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppleVerificationService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'APPLE_ROOT_CA_FINGERPRINT')
                return chain.rootFingerprint;
              if (key === 'APPLE_BUNDLE_ID') return 'com.storytime.app';
              return undefined;
            },
          },
        },
      ],
    }).compile();
    const scoped = module.get(AppleVerificationService);

    const signedPayload = makeSignedPayload(chain, {
      ...notificationPayload,
      data: { ...notificationPayload.data, bundleId: 'com.evil.other' },
    });

    expect(() => scoped.parseSignedNotification(signedPayload)).toThrow(
      /bundleId/i,
    );
  });
});

describe('AppleVerificationService.parseSignedNotification malformed header', () => {
  let service: AppleVerificationService;

  const b64 = (s: string): string => Buffer.from(s).toString('base64url');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppleVerificationService,
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    service = module.get(AppleVerificationService);
  });

  // These exercise the header guard before any certificate work, so they do not
  // need a generated chain / openssl.
  it('rejects a JWS whose header decodes to null (no unhandled 500)', () => {
    const jws = `${b64('null')}.${b64('{}')}.${b64('sig')}`;
    try {
      service.parseSignedNotification(jws);
      throw new Error('expected parseSignedNotification to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(400);
    }
  });

  it('rejects a JWS whose header decodes to an array', () => {
    const jws = `${b64('[]')}.${b64('{}')}.${b64('sig')}`;
    expect(() => service.parseSignedNotification(jws)).toThrow(HttpException);
  });
});
