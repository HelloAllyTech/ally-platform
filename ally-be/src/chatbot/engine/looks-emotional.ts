/**
 * A quick word check (Q3-fast stop 1, option c): does the message look emotional? Only then does
 * the run wait for the crisis check's level, so an upset person's reply can open warmly; every
 * other message starts its run at once. At-risk and emergency replies never depend on this: the
 * check runs beside every run and cancels it when it says so.
 *
 * Deliberately wide (a false "yes" costs at most the wait), in English, Hinglish and Hindi.
 */
const EMOTIONAL = new RegExp(
  [
    // English
    String.raw`\b(sad|depress\w*|upset|angry|anger|furious|annoyed|frustrat\w*|cry|crying|cried|tears|stress\w*|anxious|anxiety|panic\w*|scared|afraid|fear\w*|lonely|alone|hopeless|worthless|guilt\w*|ashamed|grie\w+|heartbroken|broken|miserable|hate|hurt\w*|harm\w*|pain\w*|exhausted|overwhelm\w*|worried|worry|nervous|useless|cope|coping|suicid\w*|die|dying|died|dead|death|kill\w*|end it|give up|no point|bad (mother|father|mom|mum|dad|parent))\b`,
    // Hinglish
    String.raw`\b(dukhi|pareshan|pareshaan|tension|rona|ro (raha|rahi|rahe)|gussa|gussaa|mar (gaya|gayi|jaun|jaunga|jaungi)|marna|marne|udaas|udas|akela|akeli|dar lag\w*|thak (gaya|gayi)|jeene|zindagi|khatam|bekaar|bekar|takleef|dard|sab khatam)\b`,
    // Hindi (Devanagari)
    String.raw`दुख|दुखी|परेशान|तनाव|रो रह|रोना|गुस्स|मर ग|मरना|उदास|अकेल|डर|थक ग|जीने|ज़िंदगी|जिंदगी|ख़त्म|खत्म|दर्द|तकलीफ`,
  ].join('|'),
  'i',
);

export const looksEmotional = (text: string): boolean => EMOTIONAL.test(text);
