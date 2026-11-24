import { describe, expect, it } from "vitest";

import { mapInterviewMessagesToFeed, parseSseBuffer } from "../useRoleplayInterviewStream";

describe("roleplay interview stream", () => {
  it("parses complete frames and keeps the partial one", () => {
    const { events, rest } = parseSseBuffer(
      'event: brief\ndata: {"stillNeeded":["the mode"]}\n\nevent: token\ndata: {"delta":"Hi"}\n\nevent: pl',
    );
    expect(events.map(e => e.type)).toEqual(["brief", "token"]);
    expect(events[0].data.stillNeeded).toEqual(["the mode"]);
    expect(rest).toBe("event: pl");
  });

  it("rebuilds the chat on reopen, with answered cards locked and the answer on the card", () => {
    const feed = mapInterviewMessagesToFeed([
      { seq: 1, role: "user", content: "A roleplay for helpline volunteers" },
      {
        seq: 2,
        role: "assistant",
        content: "Which skill?",
        questions: [{ id: "q1", prompt: "Which competency?", kind: "singleSelect" } as any],
      },
      { seq: 3, role: "user", content: "Empathy" },
      { seq: 4, role: "assistant", content: "Recorded." },
    ]);
    expect(feed.map(m => m.content)).toEqual([
      "A roleplay for helpline volunteers",
      "Which skill?",
      "Which competency?",
      "Recorded.",
    ]);
    expect(feed[2].answeredWith).toBe("Empathy");
  });
});
