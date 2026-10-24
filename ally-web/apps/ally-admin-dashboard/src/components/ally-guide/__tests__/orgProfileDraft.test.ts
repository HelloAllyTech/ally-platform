import { describe, expect, it } from "vitest";

import { AllyGuideOrgProfileValue } from "@types";

import {
  DraftLine,
  draftFromProfile,
  emptyLine,
  isDraftDirty,
  profileFromDraft,
  validateDraft,
  validateLine,
} from "../orgProfileDraft";

const PROFILE: AllyGuideOrgProfileValue = {
  supportLines: {
    en: [
      {
        name: "Helpline",
        phone: "+91 98765 43210",
        hours: "9 to 6",
        url: "https://x.org",
        isCrisis: true,
      },
    ],
  },
  supervisorContact: "Dr Rao",
  supervisorWording: "Talk to your supervisor.",
  protocols: "Follow the protocol.",
  toneNotes: "Warm.",
  avoidTopics: ["politics"],
  outreachEnabled: false,
  emailEnabled: true,
};

describe("draftFromProfile / profileFromDraft", () => {
  it("round-trips a profile unchanged", () => {
    expect(profileFromDraft(draftFromProfile(PROFILE))).toEqual(PROFILE);
  });

  it("treats an empty profile as everything off-by-default except the two outreach flags", () => {
    const draft = draftFromProfile({});

    expect(draft.outreachEnabled).toBe(true);
    expect(draft.emailEnabled).toBe(true);
    expect(draft.supportLines.en).toEqual([]);
    expect(draft.avoidTopics).toEqual([]);
  });

  it("always sends the two outreach flags, because the server resets an omitted one to on", () => {
    const body = profileFromDraft(
      draftFromProfile({ outreachEnabled: false, emailEnabled: false }),
    );

    expect(body.outreachEnabled).toBe(false);
    expect(body.emailEnabled).toBe(false);
  });

  it("trims text and turns blanks into null so the server stores nothing for them", () => {
    const draft = draftFromProfile({});
    draft.supervisorContact = "   ";
    draft.protocols = "  steps  ";
    draft.avoidTopics = ["  a  ", "   "];

    const body = profileFromDraft(draft);

    expect(body.supervisorContact).toBeNull();
    expect(body.protocols).toBe("steps");
    expect(body.avoidTopics).toEqual(["a"]);
  });

  it("leaves a language with no lines out instead of sending an empty list", () => {
    const body = profileFromDraft(draftFromProfile(PROFILE));

    expect(Object.keys(body.supportLines ?? {})).toEqual(["en"]);
  });

  it("turns blank hours and link on a line into null", () => {
    const draft = draftFromProfile({});
    draft.supportLines.hi = [{ ...emptyLine(), name: "Line", phone: "100", hours: " ", url: "" }];

    expect(profileFromDraft(draft).supportLines?.hi).toEqual([
      { name: "Line", phone: "100", hours: null, url: null, isCrisis: false },
    ]);
  });
});

describe("isDraftDirty", () => {
  it("is false until something the server would store differs", () => {
    const baseline = draftFromProfile(PROFILE);
    const same = draftFromProfile(PROFILE);

    // Fresh line keys must not read as an edit.
    expect(isDraftDirty(same, baseline)).toBe(false);

    same.supervisorContact = "Dr Rao ";
    // Whitespace the server would trim is not a change.
    expect(isDraftDirty(same, baseline)).toBe(false);

    same.supervisorContact = "Dr Iyer";
    expect(isDraftDirty(same, baseline)).toBe(true);
  });

  it("notices a flag, a topic and a line being added", () => {
    const baseline = draftFromProfile(PROFILE);

    const flag = draftFromProfile(PROFILE);
    flag.emailEnabled = false;
    expect(isDraftDirty(flag, baseline)).toBe(true);

    const topic = draftFromProfile(PROFILE);
    topic.avoidTopics.push("religion");
    expect(isDraftDirty(topic, baseline)).toBe(true);

    const added = draftFromProfile(PROFILE);
    added.supportLines.en.push({ ...emptyLine(), name: "Another", phone: "100" });
    expect(isDraftDirty(added, baseline)).toBe(true);
  });
});

describe("validateLine (the server's rules, applied before a save)", () => {
  const base: DraftLine = { ...emptyLine(), name: "Helpline", phone: "+91 98765 43210" };

  it("accepts a name and a phone number", () => {
    expect(validateLine(base)).toEqual({});
  });

  it("requires a name and a phone number", () => {
    expect(validateLine({ ...base, name: "  " })).toEqual({ name: "nameRequired" });
    expect(validateLine({ ...base, phone: "" })).toEqual({ phone: "phoneRequired" });
  });

  it("rejects a phone number the server would reject", () => {
    expect(validateLine({ ...base, phone: "call me" })).toEqual({ phone: "phoneInvalid" });
    expect(validateLine({ ...base, phone: "12" })).toEqual({ phone: "phoneInvalid" });
    expect(validateLine({ ...base, phone: "080 2222 3333" })).toEqual({});
    expect(validateLine({ ...base, phone: "1-800-891-4416" })).toEqual({});
    // ally-be now accepts a leading bracket, the common way to write an Indian landline.
    expect(validateLine({ ...base, phone: "(080) 2222-3333" })).toEqual({});
    // Anything else must still start with a digit or +.
    expect(validateLine({ ...base, phone: ") 2222 3333" })).toEqual({ phone: "phoneInvalid" });
    expect(validateLine({ ...base, phone: "-2222 3333" })).toEqual({ phone: "phoneInvalid" });
  });

  it("allows an empty link but not one that is not http or https", () => {
    expect(validateLine({ ...base, url: "" })).toEqual({});
    expect(validateLine({ ...base, url: "https://example.org/help" })).toEqual({});
    expect(validateLine({ ...base, url: "javascript:alert(1)" })).toEqual({ url: "urlInvalid" });
    expect(validateLine({ ...base, url: "www.example.org" })).toEqual({ url: "urlInvalid" });
  });
});

describe("validateDraft", () => {
  it("reports errors by line key across every language, and nothing for a clean draft", () => {
    const draft = draftFromProfile(PROFILE);
    expect(validateDraft(draft)).toEqual({});

    const bad = { ...emptyLine(), name: "", phone: "x" };
    draft.supportLines.ta = [bad];

    expect(validateDraft(draft)[bad.key]).toEqual({
      name: "nameRequired",
      phone: "phoneInvalid",
    });
  });
});
