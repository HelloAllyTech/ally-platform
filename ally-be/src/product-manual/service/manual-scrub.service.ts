import { Injectable } from '@nestjs/common';

type Rule = { re: RegExp; reason: string };

/**
 * Safety rule 2 of the Product Manual: a write whose text holds a credential, an email address, a
 * phone number or a "Strategy:" / "Pricing:" line is refused. The repo and wiki are public and the
 * manual is meant for non-technical staff, so none of these belong on a page.
 *
 * The reasons never echo the matched text (it may be the secret itself); they name the kind of thing
 * and the line, so an agent can find it, remove it and retry.
 */
const RULES: Rule[] = [
  {
    re: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/,
    reason: 'looks like an API key (sk-…)',
  },
  {
    re: /(?<![A-Za-z0-9])(?:pmk|clr)_[A-Za-z0-9]{8,}/,
    reason: 'looks like an Ally access key (pmk_… / clr_…)',
  },
  {
    re: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])/,
    reason: 'looks like an AWS access key id',
  },
  { re: /-----BEGIN/, reason: 'contains a PEM block (-----BEGIN …)' },
  {
    re: /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{30,}/,
    reason: 'looks like a GitHub token',
  },
  {
    re: /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/,
    reason: 'looks like a Slack token',
  },
  {
    re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/,
    reason: 'looks like a JSON web token',
  },
  {
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
    reason: 'contains an email address',
  },
  {
    // International (+CC …), US-style (555-123-4567), and Indian mobile (optionally +91 / 0 prefixed).
    re: /(?<![\w.])\+\d{1,3}[\s.-]?\(?\d{2,5}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,5}(?![\w])|(?<![\d.])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)|(?<![\d.])(?:0|91)?[6-9]\d{9}(?!\d)/,
    reason: 'contains a phone number',
  },
  {
    re: /^[\s>*_#-]*(?:strategy|pricing)[\s*_]*:/i,
    reason:
      'has a line starting "Strategy:" or "Pricing:" (strategy and pricing stay out of the manual)',
  },
];

@Injectable()
export class ManualScrubService {
  check(text: string): { ok: true } | { ok: false; reason: string } {
    if (!text) return { ok: true };
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const rule of RULES) {
        if (rule.re.test(lines[i])) {
          return {
            ok: false,
            reason: `Line ${i + 1} ${rule.reason}. Remove it and write again.`,
          };
        }
      }
    }
    // A multi-line PEM header etc. is already caught per line; nothing spans lines.
    return { ok: true };
  }
}
