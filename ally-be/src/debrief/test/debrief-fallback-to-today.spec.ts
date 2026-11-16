import { ScenarioSessionService } from '../../learn/service/scenario-session.service';
import { ExecutionManager } from '../../common/execution/execution-manager';

/**
 * The Debrief agent's fallback: the session service writes today's debrief
 * for a session of a switched-on organisation, which it skips at session end.
 */
describe("today's debrief as the Debrief agent's fallback", () => {
  const service = (row: Record<string, unknown> | null) => {
    const svc: any = Object.create(ScenarioSessionService.prototype);
    svc.dataSource = { query: jest.fn(async () => (row ? [row] : [])) };
    svc.caseSharedService = {
      getPreviousCaseMemory: jest.fn(async () => 'earlier memory'),
    };
    svc.logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    const seen: Array<string | undefined> = [];
    svc.getScenarioSessionSummaryFromAIOnce = jest.fn(async () => {
      seen.push(ExecutionManager.getTenantId());
    });
    return { svc, seen };
  };

  it('writes it even though the organisation is switched on, in the session’s tenant', async () => {
    const { svc, seen } = service({
      tenant_id: 't1',
      user_id: 7,
      case_item: null,
      call_duration: 95_000,
    });
    await svc.onDebriefFallbackToToday({ scenarioSessionId: 's1' });
    expect(svc.getScenarioSessionSummaryFromAIOnce).toHaveBeenCalledWith(
      's1',
      false,
      95_000,
      null,
      undefined,
      undefined,
      { evenIfDebriefAgentLive: true },
    );
    expect(seen).toEqual(['t1']);
  });

  it('carries a case session’s memory, as at session end', async () => {
    const { svc } = service({
      tenant_id: 't1',
      user_id: 7,
      case_item: 'ci-1',
      call_duration: null,
    });
    await svc.onDebriefFallbackToToday({ scenarioSessionId: 's1' });
    expect(svc.getScenarioSessionSummaryFromAIOnce).toHaveBeenCalledWith(
      's1',
      true,
      undefined,
      'earlier memory',
      undefined,
      undefined,
      { evenIfDebriefAgentLive: true },
    );
  });

  it('does nothing for a session that has not ended', async () => {
    const { svc } = service(null);
    await svc.onDebriefFallbackToToday({ scenarioSessionId: 's1' });
    expect(svc.getScenarioSessionSummaryFromAIOnce).not.toHaveBeenCalled();
  });
});
