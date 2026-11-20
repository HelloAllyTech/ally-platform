import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FEATURE_TOGGLE_KEY } from 'src/auth/decorators/feature-toggle.decorator';
import { PERMISSIONS_KEY } from 'src/auth/decorators/permissions.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { RoadmapV2EnabledGuard } from '../../guard/roadmap-v2-enabled.guard';
import { RoadmapCutoverController } from '../roadmap-cutover.controller';

const user = { id: 1 } as any;
const proto = RoadmapCutoverController.prototype;

describe('RoadmapCutoverController', () => {
  it.each(['preview', 'run'] as const)(
    '%s sits behind the Manage toggle and its permission (the Owner’s own grant)',
    (handler) => {
      expect(
        Reflect.getMetadata(FEATURE_TOGGLE_KEY, proto[handler]),
      ).toMatchObject({
        featureKey: FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
      });
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[handler])).toEqual({
        permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
        operator: 'AND',
      });
    },
  );

  it('answers while roadmap_v2 is off: no flag guard on the controller or its routes', () => {
    const guards = [
      ...(Reflect.getMetadata(GUARDS_METADATA, RoadmapCutoverController) ?? []),
      ...(Reflect.getMetadata(GUARDS_METADATA, proto.preview) ?? []),
      ...(Reflect.getMetadata(GUARDS_METADATA, proto.run) ?? []),
    ];
    expect(guards).not.toContain(RoadmapV2EnabledGuard);
  });

  it('hands the caller to the service, which decides who is an Owner', async () => {
    const cutover = {
      preview: jest.fn(async () => ({ roadmapV2Enabled: false })),
      run: jest.fn(async () => ({ roadmapV2Enabled: true })),
    };
    const controller = new RoadmapCutoverController(cutover as never);
    await controller.preview(user);
    const body = { confirmedBuilderIds: [3], confirmedOwnerIds: [1] };
    await controller.run(body, user);
    expect(cutover.preview).toHaveBeenCalledWith(1);
    expect(cutover.run).toHaveBeenCalledWith(1, body);
  });
});
