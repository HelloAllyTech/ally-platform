import { addressUrl, pageRoute } from "../route";

describe("which page this is (stage 7)", () => {
  it("reads the address under the deploy base", () => {
    expect(pageRoute("/admin/chat/k7m2p9qa", "/admin/", "app.helloally.ai")).toEqual({
      key: "k7m2p9qa",
      kind: "address",
    });
    expect(pageRoute("/chat/k7m2p9qa/", "/", "localhost")).toEqual({
      key: "k7m2p9qa",
      kind: "address",
    });
  });

  it("treats /b/<slug> as an old link, to be moved to its address", () => {
    expect(pageRoute("/admin/b/sunrise-mind", "/admin", "app.helloally.ai")).toEqual({
      key: "sunrise-mind",
      kind: "legacy",
    });
  });

  it("anything else is a custom domain, found by its hostname", () => {
    expect(pageRoute("/", "/", "Chat.SunriseMind.in")).toEqual({
      key: "chat.sunrisemind.in",
      kind: "domain",
    });
    expect(pageRoute("/anything/here", "/admin/", "chat.x.org").kind).toBe("domain");
  });

  it("an old link goes to the same page on its address, keeping query and hash", () => {
    expect(addressUrl("/admin/", "k7m2p9qa", "?embed=1", "#top")).toBe(
      "/admin/chat/k7m2p9qa?embed=1#top",
    );
  });

  it("a malformed escape is no key", () => {
    expect(pageRoute("/chat/%E0%A4%A", "/", "x").key).toBe("");
  });
});
