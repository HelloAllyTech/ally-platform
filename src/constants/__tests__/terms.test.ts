import {TermsAndAgreementData} from '../terms';

describe('TermsAndAgreementData', () => {
  it('should be an array', () => {
    expect(Array.isArray(TermsAndAgreementData)).toBe(true);
  });

  it('should have required fields', () => {
    TermsAndAgreementData.forEach(item => {
      expect(item).toHaveProperty('heading');
      expect(item).toHaveProperty('content');
      if (item.link) {
        expect(item.link).toHaveProperty('text');
        expect(item.link).toHaveProperty('href');
      }
    });
  });

  it('should have non-empty content', () => {
    expect(TermsAndAgreementData.length).toBeGreaterThan(0);
  });
});

