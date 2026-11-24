import {
  emergencyKindOf,
  emergencyReply,
} from '../../../bot-draft/safety-pack/safety-packs';
import { emergencyHoldingMessage } from '../../safety/crisis-copy';

/**
 * TF1 F19: a flood ("stuck on the roof with the children") and a collapse got "go to the nearest
 * emergency department", then the self-harm holding line.
 */
describe('the emergency reply fits the emergency', () => {
  it.each([
    [
      'We are stuck on the roof with the children, the water is rising',
      'rescue',
    ],
    ['Paani ghar mein aa gaya, hum chhat par phanse hain, baadh hai', 'rescue'],
    ['बाढ़ में फँस गए हैं', 'rescue'],
    ['Someone collapsed in the waiting room and is not breathing', 'collapse'],
    ['Ek aadmi behosh ho gaya', 'collapse'],
    ['I have severe chest pain', null],
  ])('%s → %s', (text, kind) => {
    expect(emergencyKindOf(text)).toBe(kind);
  });

  it('a rescue: call 112 and ask for rescue, never the emergency department', () => {
    const reply = emergencyReply({
      language: 'en',
      india: true,
      kind: 'rescue',
    });
    expect(reply).toContain('112');
    expect(reply).toMatch(/rescue/);
    expect(reply).not.toMatch(/emergency department/);
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
