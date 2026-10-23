import { InjectionToken, ValueProvider } from '@nestjs/common';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';

/**
 * What a TestingModule needs to resolve FeatureToggleGuard on a controller
 * whose subject is something else. Grants every toggle; the gates themselves
 * are pinned in admin-tab-toggle-gates.spec.ts and the guard's own spec.
 * Pass `omit` for a token the spec already provides for real.
 */
export const featureToggleGuardProviders = (
  omit: InjectionToken[] = [],
): ValueProvider[] =>
  (
    [
      {
        provide: FeatureToggleService,
        useValue: {
          hasToggle: jest.fn().mockResolvedValue(true),
          isWithheld: jest.fn().mockResolvedValue(false),
          isLimitedToOrgScopedRoutes: jest.fn().mockResolvedValue(false),
        },
      },
      {
        provide: TenantFeatureService,
        useValue: { isEnabledForTenant: jest.fn().mockResolvedValue(false) },
      },
      { provide: TenantScopeService, useValue: {} },
    ] as ValueProvider[]
  ).filter(({ provide }) => !omit.includes(provide));
