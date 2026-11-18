import { DebriefConsolePmAgentController } from '../../controller/debrief-console-pm-agent.controller';
import { DebriefConsoleReleasesController } from '../../controller/debrief-console-releases.controller';
import { DebriefConsoleReviewController } from '../../controller/debrief-console-review.controller';
import { DebriefConsoleSettingsController } from '../../controller/debrief-console-settings.controller';
import { DebriefConsoleTenantsController } from '../../controller/debrief-console-tenants.controller';
import { DebriefConsoleViewController } from '../../controller/debrief-console-view.controller';

/** The Console API's controllers (it was one controller before the split by area). */
export const CONSOLE_CONTROLLERS = [
  DebriefConsoleViewController,
  DebriefConsoleReviewController,
  DebriefConsoleSettingsController,
  DebriefConsoleTenantsController,
  DebriefConsolePmAgentController,
  DebriefConsoleReleasesController,
];

/** The Console controller that serves a handler, by the handler's name. */
export function consoleControllerOf(handler: string) {
  const found = CONSOLE_CONTROLLERS.find(
    (c) =>
      typeof (c.prototype as unknown as Record<string, unknown>)[handler] ===
      'function',
  );
  if (!found)
    throw new Error(`no Console controller has a handler named ${handler}`);
  return found;
}
