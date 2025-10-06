import {decodeFeedbackPayloadToJson} from '../simulation';

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
