import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetAnalyticsAgentFeedbackDto } from './analytics-agent.dto';

const errorsFor = (body: unknown) =>
  validate(plainToInstance(SetAnalyticsAgentFeedbackDto, body));

describe('SetAnalyticsAgentFeedbackDto', () => {
  it.each(['up', 'down'])('accepts %s', async (feedback) => {
    await expect(errorsFor({ feedback })).resolves.toHaveLength(0);
  });

  it('accepts null, which withdraws a rating', async () => {
    await expect(errorsFor({ feedback: null })).resolves.toHaveLength(0);
  });

  it.each([
    ['another word', { feedback: 'meh' }],
    ['a boolean', { feedback: true }],
    ['an empty string', { feedback: '' }],
    ['no feedback field at all', {}],
  ])('rejects %s', async (_label, body) => {
    await expect(errorsFor(body)).resolves.not.toHaveLength(0);
  });
});
