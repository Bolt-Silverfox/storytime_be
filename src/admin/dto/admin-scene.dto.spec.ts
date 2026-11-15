import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ApproveSceneDto,
  RejectSceneDto,
  ReplaceScenesDto,
} from './admin-scene.dto';

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

  it('PUT body is capped at 100 scenes (bounds the single-transaction statement count)', async () => {
    const mk = (n: number) =>
      plainToInstance(ReplaceScenesDto, {
        scenes: Array.from({ length: n }, (_, i) => ({
          startPage: i,
          endPage: i,
        })),
      });
    expect(await validate(mk(100))).toHaveLength(0);
    expect(await validate(mk(101))).not.toHaveLength(0);
  });
});
