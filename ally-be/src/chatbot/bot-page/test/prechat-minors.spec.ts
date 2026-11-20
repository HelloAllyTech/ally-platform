import { PrechatFieldType } from '../../enum/bot-page.enum';
import { prechatFor } from '../prechat-minors';

describe('pre-chat questions on the young-people pack (Q3-fast Part 1, S3)', () => {
  const fields = [
    {
      id: 'q1',
      label: 'Your name',
      type: PrechatFieldType.TEXT,
      required: true,
    },
    {
      id: 'q2',
      label: 'Phone number',
      type: PrechatFieldType.PHONE,
      required: true,
    },
    { id: 'q3', label: 'Email', type: PrechatFieldType.EMAIL, required: false },
    {
      id: 'q4',
      label: 'WhatsApp number',
      type: PrechatFieldType.TEXT,
      required: false,
    },
    {
      id: 'q5',
      label: 'What are you looking for?',
      type: PrechatFieldType.CHOICE,
      required: true,
      options: ['JEE', 'NEET'],
    },
  ];

  it('asks no name or contact details when the pack is on', () => {
    expect(prechatFor(fields, 'minors').map((f) => f.id)).toEqual(['q5']);
  });

  it('leaves every other assistant’s questions as they are', () => {
    expect(prechatFor(fields, 'medical')).toBe(fields);
    expect(prechatFor(fields, null)).toBe(fields);
  });
});
