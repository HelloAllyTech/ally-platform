/**
 * The name a new chatbot starts with, until its builder names it: "Your new Ally Chatbot",
 * the day as DDMMYY, then a number that counts that builder's chatbots made the same day
 * ("Your new Ally Chatbot 2511251", "…2511252"). It is a placeholder, not a name: see
 * `name-placeholders.ts`, which never lets it win over a real one.
 */
export const AUTO_NAME_PREFIX = 'Your new Ally Chatbot';

/** DDMMYY, on the server's UTC calendar (the API has no timezone for the builder). */
export const autoNameDay = (now: Date): string => {
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(now.getUTCFullYear() % 100).padStart(2, '0');
  return `${dd}${mm}${yy}`;
};

/** "Your new Ally Chatbot DDMMYY": what every name made on `now`'s day starts with. */
export const autoNameStem = (now: Date): string =>
  `${AUTO_NAME_PREFIX} ${autoNameDay(now)}`;

/** Every auto name: the stem and a number. DDMMYY is 6 digits, so 7 or more digits in all. */
export const AUTO_NAME_PATTERN = /^your new ally chatbot \d{7,}$/i;

/**
 * The next name for a builder: one more than the highest number already used today among
 * `taken` (the names of the builder's chatbots that start with today's stem), so a name is
 * never handed out twice while its chatbot exists.
 */
export const nextAutoName = (now: Date, taken: string[]): string => {
  const stem = autoNameStem(now);
  let highest = 0;
  for (const name of taken) {
    if (!name.startsWith(stem)) continue;
    const rest = name.slice(stem.length);
    if (/^\d+$/.test(rest)) highest = Math.max(highest, Number(rest));
  }
  return `${stem}${highest + 1}`;
};
