import { BuilderPrdDocument } from '../../type/builder-prd.type';
import { prdForPrompt } from './builder-eval-runner.service';

// This value is from the service file.
const PRD_FOR_PROMPT_MAX_CHARS = 24_000;

describe('BuilderEvalRunnerService', () => {
  describe('prdForPrompt', () => {
    const longText = 'a'.repeat(PRD_FOR_PROMPT_MAX_CHARS);
    const doc: BuilderPrdDocument = {
      title: 'Test Title',
      summary: 'Test Summary',
      problem: longText,
      usersAndContext: '',
      existingBehaviour: '',
      whereChangesBelong: '',
      goals: '',
      nonGoals: '',
      requirements: [],
      assumptions: [],
      technicalPlan: { repos: [], dataModelMd: '', apiMd: '' },
      testPlanMd: '',
      e2ePlanMd: '',
      openQuestions: [],
    };

    it('should return the full JSON if it is within the limit', () => {
      const shortDoc: BuilderPrdDocument = { ...doc, problem: 'short text' };
      const result = prdForPrompt(shortDoc);
      const parsed = JSON.parse(result);
      expect(parsed.problem).toBe('short text');
      expect(parsed._truncated).toBeUndefined();
    });

    it('should return a valid JSON object when the document is truncated', () => {
      const result = prdForPrompt(doc);
      const parsed = JSON.parse(result);
      expect(parsed._truncated).toBeDefined();
    });

    it('should return a string shorter than PRD_FOR_PROMPT_MAX_CHARS', () => {
      const result = prdForPrompt(doc);
      expect(result.length).toBeLessThanOrEqual(PRD_FOR_PROMPT_MAX_CHARS);
    });
  });
});
