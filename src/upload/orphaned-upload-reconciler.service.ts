import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaService } from '@/prisma/prisma.service';
import {
  PENDING_UPLOAD_TAG,
  RESERVATION_CONTEXT_KEY,
  STALE_RESERVATION_MS,
  UploadService,
  describeError,
} from './upload.service';

const RESOURCE_TYPES = ['image', 'video', 'raw'] as const;
const MIN_ASSET_AGE_MS = 2 * STALE_RESERVATION_MS;
const PAGE_SIZE = 500;

type Outcome = 'destroyed' | 'cleared' | 'kept';

export type ReconcileSummary = Record<Outcome | 'failed', number>;

interface TaggedAsset {
  public_id: string;
  resource_type: string;
  created_at: string;
  context?: { custom?: Record<string, string> };
}

@Injectable()
export class OrphanedUploadReconciler {
  private readonly logger = new Logger(OrphanedUploadReconciler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'orphanedUploadReconcile' })
  async reconcileOnSchedule(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      this.logger.error(
        `Orphaned upload reconciliation failed: ${describeError(error)}`,
      );
    }
  }

  async reconcile(now = Date.now()): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = {
      destroyed: 0,
      cleared: 0,
      kept: 0,
      failed: 0,
    };
    for (const resourceType of RESOURCE_TYPES) {
      for (const asset of await this.listPending(resourceType)) {
        if (now - Date.parse(asset.created_at) < MIN_ASSET_AGE_MS) continue;
        try {
          summary[await this.settle(asset)]++;
        } catch (error) {
          summary.failed++;
          this.logger.error(
            `Could not reconcile asset "${asset.public_id}": ${describeError(error)}`,
          );
        }
      }
    }
    if (summary.destroyed + summary.cleared + summary.kept + summary.failed) {
      this.logger.log(
        `Orphaned upload reconciliation: ${JSON.stringify(summary)}`,
      );
    }
    return summary;
  }

  private async listPending(resourceType: string): Promise<TaggedAsset[]> {
    const assets: TaggedAsset[] = [];
    let cursor: string | undefined;
    try {
      do {
        const page = (await cloudinary.api.resources_by_tag(
          PENDING_UPLOAD_TAG,
          {
            resource_type: resourceType,
            context: true,
            max_results: PAGE_SIZE,
            next_cursor: cursor,
          },
        )) as { resources: TaggedAsset[]; next_cursor?: string };
        assets.push(...page.resources);
        cursor = page.next_cursor;
      } while (cursor);
    } catch (error) {
      this.logger.error(
        `Could not list pending ${resourceType} assets: ${describeError(error)}`,
      );
    }
    return assets;
  }

  private async settle(asset: TaggedAsset): Promise<Outcome> {
    const publicId = asset.public_id;
    const reservationId = asset.context?.custom?.[RESERVATION_CONTEXT_KEY];
    if (reservationId) {
      await this.prisma.userUpload.deleteMany({
        where: { id: reservationId, pending: true },
      });
    }
    const recorded = await this.prisma.userUpload.findFirst({
      where: { publicId, pending: false },
      select: { id: true },
    });
    if (recorded) {
      await cloudinary.uploader.remove_tag(PENDING_UPLOAD_TAG, [publicId], {
        resource_type: asset.resource_type,
      });
      return 'cleared';
    }
    if (await this.uploads.isInUse(publicId)) {
      this.logger.warn(
        `Unrecorded asset "${publicId}" is still in use; not destroying it`,
      );
      return 'kept';
    }
    const { result } = (await cloudinary.uploader.destroy(publicId, {
      resource_type: asset.resource_type,
    })) as { result?: string };
    if (result !== 'ok' && result !== 'not found') {
      throw new Error(`Cloudinary answered "${result}" to the destroy`);
    }
    return 'destroyed';
  }
}
