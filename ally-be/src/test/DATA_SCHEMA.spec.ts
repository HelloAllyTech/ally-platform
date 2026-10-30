import * as fs from 'fs';
import * as path from 'path';

describe('DATA_SCHEMA.md', () => {
  it('should have the correct reconciled date', () => {
    const filePath = path.join(__dirname, '..', '..', 'DATA_SCHEMA.md');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const match = fileContent.match(
      /Last reconciled with the codebase: \*\*([0-9-]+)\*\*/,
    );
    expect(match).not.toBeNull();
    if (match) {
      const date = match[1];
      expect(date).toBe('2026-10-30');
    }
  });
});
