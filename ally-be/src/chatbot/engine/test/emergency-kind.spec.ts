import {
  emergencyKindOf,
  emergencyReply,
} from '../../../bot-draft/safety-pack/safety-packs';
import { emergencyHoldingMessage } from '../../safety/crisis-copy';

/**
 * TF1 F19: a flood ("stuck on the roof with the children") and a collapse got "go to the nearest
 * emergency department", then the self-harm holding line. Approved wording (25 Nov): "the
 * safest, highest place" only for a flood or rising water; a fire or someone trapped gets "the
 * safest place".
 */
describe('the emergency reply fits the emergency', () => {
  it.each([
    [
      'We are stuck on the roof with the children, the water is rising',
      'flood',
    ],
    ['Paani ghar mein aa gaya, hum chhat par phanse hain, baadh hai', 'flood'],
    ['बाढ़ में फँस गए हैं', 'flood'],
    ['Our house is on fire and my father is trapped upstairs', 'rescue'],
    ['Lift mein phanse hain, bahar nahi nikal pa rahe', 'rescue'],
    ['Someone collapsed in the waiting room and is not breathing', 'collapse'],
    ['Ek aadmi behosh ho gaya', 'collapse'],
    ['I have severe chest pain', null],
  ])('%s → %s', (text, kind) => {
    expect(emergencyKindOf(text)).toBe(kind);
  });

  it('a fire or someone trapped: call 112, ask for rescue, the safest place', () => {
    expect(
      emergencyReply({ language: 'en', india: true, kind: 'rescue' }),
    ).toBe(
      'This sounds like an emergency. Call 112 now and ask for rescue. Get to the safest place you can and stay there until help reaches you.',
    );
    for (const language of ['en', 'hi', 'hi-latn'] as const) {
      for (const india of [true, false]) {
        const reply = emergencyReply({ language, india, kind: 'rescue' });
        expect(reply).not.toMatch(/highest|ऊँची|oonchi/);
        expect(reply).not.toMatch(/emergency department/);
      }
    }
  });

  it('a flood: the safest, highest place, in every language', () => {
    expect(
      emergencyReply({ language: 'en', india: true, kind: 'flood' }),
    ).toMatch(/safest, highest place/);
    expect(
      emergencyReply({ language: 'hi', india: true, kind: 'flood' }),
    ).toMatch(/ऊँची/);
    expect(
      emergencyReply({ language: 'hi-latn', india: false, kind: 'flood' }),
    ).toMatch(/oonchi/);
  });

  it('a collapse: an ambulance, and stay with them', () => {
    const reply = emergencyReply({
      language: 'en',
      india: true,
      kind: 'collapse',
    });
    expect(reply).toMatch(/112 or 108/);
    expect(reply).toMatch(/stay with them/);
  });

  it('the medical line is unchanged without a kind', () => {
    expect(emergencyReply({ language: 'en', india: true })).toMatch(
      /nearest emergency department/,
    );
  });

  it('the holding line after an emergency names 112, not the self-harm lines', () => {
    const line = emergencyHoldingMessage('en', null, true);
    expect(line).toContain('112');
    expect(line).not.toMatch(/14416|harming yourself/);
  });
});
