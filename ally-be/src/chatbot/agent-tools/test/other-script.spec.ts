import { withoutOtherScriptText } from '../list-tools.service';

/** TF1 F16: a Hindi word searched against English entries found nothing. */
describe('withoutOtherScriptText', () => {
  it('drops a text filter written in Devanagari, keeps the rest', () => {
    expect(
      withoutOtherScriptText({
        title_contains: 'कंबल',
        what_changed_contains: 'कंबल',
        sort: '-date',
        limit: 5,
      }),
    ).toEqual({ sort: '-date', limit: 5 });
  });

  it('leaves an English search alone', () => {
    expect(
      withoutOtherScriptText({ title_contains: 'blanket drive', limit: 5 }),
    ).toBeNull();
    expect(
      withoutOtherScriptText({ title_contains: 'café', limit: 5 }),
    ).toBeNull();
  });
});
