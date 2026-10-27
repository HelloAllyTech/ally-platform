import {
  OPENAI_TRACK_CONTENT_TRANSLATION,
  renderPrompt,
} from 'src/prompt/contracts';
import { shippedPromptDefault } from 'src/common/util/prompt-template.util';
import { expectWorkingBase } from 'src/prompt/contracts/test/shipped-prompt-base';

/**
 * The course-content translation prompt lives in the Skills Store; its default
 * is a minimal base. It must still use every variable (the fill-blank marker
 * as `<blankToken>`), name each field kind the payload carries, and ask for a
 * JSON object keyed like the input.
 */
const INPUTS = {
  languageName: 'Hindi',
  toneGuidance: 'Warm, plain Hindi.',
  glossary: 'counsellor → परामर्शदाता',
  blankToken: '{{blankId}}',
  inputJson: JSON.stringify([{ key: 'f1', kind: 'TITLE', text: 'Hello' }]),
};

describe('openai_track_content_translation', () => {
  it('ships a working base', async () => {
    await expectWorkingBase(OPENAI_TRACK_CONTENT_TRANSLATION, [
      'TITLE',
      'DESCRIPTION',
      'HTML',
      'BLANK_TEMPLATE',
      'SHORT_ANSWER',
      'RUBRIC',
      'SPEAKER',
      '"context"',
      'JSON object',
    ]);
  });

  it('renders the call site inputs, the fill-blank marker as the literal placeholder', () => {
    const rendered = renderPrompt(
      OPENAI_TRACK_CONTENT_TRANSLATION,
      shippedPromptDefault(OPENAI_TRACK_CONTENT_TRANSLATION.code)!,
      INPUTS,
    );
    expect(rendered).toContain('placeholder of the form {{blankId}}');
    expect(rendered).toContain('Hindi');
    expect(rendered).toContain('Warm, plain Hindi.');
    expect(rendered).toContain('counsellor → परामर्शदाता');
    expect(rendered).toContain(INPUTS.inputJson);
  });
});
