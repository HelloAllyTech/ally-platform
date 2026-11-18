import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import {
  IMAGE_STUDIO_CLEANUP_BATCH,
  IMAGE_STUDIO_FAILED_MESSAGE,
  IMAGE_STUDIO_HEARTBEAT_MS,
  IMAGE_STUDIO_IDLE_POLL_MS,
  IMAGE_STUDIO_MAX_ATTEMPTS,
  IMAGE_STUDIO_RETENTION_DAYS,
  IMAGE_STUDIO_STALE_MS,
} from '../constants/image-studio.constants';
import {
  GeneratedImage,
  GeneratedImageStatus,
} from '../entity/generated-image.entity';
import { GeneratedImageRepository } from '../repository/generated-image.repository';
import { ImageAssetService } from './image-asset.service';
import { ImageRenderError, ImageRenderService } from './image-render.service';

/**
 * Runs queued images on every API task. A job is a row: claimed with
 * `FOR UPDATE SKIP LOCKED`, kept alive by a heartbeat, and settled with a
 * conditional update — the shape Course Copilot's build uses, so a deploy
 * mid-image loses nothing. The 5-minute reconcile requeues a run whose
 * heartbeat stopped (two attempts) and the daily cleanup removes the files of
 * images nobody accepted or uses.
 */
@Injectable()
export class ImageStudioWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    ImageStudioWorkerService.name,
  );
  private readonly active = new Map<string, Promise<void>>();
  private loop?: Promise<void>;
  private stopping = false;
  private wake?: () => void;

  constructor(
    private readonly configService: AppConfigService,
    private readonly repository: GeneratedImageRepository,
    private readonly renderer: ImageRenderService,
    private readonly assets: ImageAssetService,
  ) {}

  onApplicationBootstrap(): void {
    scheduledTaskRegistry.register('5min', 'image-studio-reconcile', () =>
      this.reconcile(),
    );
    scheduledTaskRegistry.register('daily', 'image-studio-cleanup', () =>
      this.cleanup().then(() => undefined),
    );
    const config = this.configService.imageStudio;
    if (config.enabled && config.workerEnabled) {
      this.loop = this.run();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    await this.loop?.catch(() => undefined);
    await Promise.allSettled(this.active.values());
  }

  /** New work was queued in this process: skip the idle wait. */
  kick(): void {
    this.wake?.();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private async run(): Promise<void> {
    const concurrency = this.configService.imageStudio.workerConcurrency;
    while (!this.stopping) {
      try {
        if (this.active.size < concurrency) {
          const row = await this.repository.claimNext();
          if (row) {
            const job = this.process(row).finally(() =>
              this.active.delete(row.id),
            );
            this.active.set(row.id, job);
            continue;
          }
        }
        await Promise.race([
          this.sleep(IMAGE_STUDIO_IDLE_POLL_MS),
          ...this.active.values(),
        ]);
      } catch (error) {
        this.logger.error(
          `[IMAGE_STUDIO] worker loop error: ${(error as Error)?.message ?? error}`,
        );
        await this.sleep(IMAGE_STUDIO_IDLE_POLL_MS * 5);
      }
    }
  }

  /** Run one claimed image to completion. Public for tests. */
  async process(row: GeneratedImage): Promise<void> {
    const heartbeat = setInterval(
      () => void this.repository.heartbeat(row.id).catch(() => undefined),
      IMAGE_STUDIO_HEARTBEAT_MS,
    );
    const startedAt = Date.now();
    try {
      const { patch } = await this.renderer.render(row);
      await this.repository.settle(
        row.id,
        GeneratedImageStatus.SUCCEEDED,
        patch,
      );
      this.logger.info(
        `[IMAGE_STUDIO] image=${row.id} slot=${row.slotKind} style=${row.styleId} provider=${patch.provider} model=${patch.model} check=${
          patch.check ? (patch.check.passed ? 'passed' : 'flagged') : 'skipped'
        } elapsedMs=${Date.now() - startedAt}`,
      );
    } catch (error) {
      const message =
        error instanceof ImageRenderError
          ? error.authorMessage
          : IMAGE_STUDIO_FAILED_MESSAGE;
      this.logger.error(
        `[IMAGE_STUDIO] image=${row.id} slot=${row.slotKind} failed after ${
          Date.now() - startedAt
        }ms: ${(error as Error)?.message ?? error}`,
      );
      await this.repository
        .settle(row.id, GeneratedImageStatus.FAILED, { error: message })
        .catch((settleError) =>
          this.logger.error(
            `[IMAGE_STUDIO] image=${row.id} could not record its failure: ${settleError}`,
          ),
        );
    } finally {
      clearInterval(heartbeat);
    }
  }

  async reconcile(): Promise<void> {
    const { requeued, failed } = await this.repository.reconcileStale(
      IMAGE_STUDIO_STALE_MS,
      IMAGE_STUDIO_MAX_ATTEMPTS,
      IMAGE_STUDIO_FAILED_MESSAGE,
    );
    if (requeued || failed) {
      this.logger.info(
        `[IMAGE_STUDIO] reconcile requeued=${requeued} failed=${failed}`,
      );
      this.kick();
    }
  }

  /**
   * Remove the files of images nobody accepted, nothing references and no
   * record shows, once they are past the retention window. The row stays
   * (status `expired`) as the audit and cost record.
   */
  async cleanup(): Promise<number> {
    const candidates = await this.repository.findExpiredCandidates(
      IMAGE_STUDIO_RETENTION_DAYS,
      IMAGE_STUDIO_CLEANUP_BATCH,
    );
    if (!candidates.length) return 0;
    const usedAsReference = await this.repository.idsUsedAsReference(
      candidates.map((candidate) => candidate.id),
    );
    let removed = 0;
    for (const image of candidates) {
      if (usedAsReference.has(image.id)) continue;
      if (image.imageUrl && (await this.assets.countUses(image.imageUrl)) > 0) {
        // In a form that was saved without the editor calling accept.
        await this.repository.update(image.id, { acceptedAt: new Date() });
        continue;
      }
      for (const key of [image.displayKey, image.originalKey]) {
        if (key) await this.assets.remove(key).catch(() => undefined);
      }
      await this.repository.update(image.id, {
        status: GeneratedImageStatus.EXPIRED,
        displayKey: null,
        originalKey: null,
      });
      removed += 1;
    }
    this.logger.info(`[IMAGE_STUDIO] cleanup removed=${removed}`);
    return removed;
  }
}
