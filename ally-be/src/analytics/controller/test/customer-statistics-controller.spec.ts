import { FEATURE_TOGGLE_KEY } from '../../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../../authorization/constants/admin-feature-toggle.constants';
import { STAFF_ONLY_OPTIONS_KEY } from '../../../auth/guards/staff-only.guard';
import { PLATFORM_ADMIN_ONLY_KEY } from '../../../auth/decorators/platform-admin-only.decorator';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { CustomerStatisticsController } from '../customer-statistics.controller';

describe('CustomerStatisticsController', () => {
  const service = { getOverview: jest.fn(), recordContact: jest.fn() };
  const controller = new CustomerStatisticsController(service as never);

  afterEach(() => jest.restoreAllMocks());

  it('is for Ally staff only, for every route: anyone else gets 404', () => {
    expect(
      Reflect.getMetadata(STAFF_ONLY_OPTIONS_KEY, CustomerStatisticsController),
    ).toBeDefined();
    expect(
      Reflect.getMetadata(
        PLATFORM_ADMIN_ONLY_KEY,
        CustomerStatisticsController,
      ),
    ).toBe(true);
  });

  it.each(['overview', 'outreach'] as const)(
    'needs the Analytics toggle on %s, so a narrow platform-admin login cannot reach it',
    (name) => {
      const options = Reflect.getMetadata(
        FEATURE_TOGGLE_KEY,
        CustomerStatisticsController.prototype[name],
      );
      expect(options?.featureKey).toBe(FeatureToggleKey.ANALYTICS);
    },
  );

  it('reads the overview for the signed-in user', async () => {
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(7 as never);
    service.getOverview.mockResolvedValue({ orgs: [] });
    expect(await controller.overview()).toEqual({ orgs: [] });
    expect(service.getOverview).toHaveBeenCalledWith(7);
  });

  it('records a contact as the signed-in user', async () => {
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(7 as never);
    await controller.outreach({ tenantId: 't1', note: 'Called' });
    expect(service.recordContact).toHaveBeenCalledWith(7, 't1', 'Called');
  });

  it('refuses a request with no signed-in user', async () => {
    jest
      .spyOn(ExecutionManager, 'getUserId')
      .mockReturnValue(undefined as never);
    await expect(controller.overview()).rejects.toThrow();
  });
});
