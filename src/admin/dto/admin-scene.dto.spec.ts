import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApproveSceneDto, RejectSceneDto } from './admin-scene.dto';

describe('scene review DTOs require the image the reviewer saw', () => {
  it('approve rejects a missing/empty imageUrl', async () => {
    expect(
      await validate(plainToInstance(ApproveSceneDto, {})),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(ApproveSceneDto, { imageUrl: '' })),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(ApproveSceneDto, { imageUrl: 'u' })),
    ).toHaveLength(0);
  });

  it('reject requires both reason and imageUrl', async () => {
    expect(
      await validate(plainToInstance(RejectSceneDto, { reason: 'r' })),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(RejectSceneDto, { reason: 'r', imageUrl: 'u' }),
      ),
    ).toHaveLength(0);
  });
});
