import { Readable } from 'stream';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { AppConfigService } from '../../../config/config.service';
import { ErrorCode } from '../../../exception/error-code.enum';
import { LoggerService } from '../../../logger/logger.service';
import { PromptSharedService } from '../../../prompt/service/prompt-shared.service';
import { SkillExperimentRouterService } from '../../../skill-experiment/service/skill-experiment-router.service';
import { AiUpstreamError } from '../../exception/ai-upstream.exception';
import { AiService } from '../ai.service';

jest.mock('axios');
const mockedAxios = axios as unknown as jest.Mock;

const sse = (...events: [string, unknown][]) =>
  events.map(
    ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );

/** ally-ai's stream, cut into uneven chunks the way a socket delivers it. */
const body = (text: string[]) =>
  Readable.from(
    text
      .join(': ping\n\n')
      .match(/[\s\S]{1,7}/g)!
      .map((part) => Buffer.from(part)),
  );

describe('AiService.runAgentStreaming', () => {
  let service: AiService;

  beforeEach(async () => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as never);
    const module = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: AppConfigService,
          useValue: { ai: { apiUrl: 'https://ai', outboundApiKey: 'key' } },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: PromptSharedService, useValue: {} },
        { provide: SkillExperimentRouterService, useValue: {} },
      ],
    }).compile();
    service = module.get(AiService);
  });

  afterEach(() => jest.clearAllMocks());

  it('relays the live events and returns final', async () => {
    const final = { intent: 'answer', answer: 'Hi', run_id: 'r' };
    mockedAxios.mockResolvedValue({
      data: body(
        sse(
          ['run_started', { run_id: 'r' }],
          ['status', { code: 'thinking', label: 'Thinking…' }],
          ['token', { text: 'Hi' }],
          ['final', final],
        ),
      ),
    });
    const seen: unknown[] = [];

    const result = await service.runAgentStreaming(
      { question: 'q' } as never,
      (event) => seen.push(event),
    );

    expect(result).toEqual(final);
    expect(seen).toEqual([
      { event: 'run_started', data: { run_id: 'r' } },
      { event: 'status', data: { code: 'thinking', label: 'Thinking…' } },
      { event: 'token', data: { text: 'Hi' } },
    ]);
    const request = mockedAxios.mock.calls[0][0];
    expect(request.url).toBe('https://ai/api/v1/agent/run/stream');
    expect(request.responseType).toBe('stream');
    expect(request.headers['x-api-key']).toBe('key');
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns ally-ai's timeout into a timeout failure", async () => {
    mockedAxios.mockResolvedValue({
      data: body(
        sse(['run_started', { run_id: 'r' }], ['error', { code: 'timeout' }]),
      ),
    });

    const failure = service.runAgentStreaming({} as never, jest.fn());

    await expect(failure).rejects.toBeInstanceOf(AiUpstreamError);
    await expect(failure).rejects.toMatchObject({
      errorCode: ErrorCode.AI_SERVICE_TIMEOUT,
    });
  });

  it('fails as a 502 on any other error, or a stream without final', async () => {
    mockedAxios.mockResolvedValueOnce({
      data: body(sse(['error', { code: 'upstream' }])),
    });
    await expect(
      service.runAgentStreaming({} as never, jest.fn()),
    ).rejects.toMatchObject({ upstreamStatus: 502 });

    mockedAxios.mockResolvedValueOnce({
      data: body(sse(['run_started', { run_id: 'r' }])),
    });
    await expect(
      service.runAgentStreaming({} as never, jest.fn()),
    ).rejects.toMatchObject({ upstreamStatus: 502 });
  });

  it('classifies a refused request like runAgent (404 while the runtime is off)', async () => {
    mockedAxios.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 404 },
      }),
    );

    await expect(
      service.runAgentStreaming({} as never, jest.fn()),
    ).rejects.toMatchObject({ upstreamStatus: 404 });
  });
});
