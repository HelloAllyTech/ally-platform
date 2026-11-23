const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RUN = /\+?\d[\d\s().-]{5,}\d/g;

/** Whether the text holds an email address or a phone number (7 to 15 digits, with spaces or dashes). */
export const hasContact = (text: string): boolean => {
  if (EMAIL.test(text)) return true;
  return (text.match(PHONE_RUN) ?? []).some(run => {
    const digits = run.replace(/\D/g, "").length;
    return digits >= 7 && digits <= 15;
  });
};
