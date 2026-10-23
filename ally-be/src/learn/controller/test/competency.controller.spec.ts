import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CompetencyController } from '../competency.controller';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { ErrorCode } from 'src/exception/error-code.enum';

/**
 * The shared competency library is managed by holders of the Competencies
 * toggle; a custom competency (the private copy a roleplay's rubric forks) is
 * part of authoring and needs only the route's EDIT_SCENARIO. See the class
 * comment on CompetencyController, and competency-cluster.permissions.spec.ts
 * for the route gates.
 */
describe('CompetencyController — shared library vs custom competencies', () => {
  const user = { id: 7 } as any;
  const SHARED = { id: 'shared-1', isCustom: false };
  const CUSTOM = { id: 'custom-1', isCustom: true };

  let holdsCompetenciesToggle: boolean;
  let competencyService: Record<string, jest.Mock>;
  let featureToggleService: { hasToggle: jest.Mock };
  let controller: CompetencyController;

  beforeEach(() => {
    holdsCompetenciesToggle = false;
    competencyService = {
      getCompetency: jest.fn(async (id: string) => {
        if (id === SHARED.id) return SHARED;
        if (id === CUSTOM.id) return CUSTOM;
        throw new NotFoundException(`Competency with id ${id} not found`);
      }),
      getCompetencies: jest.fn().mockResolvedValue({ data: [], count: 0 }),
      createCompetency: jest.fn().mockResolvedValue({ id: 'new' }),
      updateCompetency: jest.fn().mockResolvedValue({ id: 'x' }),
      deleteCompetency: jest.fn().mockResolvedValue(undefined),
      getCompetencyBehaviours: jest
        .fn()
        .mockResolvedValue({ helpful: [], unhelpful: [] }),
      setCompetencyBehaviours: jest
        .fn()
        .mockResolvedValue({ helpful: [], unhelpful: [] }),
    };
    featureToggleService = {
      hasToggle: jest.fn(
        async (_userId: number, key: string) =>
          key === FeatureToggleKey.COMPETENCIES && holdsCompetenciesToggle,
      ),
    };
    controller = new CompetencyController(
      competencyService as any,
      featureToggleService as any,
    );
  });

  const refusal = expect.objectContaining({
    response: expect.objectContaining({
      errorCode: ErrorCode.FEATURE_NOT_ENABLED,
      featureKey: FeatureToggleKey.COMPETENCIES,
    }),
  });

  it('lets an author without the toggle read the list and behaviours', async () => {
    await controller.getAllCompetencies(user);
    await controller.getCompetencyBehaviours(SHARED.id);

    expect(competencyService.getCompetencies).toHaveBeenCalled();
    expect(competencyService.getCompetencyBehaviours).toHaveBeenCalledWith(
      SHARED.id,
    );
    expect(featureToggleService.hasToggle).not.toHaveBeenCalled();
  });

  describe('without the Competencies toggle', () => {
    it('refuses to add to the shared library', async () => {
      await expect(
        controller.createCompetency(user, { name: 'Empathy' } as any),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.createCompetency(user, { name: 'Empathy' } as any),
      ).rejects.toEqual(refusal);
      expect(competencyService.createCompetency).not.toHaveBeenCalled();
    });

    it('refuses to rename, delete or re-map a shared competency', async () => {
      await expect(
        controller.updateCompetency(user, SHARED.id, { name: 'x' } as any),
      ).rejects.toEqual(refusal);
      await expect(
        controller.deleteCompetency(user, SHARED.id),
      ).rejects.toEqual(refusal);
      await expect(
        controller.setCompetencyBehaviours(user, SHARED.id, {} as any),
      ).rejects.toEqual(refusal);
      expect(competencyService.updateCompetency).not.toHaveBeenCalled();
      expect(competencyService.deleteCompetency).not.toHaveBeenCalled();
      expect(competencyService.setCompetencyBehaviours).not.toHaveBeenCalled();
    });

    it('lets the roleplay rubric fork and edit a custom competency', async () => {
      await controller.createCompetency(user, { isCustom: true } as any);
      await controller.setCompetencyBehaviours(user, CUSTOM.id, {} as any);
      await controller.updateCompetency(user, CUSTOM.id, { name: 'x' } as any);
      await controller.deleteCompetency(user, CUSTOM.id);

      expect(competencyService.createCompetency).toHaveBeenCalledWith(
        { isCustom: true },
        user.id,
      );
      expect(competencyService.setCompetencyBehaviours).toHaveBeenCalled();
      // Owner-only rename/delete stays the service's job.
      expect(competencyService.updateCompetency).toHaveBeenCalledWith(
        CUSTOM.id,
        { name: 'x' },
        user.id,
      );
      expect(competencyService.deleteCompetency).toHaveBeenCalledWith(
        CUSTOM.id,
        user.id,
      );
    });

    it('leaves an unknown id to the service, which answers 404', async () => {
      competencyService.deleteCompetency.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(controller.deleteCompetency(user, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('lets a holder of the toggle manage the shared library', async () => {
    holdsCompetenciesToggle = true;

    await controller.createCompetency(user, { name: 'Empathy' } as any);
    await controller.updateCompetency(user, SHARED.id, { name: 'x' } as any);
    await controller.setCompetencyBehaviours(user, SHARED.id, {} as any);
    await controller.deleteCompetency(user, SHARED.id);

    expect(competencyService.createCompetency).toHaveBeenCalled();
    expect(competencyService.updateCompetency).toHaveBeenCalled();
    expect(competencyService.setCompetencyBehaviours).toHaveBeenCalled();
    expect(competencyService.deleteCompetency).toHaveBeenCalled();
  });
});
