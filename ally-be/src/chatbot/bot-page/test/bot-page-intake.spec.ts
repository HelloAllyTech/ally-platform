import { PrechatFieldType } from '../../enum/bot-page.enum';
import type { PrechatField } from '../../type/bot-page.type';
import {
  IntakeError,
  intakeRequired,
  validateIntake,
} from '../bot-page-intake';

const NOW = new Date('2026-11-07T10:00:00Z');

const FIELDS: PrechatField[] = [
  {
    id: 'name',
    label: 'Your name',
    type: PrechatFieldType.TEXT,
    required: true,
  },
  {
    id: 'email',
    label: 'Email',
    type: PrechatFieldType.EMAIL,
    required: false,
  },
  {
    id: 'phone',
    label: 'Phone',
    type: PrechatFieldType.PHONE,
    required: false,
  },
  {
    id: 'reason',
    label: 'Reason',
    type: PrechatFieldType.CHOICE,
    required: true,
    options: ['Therapy', 'Workshops'],
  },
  { id: 'dob', label: 'Date', type: PrechatFieldType.DATE, required: false },
  {
    id: 'ok',
    label: 'Consent',
    type: PrechatFieldType.CONSENT,
    required: true,
    consentText: 'I agree to be contacted.',
  },
];

const answers = (over: Record<string, string> = {}) =>
  Object.entries({
    name: ' Asha ',
    reason: 'Therapy',
    ok: 'true',
    ...over,
  }).map(([id, value]) => ({ id, value }));

describe('validateIntake', () => {
  it('stores each answer with its question, and the consent wording with the time', () => {
    const stored = validateIntake(
      FIELDS,
      answers({
        email: 'asha@example.com',
        phone: '+91 98200 12345',
        dob: '2026-11-20',
      }),
      NOW,
    );
    expect(stored.completedAt).toBe(NOW.toISOString());
    expect(stored.answers.map((a) => [a.id, a.value])).toEqual([
      ['name', 'Asha'],
      ['email', 'asha@example.com'],
      ['phone', '+91 98200 12345'],
      ['reason', 'Therapy'],
      ['dob', '2026-11-20'],
      ['ok', 'true'],
    ]);
    expect(stored.answers[0]).toEqual({
      id: 'name',
      label: 'Your name',
      type: 'text',
      value: 'Asha',
    });
    expect(stored.consents).toEqual([
      {
        id: 'ok',
        text: 'I agree to be contacted.',
        acceptedAt: NOW.toISOString(),
      },
    ]);
  });

  it('skips optional questions left blank and ignores unknown ids', () => {
    const stored = validateIntake(
      FIELDS,
      [...answers(), { id: 'gone', value: 'x' }],
      NOW,
    );
    expect(stored.answers.map((a) => a.id)).toEqual(['name', 'reason', 'ok']);
  });

  it.each([
    ['a missing required answer', { name: '' }, 'name'],
    ['a choice that is not offered', { reason: 'Massage' }, 'reason'],
    ['a consent not given', { ok: 'false' }, 'ok'],
    ['a bad email', { email: 'asha@' }, 'email'],
    ['a bad phone', { phone: '12' }, 'phone'],
    ['letters in a phone', { phone: 'call me maybe' }, 'phone'],
    ['a malformed date', { dob: '20-11-2026' }, 'dob'],
    ['an impossible date', { dob: '2026-02-30' }, 'dob'],
  ])('refuses %s', (_label, over, field) => {
    try {
      validateIntake(FIELDS, answers(over), NOW);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(IntakeError);
      expect((error as IntakeError).fieldId).toBe(field);
    }
  });

  it('knows when the questions must come before the chat', () => {
    expect(intakeRequired(FIELDS)).toBe(true);
    expect(intakeRequired([{ ...FIELDS[1] }])).toBe(false);
    expect(intakeRequired([])).toBe(false);
  });
});
