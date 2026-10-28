import { CHARACTER_INTERVIEW_MAX_INVALID_TOOL_CALL_RETRIES } from '../character-interview.constants';

describe('Character Interview Constants', () => {
  it('should have the correct value for CHARACTER_INTERVIEW_MAX_INVALID_TOOL_CALL_RETRIES', () => {
    expect(CHARACTER_INTERVIEW_MAX_INVALID_TOOL_CALL_RETRIES).toBe(4);
  });
});
