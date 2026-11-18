import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { ItemReleaseService } from './item-release.service';

/**
 * The quick half of release tracking: every 5 minutes, re-check waiting
 * release rows against the newest successful production releases.
 *
 * ally-be receives no GitHub webhooks, so "when a release workflow finishes"
 * is this poll; it costs nothing while nothing waits. The full pass (linking
 * pull requests and releasing opportunities) stays on the 15-minute
 * `roadmap-builder-shipped-reconcile` tick.
 */
@Injectable()
export class ItemReleaseSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly itemReleaseService: ItemReleaseService) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('5min', 'roadmap-item-release-watch', () =>
      this.itemReleaseService.watch(),
    );
  }
}
