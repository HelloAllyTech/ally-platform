import { FEATURE_TOGGLE_KEY } from 'src/auth/decorators/feature-toggle.decorator';
import {
  FEATURE_TOGGLES,
  FeatureToggleKey,
} from 'src/authorization/constants/admin-feature-toggle.constants';

import { CrmController } from '../crm.controller';

describe('CrmController', () => {
  const handlers = Object.getOwnPropertyNames(CrmController.prototype).filter(
    (name) => name !== 'constructor',
  );

  it('has routes to check', () => {
    expect(handlers.length).toBeGreaterThan(0);
  });

  it.each(handlers)('%s needs the Contacts toggle', (name) => {
    const fn = (CrmController.prototype as unknown as Record<string, object>)[
      name
    ];
    expect(Reflect.getMetadata(FEATURE_TOGGLE_KEY, fn)?.featureKey).toBe(
      FeatureToggleKey.CRM_CONTACTS,
    );
  });

  it('ships off: not on by default and limited to platform-wide admins', () => {
    const definition = FEATURE_TOGGLES.find(
      (t) => t.key === FeatureToggleKey.CRM_CONTACTS,
    );
    expect(definition).toBeDefined();
    expect(definition?.defaultEnabled).toBeUndefined();
    expect(definition?.platformOnly).toBe(true);
  });
});
