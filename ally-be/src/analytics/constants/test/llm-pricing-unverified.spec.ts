import * as fs from 'fs';
import * as path from 'path';

describe('LLM Pricing Constants', () => {
  it('should not contain UNVERIFIED prices for any models', () => {
    const filePath = path.join(__dirname, '../llm-pricing.constants.ts');
    const fileContent = fs.readFileSync(filePath, 'utf8');
    expect(fileContent.includes('UNVERIFIED')).toBe(false);
  });
});
