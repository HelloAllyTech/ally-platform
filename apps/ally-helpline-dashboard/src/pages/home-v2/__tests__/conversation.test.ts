import { describe, expect, it } from "vitest";

import {
  isDistress,
  maskEmail,
  practiceOutcome,
  respond,
  routeTyped,
  scrubQuestion,
  suggestionsFor,
  topicFor,
} from "../conversation";

describe("routeTyped", () => {
  it("treats an email as sign-in, normalised the way accounts are stored", () => {
    expect(routeTyped("  Priya@NGO.org ")).toEqual({ type: "email", email: "priya@ngo.org" });
  });

  it("sends distress to support before anything else", () => {
    expect(routeTyped("honestly i'm not okay these days")).toEqual({ type: "distress" });
  });

  it("marks a question it cannot place as unmatched", () => {
    expect(routeTyped("Does Ally work offline?")).toEqual({
      type: "topic",
      topic: "fallback",
      matched: false,
    });
  });
});

describe("isDistress", () => {
  it.each([
    "I want to die",
    "thinking about suicide",
    "I can't cope anymore",
    "i am not ok",
    "I need help",
    "मैं ठीक नहीं हूँ",
    "aatmahatya ke baare mein soch rahi hoon",
    "தற்கொலை எண்ணம்",
    "ಆತ್ಮಹತ್ಯೆ",
  ])("catches %s", text => {
    expect(isDistress(text)).toBe(true);
  });

  it.each(["Is it private?", "How do I log in?", "What languages does Ally support?"])(
    "leaves %s alone",
    text => {
      expect(isDistress(text)).toBe(false);
    },
  );
});

describe("topicFor", () => {
  it.each([
    ["Is my data safe?", "privacy"],
    ["Can I practise in Tamil?", "languages"],
    ["Is it free for my NGO?", "cost"],
    ["How do I log in?", "signin"],
    ["We run a helpline, can we use this?", "org"],
    ["How can I join?", "access"],
    ["What's new?", "news"],
    ["Can I try a roleplay?", "practice"],
    ["What is Ally?", "what"],
    ["क्या यह गोपनीय है?", "privacy"],
  ])("routes %s to %s", (text, topic) => {
    expect(topicFor(text)).toBe(topic);
  });

  it("does not claim a question just because it mentions Ally", () => {
    expect(topicFor("Does Ally work offline?")).toBeNull();
  });

  it("ignores words inside an email address", () => {
    expect(routeTyped("Does Ally work offline? mail me at priya@ngo.org")).toEqual({
      type: "topic",
      topic: "fallback",
      matched: false,
    });
  });
});

describe("scrubQuestion", () => {
  it("removes emails, phone numbers and links before anything is logged", () => {
    expect(
      scrubQuestion("mail me at priya@ngo.org or call +91 98450 12345, see https://x.y/z"),
    ).toBe("mail me at [email] or call [number], see [link]");
  });

  it("caps the length", () => {
    expect(scrubQuestion("a".repeat(500))).toHaveLength(200);
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("priya@ngo.org")).toBe("p••••@ngo.org");
  });

  it("leaves something that is not an email untouched", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });
});

describe("suggestionsFor", () => {
  it("drops topics already asked", () => {
    expect(suggestionsFor(["what", "privacy"], "privacy")).toEqual([
      "practice",
      "access",
      "org",
      "news",
      "support",
    ]);
  });

  it("leads with the next steps straight after a practice moment", () => {
    expect(suggestionsFor(["practice"], "practiced").slice(0, 3)).toEqual([
      "again",
      "access",
      "signin",
    ]);
  });
});

describe("respond", () => {
  it("answers support with the fixed card", () => {
    expect(respond("support")).toContainEqual({ kind: "card", card: "support" });
  });

  it("opens a practice moment with Riya and three choices", () => {
    const entries = respond("practice");
    expect(entries.map(entry => entry.kind)).toEqual(["ally", "client", "choices"]);
  });

  it("follows a choice with Riya's reaction and the supervisor's feedback", () => {
    expect(practiceOutcome("b").map(entry => entry.kind)).toEqual([
      "user",
      "client",
      "feedback",
      "ally",
    ]);
  });
});
