import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { ReleasePolicyService } from './release-policy.service';

/**
 * The auto-release policy's pass, every 5 minutes, in shadow mode: it plans,
 * observes and logs to `release_policy_log`, and dispatches nothing
 * (`policyMode`). Five minutes because the debounce is ten: a burst of merges
 * is seen settling within one or two passes.
 */
@Injectable()
export class ReleasePolicySchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly releasePolicyService: ReleasePolicyService) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '5min',
      'roadmap-release-policy-shadow',
      () => this.releasePolicyService.tick(),
    );
  }
}
