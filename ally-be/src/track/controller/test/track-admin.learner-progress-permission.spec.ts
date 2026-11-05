import { PERMISSIONS_KEY } from 'src/auth/decorators/permissions.decorator';
import {
  ADMIN_PERMISSIONS,
  PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
} from 'src/authorization/constants/permissions.constants';
import { TrackAdminController } from '../track-admin.controller';

/**
 * The learner-progress actions on the Org Metrics learner table (remove from a
 * course, reopen quiz/assessment attempts) are gated on their own permission so
 * a tenant ADMIN can hold them without holding `edit:user`, which also opens
 * user and role editing.
 */
describe('learner-progress admin routes', () => {
  const routes = [
    'listLearnerScenarioAttempts',
    'resetBranchingAttempts',
    'reopenRoleplayAssessment',
    'listLearnerEnrollments',
    'removeLearnerEnrollment',
  ] as const;

  it.each(routes)('%s requires edit:learner-progress only', (name) => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TrackAdminController.prototype[name],
    );
    expect(meta.permissions).toEqual([PERMISSIONS.EDIT_LEARNER_PROGRESS]);
  });

  it('is held by tenant ADMIN and platform admins', () => {
    expect(ADMIN_PERMISSIONS).toContain(PERMISSIONS.EDIT_LEARNER_PROGRESS);
    expect(SUPER_ADMIN_PERMISSIONS).toContain(
      PERMISSIONS.EDIT_LEARNER_PROGRESS,
    );
  });

  it('does not hand tenant ADMIN user or role editing', () => {
    expect(ADMIN_PERMISSIONS).not.toContain(PERMISSIONS.EDIT_USER);
    expect(ADMIN_PERMISSIONS).not.toContain(PERMISSIONS.EDIT_USER_ROLE);
  });
});
