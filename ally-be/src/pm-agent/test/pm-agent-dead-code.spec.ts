import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppConfigService } from 'src/config/config.service';
import { PmAgentDeadCodeController } from '../controller/pm-agent-dead-code.controller';
import { PmAgentDeadCodeService } from '../service/pm-agent-dead-code.service';
import { PmAgentSignalRepository } from '../repository/pm-agent.repositories';
import { DEAD_CODE_SIGNAL_SOURCE } from '../constants/pm-agent.constants';

const group = (key: string, count = 3) => ({
  key,
  repo: 'ally-ai',
  count,
  kinds: { function: count },
  items: ['function foo (ally-ai/app/x.py)'],
});

/**
 * The dead-code door: only the platform key gets in, a bad body is refused, and the report is
 * stored as `dead_code` evidence rows (one per module, refreshed in place). Nothing here
 * files a ticket: that is the PM Agent's call, and an admin's accept.
 */
describe('dead-code signals', () => {
  describe('PmAgentDeadCodeService', () => {
    it('writes one dead_code row per module and counts new vs refreshed', async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce([{ inserted: true }])
        .mockResolvedValueOnce([{ inserted: false }]);
      const service = new PmAgentDeadCodeService({
        query,
      } as unknown as PmAgentSignalRepository);

      const out = await service.ingest([
        group('ally-ai/app/a'),
        group('ally-ai/app/b', 1),
      ]);

      expect(out).toEqual({ received: 2, created: 1, refreshed: 1 });
      expect(query).toHaveBeenCalledTimes(2);
      const [sql, args] = query.mock.calls[0];
      expect(sql).toContain('ON CONFLICT ("source", "key")');
      // A refresh must never reset a decision the agent or an admin already made.
      expect(sql).not.toMatch(/"status"\s*=/);
      expect(args[0]).toBe(DEAD_CODE_SIGNAL_SOURCE);
      expect(args[2]).toBe('ally-ai/app/a');
      expect(args[3]).toBe('3 unused items in ally-ai/app/a');
      expect(query.mock.calls[1][1][3]).toBe('1 unused item in ally-ai/app/b');
    });
  });

  describe('PmAgentDeadCodeController', () => {
    let app: INestApplication;
    const ingest = jest.fn();

    beforeEach(async () => {
      ingest
        .mockReset()
        .mockResolvedValue({ received: 1, created: 1, refreshed: 0 });
      const moduleRef = await Test.createTestingModule({
        controllers: [PmAgentDeadCodeController],
        providers: [
          { provide: PmAgentDeadCodeService, useValue: { ingest } },
          { provide: AppConfigService, useValue: { apiKey: 'test-api-key' } },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          transform: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.init();
    });

    afterEach(() => app.close());

    const post = (key: string | null, body: unknown) => {
      const req = request(app.getHttpServer()).post(
        '/api/v1/pm-agent/signals/dead-code',
      );
      if (key) req.set('x-api-key', key);
      return req.send(body as object);
    };

    it('refuses a missing or wrong key and never reaches the service', async () => {
      await post(null, { groups: [group('a')] }).expect(401);
      await post('wrong', { groups: [group('a')] }).expect(401);
      expect(ingest).not.toHaveBeenCalled();
    });

    it('refuses a malformed body', async () => {
      await post('test-api-key', { groups: [{ key: 'a' }] }).expect(400);
      await post('test-api-key', {
        groups: [{ ...group('a'), count: 0 }],
      }).expect(400);
      expect(ingest).not.toHaveBeenCalled();
    });

    it('stores a valid report', async () => {
      const res = await post('test-api-key', {
        groups: [group('ally-ai/app/a')],
      }).expect(200);
      expect(res.body).toEqual({ received: 1, created: 1, refreshed: 0 });
      expect(ingest).toHaveBeenCalledWith([
        expect.objectContaining({ key: 'ally-ai/app/a' }),
      ]);
    });
  });
});
