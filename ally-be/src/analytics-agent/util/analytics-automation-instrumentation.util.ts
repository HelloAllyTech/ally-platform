/**
 * Checks, in code, that the events the PostHog agent wrote use the app's
 * existing instrumentation rather than something new (the rules are spelled out
 * in POSTHOG_EVENTS_SYSTEM_PROMPT; the model is asked, this is what verifies).
 *
 * The agent writes complete files, so each file's whole content is available.
 * These are text checks, not a parser: they look for the specific departures
 * seen in practice, and a person still reads the pull request.
 *
 * - `blocking`: a departure no reviewer fix should leave behind. The PostHog
 *   agent opens no pull request while one remains.
 * - `advisory`: probably wrong, but a text check could be mistaken. Handed to
 *   the reviewer to fix and noted in the pull request if it stays.
 */
export interface InstrumentationViolations {
  blocking: string[];
  advisory: string[];
}

/** The one place web code may touch PostHog directly. */
const WEB_ANALYTICS_LIB = 'ally-web/libs/ui-shared/src/lib/analytics/';
/** The one place backend code builds the client. */
const BE_POSTHOG_MODULE = 'ally-be/src/posthog/';

const isTestFile = (path: string): boolean =>
  /(\.spec\.|\.test\.|(^|\/)__tests__\/)/.test(path);

const isCode = (path: string): boolean => /\.(ts|tsx)$/.test(path);

/** How far after a capture call a `catch` may sit and still guard it. */
const GUARD_WINDOW = 1_000;

export function findInstrumentationViolations(
  files: ReadonlyMap<string, string>,
): InstrumentationViolations {
  const blocking: string[] = [];
  const advisory: string[] = [];

  for (const [path, content] of files) {
    if (!isCode(path) || isTestFile(path)) continue;

    if (path.startsWith('ally-web/') && !path.startsWith(WEB_ANALYTICS_LIB)) {
      if (
        /from\s+['"]posthog-js/.test(content) ||
        /\bposthog\.(capture|identify)\(/.test(content)
      ) {
        blocking.push(
          `\`${path}\` uses posthog-js directly: send events with \`useAnalytics().track\` instead`,
        );
      }
      if (/\btrack\(\s*['"`]/.test(content)) {
        blocking.push(
          `\`${path}\` passes an event name to \`track\` as an inline string: register it in ANALYTICS_EVENTS and pass the constant`,
        );
      }
    }

    if (path.startsWith('ally-be/') && !path.startsWith(BE_POSTHOG_MODULE)) {
      // LoggerService is not a Nest provider (no @Injectable): constructor
      // injection of it fails at startup. The code base uses getInstance.
      if (
        /\b(?:private|protected|public)\s+(?:readonly\s+)?\w+\s*:\s*LoggerService\s*[,)]/.test(
          content,
        )
      ) {
        blocking.push(
          `\`${path}\` injects LoggerService through the constructor, but it is not a Nest provider and the service would fail to start: declare \`private readonly logger = LoggerService.getInstance(<ClassName>.name);\` as a field and remove it from the constructor`,
        );
      }
      if (/new\s+PostHog\(/.test(content)) {
        blocking.push(
          `\`${path}\` creates its own PostHog client: inject the existing one from PostHogModule`,
        );
      }
      if (/\.capture\(\s*\{[^]{0,300}?\bevent:\s*['"`]/.test(content)) {
        blocking.push(
          `\`${path}\` writes an event name inline in a capture call: add it to the domain's *-analytics.constants.ts and pass the constant`,
        );
      }
      if (
        /distinctId:\s*(?:String\(|Number\(|['"`]|(?:\w+\.)*(?:userId|id)\s*[,}\r\n])/.test(
          content,
        )
      ) {
        advisory.push(
          `\`${path}\` builds distinctId by hand: use userDistinctId / emailDistinctId / anonymousDistinctId from ally-be/src/posthog/posthog.util.ts`,
        );
      }
      for (const match of content.matchAll(/\bposthog\.capture\(/g)) {
        const after = content.slice(
          match.index ?? 0,
          (match.index ?? 0) + GUARD_WINDOW,
        );
        if (!/catch\s*\(/.test(after)) {
          advisory.push(
            `\`${path}\` has a PostHog capture that is not wrapped in try/catch: analytics must never fail the request`,
          );
          break;
        }
      }
    }
  }
  return { blocking, advisory };
}
