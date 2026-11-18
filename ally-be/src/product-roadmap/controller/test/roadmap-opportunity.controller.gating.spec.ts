import { Reflector } from '@nestjs/core';

import { RoadmapOpportunityController } from '../roadmap-opportunity.controller';
import { PERMISSIONS_KEY } from 'src/auth/decorators/permissions.decorator';
import { FEATURE_TOGGLE_KEY } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

/**
 * The filing door, asserted as decorator metadata (the pattern of
 * bug-hunter.controller.gating.spec.ts: the service specs instantiate things
 * directly, so guards never run there, and the gate lives only in decorators).
 *
 * `create` is the interview's door and sits on the VOTE tier with no toggle. It is the only
 * route that files onto the board: there is no door that skips the readiness gate.
 */
describe('RoadmapOpportunityController — filing route gating', () => {
  const reflector = new Reflector();
  const prototype = RoadmapOpportunityController.prototype as unknown as Record<
    string,
    () => unknown
  >;

  const gateOf = (name: string) => {
    const handler = prototype[name];
    return {
      path: reflector.get<string>('path', handler),
      permissions: reflector.get<{ permissions: string[]; operator: string }>(
        PERMISSIONS_KEY,
        handler,
      ),
      toggle: reflector.get<{ featureKey: string }>(
        FEATURE_TOGGLE_KEY,
        handler,
      ),
    };
  };

  it('create (the interview) is VOTE-tier behind only the tab toggle', () => {
    const { path, permissions, toggle } = gateOf('create');
    expect(path).toBe('opportunities');
    expect(permissions?.permissions).toEqual([
      PERMISSIONS.VOTE_PRODUCT_ROADMAP,
    ]);
    // The Product Roadmap tab's own toggle, ON by default for every platform
    // admin — not a filing tier. The interview stays the door for everyone
    // who has the tab.
    expect(toggle?.featureKey).toBe(FeatureToggleKey.PRODUCT_ROADMAP);
  });
});
