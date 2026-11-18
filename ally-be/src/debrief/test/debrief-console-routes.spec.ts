import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { DebriefConsoleReleasesController } from '../controller/debrief-console-releases.controller';
import { DebriefConsolePmAgentController } from '../controller/debrief-console-pm-agent.controller';
import { DebriefConsoleReviewController } from '../controller/debrief-console-review.controller';
import { DebriefConsoleSettingsController } from '../controller/debrief-console-settings.controller';
import { DebriefConsoleTenantsController } from '../controller/debrief-console-tenants.controller';
import { DebriefConsoleViewController } from '../controller/debrief-console-view.controller';

/**
 * The Console API used to be one 1,551-line controller; it is split by area. This pins the whole
 * route table (method and path) as it was before the split, so a handler cannot be lost, renamed or
 * moved to another path by accident.
 */
const BEFORE_THE_SPLIT: Array<[string, string]> = [
  ['GET', 'v1/debriefs/console/analytics'],
  ['GET', 'v1/debriefs/console/attention'],
  ['GET', 'v1/debriefs/console/autonomy'],
  ['PUT', 'v1/debriefs/console/autonomy/matrix'],
  ['PUT', 'v1/debriefs/console/autonomy/orgs/:tenantId'],
  ['PUT', 'v1/debriefs/console/budgets'],
  ['DELETE', 'v1/debriefs/console/comments/:id'],
  ['PATCH', 'v1/debriefs/console/comments/:id'],
  ['POST', 'v1/debriefs/console/comments/:id/reopen'],
  ['POST', 'v1/debriefs/console/comments/:id/resolve'],
  ['POST', 'v1/debriefs/console/comments/:id/still-happening'],
  ['POST', 'v1/debriefs/console/flags/:id/escalate'],
  ['POST', 'v1/debriefs/console/flags/:id/resolve'],
  ['GET', 'v1/debriefs/console/guidance-metrics'],
  ['GET', 'v1/debriefs/console/me'],
  ['GET', 'v1/debriefs/console/metrics'],
  ['GET', 'v1/debriefs/console/metrics/nightly'],
  ['GET', 'v1/debriefs/console/models'],
  ['GET', 'v1/debriefs/console/overview'],
  ['GET', 'v1/debriefs/console/pinned-rules'],
  ['GET', 'v1/debriefs/console/pm-agent'],
  ['POST', 'v1/debriefs/console/pm-agent/analyse'],
  ['GET', 'v1/debriefs/console/pm-agent/conversation'],
  ['POST', 'v1/debriefs/console/pm-agent/conversation'],
  ['POST', 'v1/debriefs/console/pm-agent/ideas/:id/approve'],
  ['GET', 'v1/debriefs/console/pm-agent/ideas/:id/builder'],
  ['POST', 'v1/debriefs/console/pm-agent/ideas/:id/builder/answer'],
  ['PATCH', 'v1/debriefs/console/pm-agent/ideas/:id/draft'],
  ['POST', 'v1/debriefs/console/pm-agent/ideas/:id/questions'],
  ['POST', 'v1/debriefs/console/pm-agent/ideas/:id/reject'],
  ['POST', 'v1/debriefs/console/pm-agent/ideas/:id/screen'],
  ['POST', 'v1/debriefs/console/pm-agent/ideas/:id/start-step'],
  ['POST', 'v1/debriefs/console/pm-agent/ideas/propose'],
  ['GET', 'v1/debriefs/console/pm-agent/reports'],
  ['GET', 'v1/debriefs/console/pm-agent/reports/:kind/:period'],
  ['GET', 'v1/debriefs/console/release-history'],
  ['GET', 'v1/debriefs/console/release-history/:id'],
  ['GET', 'v1/debriefs/console/releases/:id/compare'],
  ['POST', 'v1/debriefs/console/releases/:id/dismiss-waiting'],
  ['POST', 'v1/debriefs/console/releases/:id/promote-waiting'],
  ['POST', 'v1/debriefs/console/releases/:id/rollback'],
  ['POST', 'v1/debriefs/console/releases/orchestrator-challenger'],
  ['POST', 'v1/debriefs/console/runs/:id/comments'],
  ['POST', 'v1/debriefs/console/runs/:id/correct'],
  ['POST', 'v1/debriefs/console/runs/:id/escalate'],
  ['POST', 'v1/debriefs/console/runs/:id/publish'],
  ['POST', 'v1/debriefs/console/runs/:id/reviewed'],
  ['POST', 'v1/debriefs/console/runs/:id/todays-debrief'],
  ['GET', 'v1/debriefs/console/runs/:runId/logs'],
  ['GET', 'v1/debriefs/console/sessions'],
  ['POST', 'v1/debriefs/console/sessions/:sessionId/run'],
  ['GET', 'v1/debriefs/console/sessions/runs/:id'],
  ['GET', 'v1/debriefs/console/settings'],
  ['PUT', 'v1/debriefs/console/settings'],
  ['POST', 'v1/debriefs/console/settings/accept'],
  ['POST', 'v1/debriefs/console/settings/baseline'],
  ['GET', 'v1/debriefs/console/settings/clinical-lists'],
  ['PUT', 'v1/debriefs/console/settings/clinical-lists'],
  ['GET', 'v1/debriefs/console/tenants'],
  ['POST', 'v1/debriefs/console/tenants/:tenantId/emergency-stop'],
  ['PUT', 'v1/debriefs/console/tenants/:tenantId/live'],
  ['PUT', 'v1/debriefs/console/tenants/:tenantId/providers'],
  ['PUT', 'v1/debriefs/console/tenants/:tenantId/region'],
  ['POST', 'v1/debriefs/console/test-sets/build'],
];

const CONTROLLERS = [
  DebriefConsoleReviewController,
  DebriefConsoleViewController,
  DebriefConsoleSettingsController,
  DebriefConsoleTenantsController,
  DebriefConsolePmAgentController,
  DebriefConsoleReleasesController,
];

function routesOf(controller: { prototype: object }): Array<[string, string]> {
  const prefix = Reflect.getMetadata('path', controller) as string;
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((n) => n !== 'constructor')
    .flatMap((n) => {
      const handler = (controller.prototype as Record<string, unknown>)[n];
      if (typeof handler !== 'function') return [];
      const method = Reflect.getMetadata('method', handler as object);
      if (method === undefined) return [];
      const path = Reflect.getMetadata('path', handler as object) as string;
      return [[RequestMethod[method], `${prefix}/${path}`] as [string, string]];
    });
}

describe('the Debrief Console route table', () => {
  it('is exactly what the single console controller served before the split', () => {
    const now = CONTROLLERS.flatMap(routesOf).sort(
      (a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]),
    );
    expect(now).toEqual(BEFORE_THE_SPLIT);
  });

  it('serves each route once, and every controller keeps the same prefix, audit and docs decorators', () => {
    const all = CONTROLLERS.flatMap(routesOf).map((r) => r.join(' '));
    expect(new Set(all).size).toBe(all.length);
    for (const c of CONTROLLERS) {
      expect(Reflect.getMetadata('path', c)).toBe('v1/debriefs/console');
      expect(
        (Reflect.getMetadata('__interceptors__', c) ?? []).map(
          (i: { name: string }) => i.name,
        ),
      ).toEqual(['DebriefConsoleAuditInterceptor']);
    }
  });
});
