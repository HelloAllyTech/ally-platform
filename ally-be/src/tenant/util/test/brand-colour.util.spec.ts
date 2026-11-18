import {
  ALLY_BONE,
  ALLY_BRAND_PRIMARY,
  ALLY_INK,
  ALLY_PAGE_BACKGROUND,
} from '../../constants/tenant-branding.constants';
import {
  buildColourRamp,
  contrastRatio,
  hexToRgb,
  isHexColour,
  normaliseHex,
  pickOnPrimary,
  relativeLuminance,
  rgbToHex,
} from '../brand-colour.util';

describe('brand-colour.util', () => {
  describe('hex parsing', () => {
    it('accepts #RRGGBB in either case and nothing else', () => {
      expect(isHexColour('#264D8E')).toBe(true);
      expect(isHexColour('#264d8e')).toBe(true);
      expect(isHexColour('264D8E')).toBe(false);
      expect(isHexColour('#264')).toBe(false);
      expect(isHexColour('#264D8EFF')).toBe(false);
      expect(isHexColour('rgb(1,2,3)')).toBe(false);
      expect(isHexColour(null)).toBe(false);
    });

    it('round-trips through rgb and normalises to uppercase', () => {
      expect(hexToRgb('#264d8e')).toEqual([38, 77, 142]);
      expect(rgbToHex([38, 77, 142])).toBe('#264D8E');
      expect(normaliseHex('#abcdef')).toBe('#ABCDEF');
    });

    it('clamps out-of-range channels when encoding', () => {
      expect(rgbToHex([300, -5, 12.6])).toBe('#FF000D');
    });
  });

  describe('contrast', () => {
    it('matches the WCAG reference points', () => {
      expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
      expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
      expect(contrastRatio('#FFFFFF', '#000000')).toBe(21);
      expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
      expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
    });

    it('Ally Blue clears both thresholds on the page background', () => {
      const ratio = contrastRatio(ALLY_BRAND_PRIMARY, ALLY_PAGE_BACKGROUND);
      expect(ratio).toBeGreaterThan(4.5);
    });
  });

  describe('buildColourRamp', () => {
    const ramp = buildColourRamp('#264d8e');

    it('anchors 500 and DEFAULT on the brand colour, normalised', () => {
      expect(ramp[500]).toBe('#264D8E');
      expect(ramp.DEFAULT).toBe('#264D8E');
    });

    it('gets strictly lighter toward 50 and darker toward 900', () => {
      const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
      const lum = steps.map((s) => relativeLuminance(ramp[s]));
      for (let i = 1; i < lum.length; i++) {
        expect(lum[i]).toBeLessThan(lum[i - 1]);
      }
    });

    it('keeps the hover/active steps readable on bone, like the hand-tuned ramp', () => {
      expect(contrastRatio(ramp[600], ALLY_BONE)).toBeGreaterThan(4.5);
      expect(contrastRatio(ramp[700], ALLY_BONE)).toBeGreaterThan(4.5);
    });

    it('gives the same ramp for the same hex regardless of case', () => {
      expect(buildColourRamp('#264D8E')).toEqual(ramp);
    });
  });

  describe('pickOnPrimary', () => {
    it('puts bone on a dark brand colour and ink on a light one', () => {
      expect(pickOnPrimary('#264D8E')).toBe(ALLY_BONE);
      expect(pickOnPrimary('#000000')).toBe(ALLY_BONE);
      expect(pickOnPrimary('#F5C400')).toBe(ALLY_INK);
    });
  });
});
