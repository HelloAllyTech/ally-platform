import { ConflictException } from '@nestjs/common';
import { BotDraftController } from '../controller/bot-draft.controller';
import { BotDraftStatus } from '../enum/bot-draft.enum';

/**
 * Stage 4 (D10): with the go-live gate on, publishing a draft is gated by the per-language crisis
 * check (inside `BotDraftPublishService.publish`) and nothing else; the owner's Check-up run stays
 * available but no longer blocks. With ASSISTANT_GO_LIVE_GATE_ENABLED=false the old checkup gate
 * (a finished run, safety questions passed, 70% of the rest) still applies.
 */
describe('POST /v1/bot-drafts/:id/publish and the go-live gate', () => {
  const draft = {
    id: 'draft-1',
    chatbotId: 'bot-1',
    status: BotDraftStatus.ACTIVE,
  };
  const dto = { access: 'invite' as const };
  const published = {
    chatbotId: 'bot-1',
    slug: 'sunrise',
    link: 'https://ally.example/b/sunrise',
    access: 'invite',
  };

  const build = (opts: {
    gateOn?: boolean;
    publishRejects?: unknown;
    noGate?: boolean;
  }) => {
    const drafts = { get: jest.fn().mockResolvedValue(draft) };
    const publisher = {
      publish: opts.publishRejects
        ? jest.fn().mockRejectedValue(opts.publishRejects)
        : jest.fn().mockResolvedValue(published),
    };
    const checkup = {
      assertCanPublish: jest.fn().mockRejectedValue(
        new ConflictException({
          errorCode: 'checkup_needed',
          message: 'Run the checkup before you publish.',
        }),
      ),
    };
    const checkupCases = {
      assertMustPassConfirmed: jest.fn().mockResolvedValue(undefined),
    };
    const workingCopy = { markLive: jest.fn().mockResolvedValue(undefined) };
    const goLive = { enforced: jest.fn(() => opts.gateOn ?? true) };
    const controller = new BotDraftController(
      drafts as never,
      {} as never,
      {} as never,
      publisher as never,
      {} as never,
      checkup as never,
      {} as never,
      checkupCases as never,
      undefined,
      undefined,
      undefined,
      workingCopy as never,
      opts.noGate ? undefined : (goLive as never),
    );
    return { controller, publisher, checkup, checkupCases, workingCopy };
  };

  it('goes live with a green gate and no checkup run', async () => {
    const h = build({ gateOn: true });
    await expect(h.controller.publish('draft-1', dto as never)).resolves.toBe(
      published,
    );
    expect(h.checkup.assertCanPublish).not.toHaveBeenCalled();
    expect(h.checkupCases.assertMustPassConfirmed).not.toHaveBeenCalled();
    expect(h.publisher.publish).toHaveBeenCalledWith(draft, dto);
    expect(h.workingCopy.markLive).toHaveBeenCalledWith('draft-1');
  });

  it('is refused when the gate is red, with its missing items and nothing marked live', async () => {
    const refusal = new ConflictException({
      errorCode: 'go_live_incomplete',
      details: { missing: [{ item: 'crisis_check' }] },
    });
    const h = build({ gateOn: true, publishRejects: refusal });
    await expect(h.controller.publish('draft-1', dto as never)).rejects.toBe(
      refusal,
    );
    expect(h.checkup.assertCanPublish).not.toHaveBeenCalled();
    expect(h.workingCopy.markLive).not.toHaveBeenCalled();
  });

  it('keeps the old checkup gate when the go-live gate is switched off', async () => {
    const h = build({ gateOn: false });
    await expect(
      h.controller.publish('draft-1', dto as never),
    ).rejects.toMatchObject({
      response: { errorCode: 'checkup_needed' },
    });
    expect(h.checkupCases.assertMustPassConfirmed).toHaveBeenCalled();
    expect(h.checkup.assertCanPublish).toHaveBeenCalledWith(draft, false);
    expect(h.publisher.publish).not.toHaveBeenCalled();
  });

  it('keeps the old checkup gate where the gate service is absent', async () => {
    const h = build({ noGate: true });
    await expect(
      h.controller.publish('draft-1', dto as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.checkup.assertCanPublish).toHaveBeenCalled();
  });
});
