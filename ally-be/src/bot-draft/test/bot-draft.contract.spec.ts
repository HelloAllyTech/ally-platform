import { readFileSync } from 'fs';
import { join } from 'path';
import { BotDraftService } from '../service/bot-draft.service';
import type { BotDraft } from '../type/bot-draft.type';

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'bot-draft.contract.json'), 'utf8'),
) as BotDraft;

/**
 * The draft as ally-ai's builder reads it (`ally-ai/app/schemas/builder.py`). The same fixture is
 * read by `ally-ai/tests/core/builder/test_contract.py`, so a field added on one side only fails
 * a test on that side.
 */
describe('BotDraft contract', () => {
  it('has the same fields as the default draft', () => {
    const draft = BotDraftService.defaultDraft('x');
    expect(Object.keys(fixture).sort()).toEqual(Object.keys(draft).sort());
    expect(Object.keys(fixture.branding).sort()).toEqual(
      Object.keys(draft.branding).sort(),
    );
    expect(Object.keys(fixture.access).sort()).toEqual(
      Object.keys(draft.access).sort(),
    );
  });

  it('passes the draft validation', () => {
    expect(() => BotDraftService.validateDraft(fixture)).not.toThrow();
  });
});
