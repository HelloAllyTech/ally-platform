import { describe, expect, it } from "vitest";

import { isCustomDirectoryHost } from "../directoryHost";

describe("isCustomDirectoryHost", () => {
  it.each(["localhost", "127.0.0.1", "app.helloally.ai", "helloally.ai", "[::1]", ""])(
    "treats %s as Ally's own",
    host => expect(isCustomDirectoryHost(host)).toBe(false),
  );
  it.each(["resources.example.org", "Directory.Example.ORG"])("treats %s as a custom domain", host =>
    expect(isCustomDirectoryHost(host)).toBe(true),
  );
});
