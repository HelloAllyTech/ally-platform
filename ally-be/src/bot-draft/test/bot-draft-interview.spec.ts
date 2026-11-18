import { BadRequestException } from '@nestjs/common';
import { BotDraftController } from '../controller/bot-draft.controller';
import { ONBOARDING_COPY } from '../copy/onboarding-copy';

jest.mock('../service/bot-draft-view', () => ({
  draftView: (draft: unknown) => draft,
}));

/** "Interview me": an empty draft that opens with the builder's first question. */
describe('starting a draft with the interview', () => {
  const draft = { id: 'draft-1', transcript: [] };
  const build = () => {
    const drafts = {
      create: jest.fn().mockResolvedValue(draft),
      appendTranscript: jest
        .fn()
        .mockResolvedValue({ ...draft, tag: 'withOwner' }),
      findById: jest.fn().mockResolvedValue(null),
    };
    const session = {
      learnFromDescription: jest.fn().mockResolvedValue(undefined),
    };
    const crawl = { start: jest.fn() };
    const controller = new BotDraftController(
      drafts as never,
      session as never,
      crawl as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { controller, drafts, session, crawl };
  };

  it('marks the draft and opens with the interview question, reading nothing', async () => {
    const { controller, drafts, session, crawl } = build();
    await controller.create({ interview: true });
    expect(drafts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        interview: true,
        website: null,
        description: null,
      }),
    );
    expect(drafts.appendTranscript).toHaveBeenCalledWith(draft, [
      { role: 'builder', text: ONBOARDING_COPY.interviewOpening },
    ]);
    expect(session.learnFromDescription).not.toHaveBeenCalled();
    expect(crawl.start).not.toHaveBeenCalled();
  });

  it('is not an interview when a description came with it', async () => {
    const { controller, drafts } = build();
    await controller.create({
      interview: true,
      description: 'We run a clinic.',
    });
    expect(drafts.create).toHaveBeenCalledWith(
      expect.objectContaining({ interview: false }),
    );
    expect(drafts.appendTranscript.mock.calls[0][1][0].text).toBe(
      ONBOARDING_COPY.opening,
    );
  });

  it('still refuses a start with nothing to go on', async () => {
    const { controller } = build();
    await expect(controller.create({})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
