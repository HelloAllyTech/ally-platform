import { withoutStopLine } from '../bot-page-public.service';

/** TF1 P3: the bot page showed WhatsApp's "Reply STOP to opt out". */
describe('the page notice without the WhatsApp opt-out line', () => {
  it('drops it and keeps the rest', () => {
    expect(
      withoutStopLine(
        'This is an automated assistant that answers from our reference material. It is not medical advice and not a crisis service. Reply STOP to opt out.',
      ),
    ).toBe(
      'This is an automated assistant that answers from our reference material. It is not medical advice and not a crisis service.',
    );
  });

  it('leaves a notice without it as it is', () => {
    expect(withoutStopLine('Answers come from our handbook.')).toBe(
      'Answers come from our handbook.',
    );
  });
});
