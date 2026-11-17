import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { RoadmapBuilderService } from './roadmap-builder.service';

/**
 * Keeps the board honest about work Builder has finished.
 *
 * An opportunity handed to Builder used to sit at whatever stage it was in
 * while the build ran, merged and deployed — so the roadmap said `new` about
 * something already live in production, and a person had to notice and move it
 * by hand. `openSession` now marks the start; this marks the finish.
 *
 * Every 15 minutes rather than every 5: this is the full release-tracking
 * pass (ItemReleaseService.reconcile — linking pull requests, reading their
 * files, comparing against releases). The 5-minute slot carries only its quick
 * re-check of waiting rows (ItemReleaseSchedulerRegistrationService), so a
 * finished release still shows within minutes.
 */
@Injectable()
export class RoadmapBuilderSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly builderService: RoadmapBuilderService) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '15min',
      'roadmap-builder-shipped-reconcile',
      () => this.builderService.reconcileShippedOpportunities(),
    );
  }
}
