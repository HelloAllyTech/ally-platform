import type {ThemeMode} from '../general';

describe('types/general', () => {
  it('accepts theme mode values', () => {
    const a: ThemeMode = 'dark';
    const b: ThemeMode = 'light';
    expect(a).toBe('dark');
    expect(b).toBe('light');
  });
});
