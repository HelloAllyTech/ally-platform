/**
 * The text a developer pastes to connect a coding agent to the Product Manual's proposal MCP.
 * Pure, so the exact commands are unit-tested: a wrong flag here is a developer stuck at step 2.
 */

export const AGENT_SERVER_NAME = "product-manual";

/** Shown in every snippet until a key has been created in this visit. */
export const KEY_PLACEHOLDER = "<your key>";

export type AgentTarget = "claude-code" | "repo" | "other";

export const AGENT_TARGETS: AgentTarget[] = ["claude-code", "repo", "other"];

/** One command, run once in any terminal. `--scope user` makes it work in every folder. */
export const claudeCodeCommand = (url: string, key: string): string =>
  `claude mcp add --scope user --transport http ${AGENT_SERVER_NAME} ${url} --header "Authorization: Bearer ${key}"`;

/** For people working inside `ally-platform`, whose root `.mcp.json` reads these two variables. */
export const repoEnvLines = (url: string, key: string): string =>
  [`export ALLY_PRODUCT_MANUAL_URL=${url}`, `export ALLY_PRODUCT_MANUAL_KEY=${key}`].join("\n");

/** The `mcpServers` shape Cursor and most other agents read. */
export const mcpJson = (url: string, key: string): string =>
  JSON.stringify(
    { mcpServers: { [AGENT_SERVER_NAME]: { url, headers: { Authorization: `Bearer ${key}` } } } },
    null,
    2,
  );

export const snippetFor = (target: AgentTarget, url: string, key: string): string => {
  switch (target) {
    case "claude-code":
      return claudeCodeCommand(url, key);
    case "repo":
      return repoEnvLines(url, key);
    default:
      return mcpJson(url, key);
  }
};
