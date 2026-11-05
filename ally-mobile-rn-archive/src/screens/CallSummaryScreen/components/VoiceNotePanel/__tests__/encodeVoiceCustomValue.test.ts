/**
 * The voice extractor returns human-readable strings; encodeVoiceCustomValue
 * must convert them into exactly the encodings the mobile custom-field editors
 * store (labels for selects, JSON label arrays for multi-selects, "true"/
 * "false" for booleans, YYYY-MM-DD for dates) and reject unmappable values.
 */
// customFieldsApi is imported for its real enums; stub the base api module it
// builds on so the import doesn't drag in the network/i18n stack.
jest.mock('@/services/api', () => ({api: {injectEndpoints: () => ({})}}));
jest.mock('@/components', () => ({useToast: () => ({showToast: jest.fn()})}));
jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
  useScribeVoiceNoteEnabled: () => ({data: false}),
  useVoiceNoteRecorder: () => ({}),
}));
jest.mock('@/services/callSummaryApi', () => ({
  useGetTagsMutation: () => [jest.fn()],
  useUpdateCallSummaryMutation: () => [jest.fn()],
}));
jest.mock('@/services/scribeNoteApi', () => ({
  useGenerateNoteFromAudioMutation: () => [jest.fn()],
  useSaveNoteTranscriptMutation: () => [jest.fn()],
}));
jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: () => undefined,
}));

import {
  CustomFieldDefinition,
  CustomFieldEditPermission,
  CustomFieldType,
} from '@/services/customFieldsApi';

import {encodeVoiceCustomValue} from '../VoiceNoteSection';

const def = (
  fieldType: CustomFieldType,
  options?: {id: string; label: string; order: number}[],
): CustomFieldDefinition => ({
  id: 'def-1',
  name: 'Field',
  fieldType,
  sectionKey: 'demo',
  editPermission: CustomFieldEditPermission.BOTH,
  options,
  showInTable: false,
});

describe('encodeVoiceCustomValue', () => {
  it('matches single-select options case-insensitively and stores the canonical label', () => {
    const d = def(CustomFieldType.SINGLE_SELECT, [
      {id: '1', label: 'In Person', order: 0},
      {id: '2', label: 'Phone', order: 1},
    ]);
    expect(encodeVoiceCustomValue(d, 'in person')).toBe('In Person');
    expect(encodeVoiceCustomValue(d, 'Video')).toBeNull();
  });

  it('encodes multi-select values as a JSON array of matched labels', () => {
    const d = def(CustomFieldType.MULTI_SELECT, [
      {id: '1', label: 'Anxiety', order: 0},
      {id: '2', label: 'Sleep', order: 1},
      {id: '3', label: 'Family', order: 2},
    ]);
    expect(encodeVoiceCustomValue(d, '["Anxiety", "sleep"]')).toBe(
      JSON.stringify(['Anxiety', 'Sleep']),
    );
    expect(encodeVoiceCustomValue(d, 'anxiety, family')).toBe(
      JSON.stringify(['Anxiety', 'Family']),
    );
    expect(encodeVoiceCustomValue(d, 'unknown')).toBeNull();
  });

  it('encodes booleans as "true"/"false" and rejects ambiguous answers', () => {
    const d = def(CustomFieldType.BOOLEAN);
    expect(encodeVoiceCustomValue(d, 'Yes')).toBe('true');
    expect(encodeVoiceCustomValue(d, 'no')).toBe('false');
    expect(encodeVoiceCustomValue(d, 'maybe')).toBeNull();
  });

  it('encodes dates as YYYY-MM-DD and rejects unparseable ones', () => {
    const d = def(CustomFieldType.DATE);
    expect(encodeVoiceCustomValue(d, '2026-07-06')).toBe('2026-07-06');
    expect(encodeVoiceCustomValue(d, 'not a date')).toBeNull();
  });

  it('stores text and number values verbatim (trimmed) and rejects empties', () => {
    expect(encodeVoiceCustomValue(def(CustomFieldType.TEXT), '  hello  ')).toBe(
      'hello',
    );
    expect(encodeVoiceCustomValue(def(CustomFieldType.NUMBER), '42')).toBe(
      '42',
    );
    expect(encodeVoiceCustomValue(def(CustomFieldType.TEXT), '   ')).toBeNull();
  });
});
