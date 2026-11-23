import { describe, expect, it } from "vitest";

import { ChatbotMemberRole as R } from "@types";

import { chatbotAccess } from "../access";

describe("chatbotAccess", () => {
  it("falls back to the single myRole until the API sends the role set", () => {
    expect(chatbotAccess({ myRole: R.OWNER })).toMatchObject({
      build: true,
      converse: true,
      manage: true,
      responderOnly: false,
    });
    expect(chatbotAccess({ myRole: R.EDITOR })).toMatchObject({ build: true, manage: false });
    expect(chatbotAccess({ myRole: R.VIEWER })).toMatchObject({
      build: false,
      converse: false,
      manage: false,
    });
  });

  it("reads the role set when it is there", () => {
    expect(chatbotAccess({ myRole: R.VIEWER, myRoles: [R.RESPONDER, R.EDITOR] })).toMatchObject({
      build: true,
      converse: true,
      responderOnly: false,
    });
  });

  it("marks a Responder who holds nothing else, and only that", () => {
    expect(chatbotAccess({ myRole: R.RESPONDER })).toMatchObject({
      converse: true,
      build: false,
      manage: false,
      responderOnly: true,
    });
    expect(
      chatbotAccess({ myRole: R.RESPONDER, myRoles: [R.RESPONDER, R.VIEWER] }).responderOnly,
    ).toBe(false);
  });

  it("gives nothing to someone with no bot", () => {
    expect(chatbotAccess(undefined)).toMatchObject({
      build: false,
      converse: false,
      responderOnly: false,
    });
  });
});

describe("role sets", () => {
  it("reads a member's set in reading order, falling back to the single role", async () => {
    const { rolesOfMember, sortRoles } = await import("../access");
    expect(rolesOfMember({ role: "editor", roles: ["viewer", "owner", "bogus"] })).toEqual([
      "owner",
      "viewer",
    ]);
    expect(rolesOfMember({ role: "editor" })).toEqual(["editor"]);
    expect(sortRoles(undefined)).toEqual([]);
  });

  it("drives build, converse and manage from myRoles", () => {
    expect(chatbotAccess({ myRole: R.VIEWER, myRoles: [R.RESPONDER] })).toMatchObject({
      build: false,
      converse: true,
      manage: false,
    });
    expect(chatbotAccess({ myRole: R.VIEWER, myRoles: [R.OWNER, R.RESPONDER] })).toMatchObject({
      build: true,
      converse: true,
      manage: true,
    });
  });
});
