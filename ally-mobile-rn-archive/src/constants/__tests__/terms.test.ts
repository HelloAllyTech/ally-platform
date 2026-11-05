import {TermsAndAgreementData} from '../terms';

describe('TermsAndAgreementData', () => {
  it('should be an array', () => {
    expect(Array.isArray(TermsAndAgreementData)).toBe(true);
  });

  it('should have required fields', () => {
    TermsAndAgreementData.forEach(item => {
      expect(item).toHaveProperty('headingKey');
      expect(item).toHaveProperty('bullets');
      expect(Array.isArray(item.bullets)).toBe(true);
      item.bullets.forEach(bullet => {
        expect(bullet).toHaveProperty('textKey');
        if (bullet.link) {
          expect(bullet.link).toHaveProperty('textKey');
          expect(bullet.link).toHaveProperty('href');
        }
      });
    });
  });

  it('should have non-empty content', () => {
    expect(TermsAndAgreementData.length).toBeGreaterThan(0);
  });
});

