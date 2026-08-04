import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { SubscriptionWebhookService } from './subscription-webhook.service';
import { GooglePubSubVerifierService } from './google-pubsub-verifier.service';

describe('WebhookController', () => {
  let controller: WebhookController;
  let service: { handleApple: jest.Mock; handleGoogle: jest.Mock };
  let verifier: { verifyPushRequest: jest.Mock };

  beforeEach(async () => {
    service = {
      handleApple: jest.fn().mockResolvedValue({
        duplicate: false,
        status: 'processed',
        action: 'apple:DID_RENEW -> activate',
      }),
      handleGoogle: jest.fn().mockResolvedValue({
        duplicate: false,
        status: 'processed',
        action: 'google:SUBSCRIPTION_2 -> activate',
      }),
    };
    verifier = { verifyPushRequest: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: SubscriptionWebhookService, useValue: service },
        { provide: GooglePubSubVerifierService, useValue: verifier },
      ],
    }).compile();

    controller = module.get(WebhookController);
  });

  it('routes Apple notifications to the service', async () => {
    const body = { signedPayload: 'jws' };
    const res = await controller.apple(body);
    expect(service.handleApple).toHaveBeenCalledWith(body);
    expect(res.status).toBe('processed');
  });

  it('verifies the Pub/Sub OIDC token then routes Google notifications to the service', async () => {
    const body = {
      message: { data: 'base64', messageId: 'm-1' },
      subscription: 's',
    };
    const res = await controller.google(body, 'Bearer token-abc');
    expect(verifier.verifyPushRequest).toHaveBeenCalledWith('Bearer token-abc');
    expect(service.handleGoogle).toHaveBeenCalledWith(body);
    expect(res.status).toBe('processed');
  });

  it('rejects the Google webhook (and never processes) when OIDC verification fails', async () => {
    verifier.verifyPushRequest.mockRejectedValue(
      new UnauthorizedException('Invalid Pub/Sub OIDC token'),
    );
    const body = {
      message: { data: 'base64', messageId: 'm-2' },
      subscription: 's',
    };
    await expect(controller.google(body, 'Bearer bad')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(service.handleGoogle).not.toHaveBeenCalled();
  });

  it('propagates errors thrown by the service (e.g. bad signature)', async () => {
    service.handleApple.mockRejectedValue(new Error('bad signature'));
    await expect(controller.apple({ signedPayload: 'x' })).rejects.toThrow(
      'bad signature',
    );
  });
});
