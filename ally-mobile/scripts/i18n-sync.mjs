/* eslint-disable no-undef, no-console */
/**
 * Fills keys that exist in en.json but are missing from the other locale files.
 *
 * Usage:
 *   node scripts/i18n-sync.mjs                 # report only, writes nothing
 *   node scripts/i18n-sync.mjs "$OPENAI_KEY"   # translate and write
 *   DRY_RUN=true node scripts/i18n-sync.mjs "$OPENAI_KEY"   # compute, write nothing
 *
 * Ported from ally-web/scripts/i18n-sync.mjs with three deliberate differences:
 *   1. LOCALES_DIR points at this repo's locale directory.
 *   2. No version-file bumping — ally-web writes a versions/ dir that nothing reads.
 *   3. A key whose translation fails is LEFT MISSING rather than filled with the
 *      English source. i18next already falls back to en at runtime, so an absent
 *      key renders identically to a copied one but stays visible to this report
 *      and to the parity test. Writing English into a locale file hides the gap.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const LOCALES_DIR = 'src/localization/locales';
const SOURCE_LANG = 'en';
// Listed explicitly rather than read from the directory: locales/ also holds an orphaned
// old_en.json that no code imports, and directory globbing treats it as a live locale.
// Keep in sync with SUPPORTED_LANGUAGES in src/constants/general.ts.
const TARGET_LANGS = ['hi', 'mr', 'ta', 'kn'];
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o';
const DRY_RUN = (process.env.DRY_RUN ?? 'false').toLowerCase() === 'true';
const API_KEY = process.argv[2];
const SHOULD_TRANSLATE = Boolean(API_KEY);

const PLACEHOLDER_REGEX = /\{\{[^}]+\}\}|<[^>]+>/g;

const isObject = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readJson = async filePath =>
  JSON.parse(await fs.readFile(filePath, 'utf-8'));

const writeJson = async (filePath, data) => {
  if (DRY_RUN) return;
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
};

const getLocaleFilePath = lang => path.join(LOCALES_DIR, `${lang}.json`);

const maskPlaceholders = text => {
  const placeholders = [];
  const masked = text.replace(PLACEHOLDER_REGEX, match => {
    const token = `__TOKEN_${placeholders.length}__`;
    placeholders.push({token, value: match});
    return token;
  });
  return {masked, placeholders};
};

const restorePlaceholders = (text, placeholders) =>
  placeholders.reduce(
    (result, {token, value}) => result.split(token).join(value),
    text,
  );

const translateWithOpenAI = async ({text, targetLang}) => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You are a professional localization engine for a mental-health practice app. ' +
            'Translate the user text exactly, preserving every __TOKEN_n__ marker verbatim, ' +
            'and return only the translated string.',
        },
        {role: 'user', content: `Translate to ${targetLang}: ${text}`},
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI translation failed (${response.status}): ${await response.text()}`,
    );
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || null;
};

/** Returns the translated string, or null if it could not be translated. */
const translateText = async ({text, targetLang}) => {
  if (!text || typeof text !== 'string' || !SHOULD_TRANSLATE) return null;

  const {masked, placeholders} = maskPlaceholders(text);
  const translated = await translateWithOpenAI({text: masked, targetLang});
  if (!translated) return null;

  const restored = restorePlaceholders(translated, placeholders);

  // A dropped placeholder is a runtime bug, so reject the translation instead of writing it.
  const expected = text.match(PLACEHOLDER_REGEX) ?? [];
  const got = restored.match(PLACEHOLDER_REGEX) ?? [];
  if ([...expected].sort().join('|') !== [...got].sort().join('|')) {
    console.warn(`  ! placeholder mismatch, skipping: ${JSON.stringify(text)}`);
    return null;
  }

  return restored;
};

const fillMissing = async ({source, target, targetLang, missing, failed}) => {
  const walk = async (sourceNode, targetNode, pathKey) => {
    if (isObject(sourceNode)) {
      const targetObj = isObject(targetNode) ? targetNode : {};
      const result = {};

      // Keep any key the target holds that the source has dropped, rather than
      // silently deleting translated content on a source rename.
      for (const [key, value] of Object.entries(targetObj)) {
        if (!Object.prototype.hasOwnProperty.call(sourceNode, key))
          result[key] = value;
      }

      for (const [key, value] of Object.entries(sourceNode)) {
        const nextKey = pathKey ? `${pathKey}.${key}` : key;
        const filled = await walk(value, targetObj[key], nextKey);
        if (filled !== undefined) result[key] = filled;
      }
      return result;
    }

    if (targetNode !== undefined && targetNode !== null) return targetNode;
    if (typeof sourceNode !== 'string') return targetNode;

    missing.push(pathKey);
    const translated = await translateText({text: sourceNode, targetLang});
    if (translated === null) {
      failed.push(pathKey);
      return undefined; // stays missing — never fall back to the English source
    }
    return translated;
  };

  return walk(source, target, '');
};

const main = async () => {
  const targetLangs = TARGET_LANGS;
  const source = await readJson(getLocaleFilePath(SOURCE_LANG));

  if (!SHOULD_TRANSLATE) {
    console.log(
      'Report only — pass an OpenAI API key as the first argument to translate.\n',
    );
  }

  let totalMissing = 0;
  let totalFailed = 0;

  for (const lang of targetLangs) {
    const targetPath = getLocaleFilePath(lang);
    const missing = [];
    const failed = [];
    const merged = await fillMissing({
      source,
      target: await readJson(targetPath),
      targetLang: lang,
      missing,
      failed,
    });

    totalMissing += missing.length;
    totalFailed += failed.length;

    if (missing.length === 0) {
      console.log(`[${lang}] up to date`);
      continue;
    }

    console.log(`[${lang}] missing ${missing.length}:`);
    missing.forEach(key => console.log(`  - ${key}`));

    if (SHOULD_TRANSLATE) {
      await writeJson(targetPath, merged);
      const filled = missing.length - failed.length;
      console.log(
        `[${lang}] filled ${filled}${DRY_RUN ? ' (dry run, not written)' : ''}`,
      );
      if (failed.length > 0) {
        console.log(
          `[${lang}] left missing (translation failed): ${failed.length}`,
        );
      }
    }
  }

  if (totalMissing === 0)
    console.log('\nAll locales are at parity with en.json.');
  if (totalFailed > 0) {
    console.error(
      `\n${totalFailed} key(s) could not be translated and were left missing.`,
    );
    process.exit(1);
  }
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
