import type {TriggerWarning} from '@/types';

import {decodeFeedbackPayloadToJson, getTriggerWarningNames} from '../simulation';

describe('decodeFeedbackPayloadToJson', () => {
  it('should decode a valid Uint8Array payload to JSON', () => {
    const payload = new Uint8Array([
      123, 34, 116, 101, 115, 116, 34, 58, 34, 118, 97, 108, 117, 101, 34, 125,
    ]); // {"test":"value"}
    const result = decodeFeedbackPayloadToJson(payload);
    expect(result).toEqual({test: 'value'});
  });

  it('should return null for an invalid payload', () => {
    const payload = new Uint8Array([123, 34, 116, 101, 115, 116]); // invalid JSON
    const result = decodeFeedbackPayloadToJson(payload);
    expect(result).toBeNull();
  });

  it('should return null for non-Uint8Array payload', () => {
    const payload = 'invalid';
    const result = decodeFeedbackPayloadToJson(payload);
    expect(result).toBeNull();
  });
});

describe('getTriggerWarningNames', () => {
  it('should extract names from trigger warnings array', () => {
    const triggerWarnings: TriggerWarning[] = [
      {id: '1', name: 'Depression'},
      {id: '2', name: 'Anxiety'},
      {id: '3', name: 'Suicidal ideation'},
    ];
    const result = getTriggerWarningNames(triggerWarnings);
    expect(result).toEqual(['Depression', 'Anxiety', 'Suicidal ideation']);
  });

  it('should return empty array when triggerWarnings is undefined', () => {
    const result = getTriggerWarningNames(undefined);
    expect(result).toEqual([]);
  });

  it('should return empty array when triggerWarnings is empty', () => {
    const result = getTriggerWarningNames([]);
    expect(result).toEqual([]);
  });

  it('should handle trigger warnings with additional optional fields', () => {
    const triggerWarnings: TriggerWarning[] = [
      {
        id: '1',
        name: 'Depression',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      },
      {id: '2', name: 'Anxiety'},
    ];
    const result = getTriggerWarningNames(triggerWarnings);
    expect(result).toEqual(['Depression', 'Anxiety']);
  });
});
