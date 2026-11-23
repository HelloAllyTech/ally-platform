/**
 * Everyday idioms that contain a crisis keyword (Q3-fast stop 1, 18 Nov: "I want to die of
 * boredom. Do you have day passes?" matched the "want to die" keyword rule and got the crisis
 * reply). With one of these in the message a keyword match isn't final: the crisis classifier,
 * which runs beside every message anyway, decides. Real risk wording is unaffected.
 */
const IDIOM =
  /\b(die|dying|died|dead)\s+(of|from|with)\s+(boredom|bored|embarrassment|shame|laughter|laughing|cringe|hunger|heat|curiosity|excitement|jealousy|cuteness)\b|\b(bore|boredom)\s+(se|hoke|ho ke)\s+mar\b/i;

export const isEverydayIdiom = (text: string): boolean => IDIOM.test(text);
