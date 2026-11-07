import { BUG_FIX_SESSION_REPOS } from './bug-fix-session.constants';
import {
  renderPipelineProbes,
  renderProductionProbes,
} from './bug-hunter-probes.constants';

export interface ToolboxContext {
  apiBaseUrl: string;
  repo: string;
  runId: string;
  authHeader: string;
  findingId?: string;
}

/** Where the runner puts the other Ally repos, read-only. Kept in step with the workflows' sibling checkout. */
export const BUG_HUNTER_SIBLINGS_DIR = '/tmp/siblings';

/**
 * Every tool a Bug Hunter run has for LOCATING a fault, in one section every
 * protocol renders the same way: the running system as a browser sees it,
 * live data and logs through ally-be, the other repos' source, and what
 * Bug Hunter already knows. Written after a fix session that saw one repo
 * and nothing running "fixed" a backend data fault in the frontend.
 */
export function renderToolbox({
  apiBaseUrl,
  repo,
  runId,
  authHeader,
  findingId,
}: ToolboxContext): string[] {
  const base = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/bug-hunter/pipeline`;
  const others = BUG_FIX_SESSION_REPOS.filter((r) => r !== repo);
  return [
    `## Your tools for locating the fault`,
    `Use them before you decide which layer is broken. A claim about data or production carries the call you made and what it returned; "probably missing" is not evidence.`,
    `1. Production as a browser sees it — public GETs, no key:`,
    ...renderProductionProbes(apiBaseUrl),
    `2. Production data and logs through ally-be — fixed read-only questions, recorded against this run:`,
    ...renderPipelineProbes(apiBaseUrl, runId, authHeader),
    `  When the symptom is an external service's answer — the image service refusing a request, a model "does not exist", a prompt blocked — our code cannot tell you what that service accepts today. Ask it: call the image-generation probe as configured to see the symptom, then with exactly the model, size and prompt your fix will send. Never propose a model name, size or parameter you have not seen it accept. A test with the provider mocked proves our code changed, not that the symptom is gone, and such a fix does not merge itself until an image-generation probe for it has come back ok. On 2026-10-28/29 two fixes for a retired model merged on code reading alone: the first swapped in a model that was also retired, the second blamed a phrase in the prompt.`,
    `3. The other Ally repos' source, read-only, at ${BUG_HUNTER_SIBLINGS_DIR}/<repo> (${others.join(', ')}). Read them with shell tools: ls, grep -rn, sed -n. Follow a value across the boundary — the endpoint a client calls and the service behind it. Never edit them; a change another repo needs goes in your cross-repo plan. If the directory is empty the runner could not fetch them: say so rather than guess what they contain.`,
    `4. What Bug Hunter already knows, beyond what this prompt shows:`,
    `  - Feature cards (how a feature works across repos): curl -sS "${base}/feature-maps?q=<the feature in a few words>&runId=${runId}" ${authHeader}`,
    findingId
      ? `  - Resolved bugs like this one and where their fault was: curl -sS "${base}/precedents?findingId=${findingId}&runId=${runId}" ${authHeader}`
      : `  - Resolved bugs like a finding and where their fault was: curl -sS "${base}/precedents?findingId=<finding id>&runId=${runId}" ${authHeader}`,
    `  - Playbooks for a class of bug: curl -sS "${base}/playbooks?q=<the bug in one line>" ${authHeader}`,
    ``,
  ];
}

/**
 * Where a run is, said the same way in every brief. Since the 2026-10-23
 * cutover the five services are folders of one repository (ally-platform);
 * the workflows start the engine inside the service's folder.
 */
export const renderWorkspace = (repo: string): string =>
  `WHERE YOU ARE: the ally-platform monorepo is checked out at master, and your working directory is its "${repo}/" folder — the "${repo}" service. "this repo" below means this folder: run its commands from here, read its CLAUDE.md, and stage files by their path from here ("git add src/x.ts"). The other services are folders beside it (../ally-be, ../ally-web, …), also linked at ${BUG_HUNTER_SIBLINGS_DIR}/<service>: read them, never edit them — a change outside "${repo}/" fails the PR's path check unless it is a step of a cross-service plan. Git commands and "gh" work from here as usual; branches and pull requests are on ally-platform.`;
