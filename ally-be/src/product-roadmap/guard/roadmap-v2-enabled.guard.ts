import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

import { ReleasePolicySettingsService } from '../service/release-policy-settings.service';

/**
 * 404 for everyone, signed in or not, while `roadmap_v2` is off: the route
 * does not exist until the cutover. Applied at controller level, so it runs
 * before the JWT and toggle guards on each route.
 *
 * Turning the flag off is no longer a rollback: the old Product Roadmap routes and page are
 * gone, so every Roadmap route simply 404s until it is switched back on.
 *
 * TODO(P0): swap the settings read for P0's own flag guard once it is merged.
 */
@Injectable()
export class RoadmapV2EnabledGuard implements CanActivate {
  constructor(private readonly settings: ReleasePolicySettingsService) {}

  async canActivate(): Promise<boolean> {
    if (await this.settings.isRoadmapV2Enabled()) return true;
    throw new NotFoundException();
  }
}
