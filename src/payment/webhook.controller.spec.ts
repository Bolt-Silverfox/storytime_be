import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { SubscriptionWebhookService } from './subscription-webhook.service';

describe('WebhookController', () => {
  let controller: WebhookController;
  let service: { handleApple: jest.Mock; handleGoogle: jest.Mock };

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [{ provide: SubscriptionWebhookService, useValue: service }],
    }).compile();

    controller = module.get(WebhookController);
  });

  it('routes Apple notifications to the service', async () => {
    const body = { signedPayload: 'jws' };
    const res = await controller.apple(body);
    expect(service.handleApple).toHaveBeenCalledWith(body);
    expect(res.status).toBe('processed');
  });

  it('routes Google notifications to the service', async () => {
    const body = {
      message: { data: 'base64', messageId: 'm-1' },
      subscription: 's',
    };
    const res = await controller.google(body);
    expect(service.handleGoogle).toHaveBeenCalledWith(body);
    expect(res.status).toBe('processed');
  });

  it('propagates errors thrown by the service (e.g. bad signature)', async () => {
    service.handleApple.mockRejectedValue(new Error('bad signature'));
    await expect(controller.apple({ signedPayload: 'x' })).rejects.toThrow(
      'bad signature',
    );
  });
});
