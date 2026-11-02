import * as fs from 'fs';
import * as path from 'path';

describe('LLM Pricing Constants', () => {
  it('should not contain UNVERIFIED prices for OpenAI models', () => {
    const filePath = path.join(__dirname, '../llm-pricing.constants.ts');
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const openAISection = fileContent.substring(
      fileContent.indexOf('// --- OpenAI'),
      fileContent.indexOf('// --- Gemini'),
    );
    expect(openAISection.includes('UNVERIFIED')).toBe(false);
  });
});
