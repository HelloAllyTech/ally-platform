import {ChatSummaryStatus} from '@/constants';
import type {CallLog, SimulationLog, LogItem} from '../types';

describe('CallLog types', () => {
  it('accepts minimal CallLog with optional fields', () => {
    const log: CallLog = {
      id: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      status: 'done',
      client: {name: 'A'},
    };
    expect(log.client.name).toBe('A');
  });

  it('SimulationLog shape can include scenario and counselor info', () => {
    const s: SimulationLog = {
      id: 2,
      startedAt: 't1',
      endedAt: 't2',
      status: 'ok',
      scenario: {createdAt: 'x', updatedAt: 'y', id: 1, title: 't', scenario: 's', description: 'd', coverImageUrl: 'u', status: 'active', prompt: {}, metadata: {}},
      counselor: {createdAt: 'x', updatedAt: 'y', tenantId: 't', id: 3, email: 'e', name: 'n', role: 'r', status: 's', username: 'u', metadata: {}, phone: 'p', externalId: null},
    };
    expect(s.scenario?.id).toBe(1);
  });

  it('LogItem allows summary details and status enum', () => {
    const li: LogItem = {
      id: 5,
      startedAt: 'a',
      endedAt: 'b',
      status: 'ok',
      client: {name: 'Bob'},
      summaryStatus: ChatSummaryStatus.SUCCESS as any,
      details: {summary: {callQuality: 5, tags: [{tag: 't', positivity_rating: 1}]}, chatId: 10, createdAt: 'c', callInfo: {summaryName: 'name'}},
    };
    expect(li.details?.chatId).toBe(10);
  });
});


