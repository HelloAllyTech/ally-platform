/**
 * Q3-fast Part 3 (B16): a page that came back 200 but is really an error, a block or a
 * challenge ("403 Forbidden", "Access denied", a captcha, "Just a moment…", a soft 404). Its
 * text must never become knowledge or a fact.
 *
 * Only short pages are judged: a real page that mentions "404" or "captcha" somewhere in a long
 * text is still read. The title alone is enough when it is plainly an error.
 */

/** Pages longer than this are real content, whatever words they contain. */
const SHORT_PAGE_CHARS = 1_500;

const ERROR_TITLE =
  /^\s*(?:(?:error\s*)?(?:4\d\d|5\d\d)\b|access denied|forbidden|not found|page not found|just a moment|attention required|security check|are you a (?:human|robot)|request (?:blocked|rejected)|site (?:blocked|unavailable)|service unavailable|bad gateway|too many requests)/i;

const ERROR_TEXT = [
  /\b(?:403|401)\b[\s\S]{0,40}\b(?:forbidden|unauthori[sz]ed)\b/i,
  /\b(?:forbidden|unauthori[sz]ed)\b[\s\S]{0,40}\b(?:403|401)\b/i,
  /\b404\b[\s\S]{0,40}\bnot found\b/i,
  /\bpage (?:you (?:are|were) looking for|you requested) (?:could ?n[o']t be found|does ?n[o']t exist|is not available)/i,
  /\baccess (?:to this (?:page|site|resource) )?(?:is |has been )?denied\b/i,
  /\byou don'?t have permission to access\b/i,
  /\b(?:captcha|recaptcha|hcaptcha|turnstile)\b/i,
  /\bverify (?:that )?you are (?:a )?human\b/i,
  /\bchecking (?:if the site connection is secure|your browser)\b/i,
  /\benable (?:javascript and cookies|cookies) to continue\b/i,
  /\bray id\b/i,
  // A page that is only a "turn on JavaScript" notice has no content for us to read (SB1).
  /\b(?:this (?:page|site|website) requires javascript|(?:you )?(?:need|have) to enable javascript|(?:please )?enable javascript (?:in your browser(?: settings)? )?(?:to|and reload)|javascript is (?:required|disabled|turned off))\b/i,
  /\bthe request (?:was|has been) (?:blocked|rejected)\b/i,
  /\b(?:50[0234])\b[\s\S]{0,40}\b(?:internal server error|bad gateway|service unavailable|gateway time-?out)\b/i,
];

export function looksLikeErrorPage(
  title: string | null | undefined,
  text: string,
): boolean {
  if (text.length > SHORT_PAGE_CHARS) return false;
  if (title && ERROR_TITLE.test(title)) return true;
  return ERROR_TEXT.some((pattern) => pattern.test(text));
}
