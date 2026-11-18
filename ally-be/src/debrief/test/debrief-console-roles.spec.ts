import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  CONSOLE_CONTROLLERS,
  consoleControllerOf,
} from './support/console-controllers';
import { DebriefConsolePmAgentController } from '../controller/debrief-console-pm-agent.controller';
import { DebriefConsoleTenantsController } from '../controller/debrief-console-tenants.controller';
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

/** Stands for 'the Console controller that serves this handler' (the API is split by area). */
const ANY_CONSOLE = {} as any;

function ctx(controller: any, handler: string): ExecutionContext {
  if (controller === ANY_CONSOLE) controller = consoleControllerOf(handler);
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
    const C = ANY_CONSOLE;
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
      'stillHappening',
    ]) {
      expect(await allowed(NOBODY, C, h)).toBe(false);
    }
    expect(await allowed(TEAM, C, 'stillHappening')).toBe(true);
    expect(await allowed(ADVISOR, C, 'stillHappening')).toBe(true);
  });

  it('held debriefs, escalation and the Debrief PM agent: Ally team or owner, never the advisor alone', async () => {
    const C = ANY_CONSOLE;
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
    const C = ANY_CONSOLE;
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

  it('verdicts: the clinical advisor; pinned rules have no console routes any more', async () => {
    expect(await allowed(ADVISOR, DebriefReviewController, 'verdict')).toBe(
      true,
    );
    expect(await allowed(TEAM, DebriefReviewController, 'verdict')).toBe(false);
    const protos = CONSOLE_CONTROLLERS.map(
      (c) => c.prototype as unknown as Record<string, unknown>,
    );
    // Pinned rules are Skills Store prompts for the named pinned editors: nothing to approve here.
    for (const h of [
      'approvePinnedRule',
      'withdrawPinnedRule',
      'rejectPinnedRule',
      'proposePinnedRule',
    ]) {
      for (const proto of protos) expect(proto[h]).toBeUndefined();
    }
  });

  it('the clinical advisor needs only review:admin:debriefs, never system:access (PE-06, RA-15)', async () => {
    const C = ANY_CONSOLE;
    // Verdict, comments, Score by hand (item + save), escalated flags,
    // pinned-rule sign-off.
    expect(await allowed(ADVISOR, DebriefReviewController, 'verdict')).toBe(
      true,
    );
    for (const h of [
      'addComment',
      'editComment',
      'resolveComment',
      'resolveFlag',
    ]) {
      expect(await allowed(ADVISOR, C, h)).toBe(true);
    }
    // Score by hand is gone (2026-11-12): no route left for anyone.
    for (const c of CONSOLE_CONTROLLERS) {
      expect(
        (c.prototype as unknown as Record<string, unknown>).score,
      ).toBeUndefined();
    }
    // The team's own actions stay on system:access.
    for (const h of ['publishRun', 'escalateFlag', 'proposeChange']) {
      expect(await allowed(ADVISOR, C, h)).toBe(false);
      expect(await allowed(TEAM, C, h)).toBe(true);
    }
  });

  it('flag decisions: the advisor reaches the route but decides only escalated flags', async () => {
    expect(await allowed(ADVISOR, ANY_CONSOLE, 'resolveFlag')).toBe(true);
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
    const controller = Object.create(DebriefConsoleTenantsController.prototype);
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
      switchOrgOn: false,
      ownerSettings: false,
      emergencyStop: true,
    });
    expect(debriefCan(ADVISOR)).toMatchObject({
      comment: true,
      flagDecision: true,
      heldDebrief: false,
      verdict: true,
      pmAgent: false,
      releases: false,
      ownerSettings: false,
    });
    // A team member granted review:admin:debriefs by hand: escalations are
    // addressed only to the named advisor.
    expect(debriefRoles([...TEAM, ...ADVISOR]).receivesEscalations).toBe(false);
    expect(debriefRoles([...TEAM, ...ADVISOR], true).receivesEscalations).toBe(
      true,
    );
    expect(debriefRoles(ADVISOR).receivesEscalations).toBe(true);
  });

  it('proposals and releases: Ally team or owner; release settings and budget promotions: the owner', async () => {
    const C = ANY_CONSOLE;
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
    const controller = Object.create(DebriefConsolePmAgentController.prototype);
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
