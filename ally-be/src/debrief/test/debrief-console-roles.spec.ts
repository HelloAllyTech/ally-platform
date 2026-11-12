import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { DebriefConsoleController } from '../controller/debrief-console.controller';
import { DebriefReviewController } from '../controller/debrief-review.controller';
import {
  canDecideFlag,
  debriefCan,
  debriefRoles,
} from '../util/debrief-console-roles.util';

/**
 * Who can act (debrief-console-redesign-notes.md): every console action is
 * enforced by PermissionsGuard with the action's permissions (OR). These run
 * the real guard against the real route metadata.
 */
const TEAM = [PERMISSIONS.SYSTEM_ACCESS];
const ADVISOR = [PERMISSIONS.REVIEW_DEBRIEFS];
const OWNER = [PERMISSIONS.MANAGE_DEBRIEF_SETTINGS];
const NOBODY = ['view:admin:analytics'];

function guardFor(perms: string[]) {
  return new PermissionsGuard(new Reflector(), {
    getUserPermissions: jest.fn(async () => perms),
  } as any);
}

function ctx(controller: any, handler: string): ExecutionContext {
  return {
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 1 }, method: 'POST', url: '/x' }),
    }),
  } as any;
}

async function allowed(perms: string[], controller: any, handler: string) {
  try {
    return await guardFor(perms).canActivate(ctx(controller, handler));
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

describe('Debrief console role gating', () => {
  it('comments: review rights (Ally team, clinical advisor, owner) only; anyone else gets 403', async () => {
    const C = DebriefConsoleController;
    expect(await allowed(TEAM, C, 'addComment')).toBe(true);
    expect(await allowed(ADVISOR, C, 'addComment')).toBe(true);
    expect(await allowed(OWNER, C, 'addComment')).toBe(true);
    await expect(
      guardFor(NOBODY).canActivate(ctx(C, 'addComment')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    for (const h of [
      'editComment',
      'deleteComment',
      'resolveComment',
      'reopenComment',
    ]) {
      expect(await allowed(NOBODY, C, h)).toBe(false);
    }
    // The old Expert review routes follow the same rule.
    expect(await allowed(NOBODY, DebriefReviewController, 'addComment')).toBe(
      false,
    );
    expect(await allowed(TEAM, DebriefReviewController, 'addComment')).toBe(
      true,
    );
  });

  it('held debriefs, escalation and the PM agent: Ally team or owner, never the advisor alone', async () => {
    const C = DebriefConsoleController;
    for (const h of [
      'publishRun',
      'escalateFlag',
      'approve',
      'buildTestSets',
      'rollback',
      'emergencyStop',
    ]) {
      expect(await allowed(TEAM, C, h)).toBe(true);
      expect(await allowed(OWNER, C, h)).toBe(true);
      expect(await allowed(ADVISOR, C, h)).toBe(false);
    }
  });

  it('owner settings, budgets and autonomy: the owner only', async () => {
    const C = DebriefConsoleController;
    for (const h of [
      'updateSettings',
      'acceptBaseline',
      'budgets',
      'setMatrix',
      'setOrgAutonomy',
    ]) {
      expect(await allowed(OWNER, C, h)).toBe(true);
      expect(await allowed(TEAM, C, h)).toBe(false);
      expect(await allowed(ADVISOR, C, h)).toBe(false);
    }
  });

  it('verdicts: the clinical advisor; pinned-rule sign-off: advisor or owner', async () => {
    expect(await allowed(ADVISOR, DebriefReviewController, 'verdict')).toBe(
      true,
    );
    expect(await allowed(TEAM, DebriefReviewController, 'verdict')).toBe(false);
    const C = DebriefConsoleController;
    expect(await allowed(ADVISOR, C, 'approvePinnedRule')).toBe(true);
    expect(await allowed(OWNER, C, 'approvePinnedRule')).toBe(true);
    expect(await allowed(TEAM, C, 'approvePinnedRule')).toBe(false);
  });

  it('flag decisions: the advisor reaches the route but decides only escalated flags', async () => {
    expect(
      await allowed(ADVISOR, DebriefConsoleController, 'resolveFlag'),
    ).toBe(true);
    const advisor = { roles: debriefRoles(ADVISOR, true) };
    const team = { roles: debriefRoles(TEAM) };
    expect(canDecideFlag(advisor, 'open')).toBe(false);
    expect(canDecideFlag(advisor, 'escalated')).toBe(true);
    expect(canDecideFlag(team, 'open')).toBe(true);
  });

  it('switching an organisation on is the owner’s; the Ally team only stops it', async () => {
    const view = {
      viewer: jest.fn(async () => ({ can: debriefCan(TEAM) })),
    };
    const agent = { setLive: jest.fn() };
    const controller = Object.create(DebriefConsoleController.prototype);
    Object.assign(controller, { view, agent });
    await expect(
      controller.setLive('t1', { live: true }, { user: { id: 1 } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(agent.setLive).not.toHaveBeenCalled();
    await controller.setLive('t1', { live: false }, { user: { id: 1 } });
    expect(agent.setLive).toHaveBeenCalledWith('t1', false, 1);
  });

  it('the can object mirrors the table', () => {
    expect(debriefCan(TEAM)).toMatchObject({
      comment: true,
      heldDebrief: true,
      verdict: false,
      approvePinnedRule: false,
      switchOrgOn: false,
      ownerSettings: false,
      emergencyStop: true,
    });
    expect(debriefCan(ADVISOR)).toMatchObject({
      comment: true,
      flagDecision: true,
      heldDebrief: false,
      verdict: true,
      score: true,
      approvePinnedRule: true,
      pmAgent: false,
    });
    // A platform admin also holds review:admin:debriefs by default, but
    // escalations are addressed only to the named advisor.
    expect(debriefRoles([...TEAM, ...ADVISOR]).receivesEscalations).toBe(false);
    expect(debriefRoles([...TEAM, ...ADVISOR], true).receivesEscalations).toBe(
      true,
    );
    expect(debriefRoles(ADVISOR).receivesEscalations).toBe(true);
  });

  it('proposals and releases: Ally team or owner; release settings and budget promotions: the owner', async () => {
    const C = DebriefConsoleController;
    for (const h of [
      'proposeChange',
      'editDraft',
      'promoteWaiting',
      'dismissWaiting',
    ]) {
      expect(await allowed(TEAM, C, h)).toBe(true);
      expect(await allowed(ADVISOR, C, h)).toBe(false);
    }
    const view = { viewer: jest.fn(async () => ({ can: debriefCan(TEAM) })) };
    const releaseHistory = { proposeChange: jest.fn() };
    const pmAgent = {
      getIdea: jest.fn(async () => ({
        change: { ideaKind: 'release', budgetOnly: true },
      })),
      approve: jest.fn(),
    };
    const controller = Object.create(DebriefConsoleController.prototype);
    Object.assign(controller, { view, releaseHistory, pmAgent });
    await expect(
      controller.proposeChange(
        { user: { id: 1 } },
        { title: 't', settings: { runCeilingUsd: 0.4 } },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await controller.proposeChange(
      { user: { id: 1 } },
      { title: 't', steps: [{ step: 'reviser', enabled: false }] },
    );
    expect(releaseHistory.proposeChange).toHaveBeenCalledTimes(1);
    await expect(
      controller.approve('i1', { user: { id: 1 } }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pmAgent.approve).not.toHaveBeenCalled();
  });
});
