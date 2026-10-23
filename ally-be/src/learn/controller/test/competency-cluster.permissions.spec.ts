import { CompetencyController } from '../competency.controller';
import { CompetencyClusterController } from '../competency-cluster.controller';
import { PERMISSIONS_KEY } from 'src/auth/decorators/permissions.decorator';
import { FEATURE_TOGGLE_KEY } from 'src/auth/decorators/feature-toggle.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';

/**
 * Who reaches the competency endpoints is a product decision, so it is pinned
 * here rather than left to whoever next touches a decorator:
 *
 * - Every endpoint needs EDIT_SCENARIO (platform-tier only). An undecorated
 *   handler would be publicly reachable, so an empty gate is a failure.
 * - Reading competencies, their behaviours and clusters is part of authoring —
 *   the roleplay builder's mandatory competency picker and the course editor
 *   read them — so no toggle gates those reads.
 * - Managing clusters is managing the shared library: the Competencies toggle,
 *   on every cluster write. Competency writes check the same toggle inside the
 *   handler, because a custom (private, rubric-forked) competency is exempt;
 *   that rule is covered in competency.controller.spec.ts.
 *
 * Reads the guard metadata off each handler instead of booting Nest, so it
 * fails on the decorator itself the moment a gate drifts.
 */
describe('competency endpoint gates', () => {
  const gatesOf = (controller: new (...args: never[]) => object) => {
    const prototype = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .filter((name) => !name.startsWith('assert'))
      .map((name) => {
        const handler = prototype[name] as object;
        return {
          name,
          permissions: Reflect.getMetadata(PERMISSIONS_KEY, handler),
          featureToggle: Reflect.getMetadata(FEATURE_TOGGLE_KEY, handler),
        };
      });
  };

  const competencyGates = gatesOf(CompetencyController);
  const clusterGates = gatesOf(CompetencyClusterController);

  it('requires EDIT_SCENARIO on every competency and cluster endpoint', () => {
    expect(competencyGates.length).toBeGreaterThan(0);
    expect(clusterGates.length).toBeGreaterThan(0);
    for (const gate of [...competencyGates, ...clusterGates]) {
      expect({ name: gate.name, permissions: gate.permissions }).toEqual({
        name: gate.name,
        permissions: expect.objectContaining({
          permissions: [PERMISSIONS.EDIT_SCENARIO],
        }),
      });
    }
  });

  it('leaves every competency endpoint free of a route toggle (the handler decides)', () => {
    for (const gate of competencyGates) {
      expect({ name: gate.name, featureToggle: gate.featureToggle }).toEqual({
        name: gate.name,
        featureToggle: undefined,
      });
    }
  });

  it('opens the cluster list to authors and keeps every cluster write behind the Competencies toggle', () => {
    for (const gate of clusterGates) {
      const expected =
        gate.name === 'getClusters'
          ? undefined
          : expect.objectContaining({
              featureKey: FeatureToggleKey.COMPETENCIES,
            });
      expect({ name: gate.name, featureToggle: gate.featureToggle }).toEqual({
        name: gate.name,
        featureToggle: expected,
      });
    }
  });
});
