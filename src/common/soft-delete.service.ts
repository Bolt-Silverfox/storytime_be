import { Injectable, Logger } from '@nestjs/common';
import PrismaService from '../prisma/prisma.service';

@Injectable()
export class SoftDeleteService {
  private readonly logger = new Logger(SoftDeleteService.name);
  private readonly UNDO_WINDOW_MS = 30 * 1000; // 30 seconds

  constructor(private readonly prisma: PrismaService) {}

  async softDelete(model: string, id: string): Promise<boolean> {
    try {
      const result = await (this.prisma as any)[model].update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      return !!result;
    } catch (error) {
      this.logger.error(`Soft delete failed for ${model} ${id}:`, error);
      return false;
    }
  }

  async undoSoftDelete(model: string, id: string): Promise<boolean> {
    try {
      const record = await (this.prisma as any)[model].findUnique({
        where: { id },
      });

      if (!record || !record.deletedAt) {
        return false;
      }

      const timeSinceDeletion = Date.now() - record.deletedAt.getTime();
      if (timeSinceDeletion > this.UNDO_WINDOW_MS) {
        return false;
      }

      const result = await (this.prisma as any)[model].update({
        where: { id },
        data: { deletedAt: null },
      });

      return !!result;
    } catch (error) {
      this.logger.error(`Undo soft delete failed for ${model} ${id}:`, error);
      return false;
    }
  }

  async permanentDelete(model: string, id: string): Promise<boolean> {
    try {
      const result = await (this.prisma as any)[model].delete({
        where: { id },
      });
      return !!result;
    } catch (error) {
      this.logger.error(`Permanent delete failed for ${model} ${id}:`, error);
      return false;
    }
  }

  isWithinUndoWindow(deletedAt: Date | null): boolean {
    if (!deletedAt) return false;
    return Date.now() - deletedAt.getTime() <= this.UNDO_WINDOW_MS;
  }
}