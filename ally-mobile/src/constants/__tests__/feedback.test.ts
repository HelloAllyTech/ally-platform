import {IssueOptions, FEEDBACK_ISSUE_OPTIONS, RATING_TEXT_MAP} from '../feedback';

describe('constants/feedback', () => {
  it('issue options end with OTHER', () => {
    expect(FEEDBACK_ISSUE_OPTIONS[FEEDBACK_ISSUE_OPTIONS.length - 1].value).toBe(
      IssueOptions.OTHER,
    );
  });
  it('rating text map covers 1-5', () => {
    expect(RATING_TEXT_MAP[1]).toBe('callFeedback.ratings.1');
    expect(RATING_TEXT_MAP[5]).toBe('callFeedback.ratings.5');
  });
});
