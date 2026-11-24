import { ChatbotCapability, ChatbotMemberRole } from '../../enum/chatbot.enum';
import {
  can,
  capabilityForLegacyRole,
  isResponderOnly,
  legacyRole,
  normaliseRoles,
  rolesFromInput,
  rolesOfRow,
} from '../chatbot-roles';

const { OWNER, EDITOR, RESPONDER, VIEWER } = ChatbotMemberRole;

/** Stage 1b: roles are a set; capabilities, not a ladder; the old column is a dual-write view. */
describe('chatbot roles as a set', () => {
  it('a responder responds and views, and never builds or manages people', () => {
    expect(can([RESPONDER], ChatbotCapability.RESPOND)).toBe(true);
    expect(can([RESPONDER], ChatbotCapability.VIEW)).toBe(true);
    expect(can([RESPONDER], ChatbotCapability.BUILD)).toBe(false);
    expect(can([RESPONDER], ChatbotCapability.MANAGE_PEOPLE)).toBe(false);
  });

  it('owners and editors respond; viewers do not', () => {
    expect(can([OWNER], ChatbotCapability.RESPOND)).toBe(true);
    expect(can([EDITOR], ChatbotCapability.RESPOND)).toBe(true);
    expect(can([VIEWER], ChatbotCapability.RESPOND)).toBe(false);
    expect(can([VIEWER, RESPONDER], ChatbotCapability.RESPOND)).toBe(true);
  });

  it('writes the highest of the set on the old ladder; responder-only is viewer', () => {
    expect(legacyRole([RESPONDER])).toBe(VIEWER);
    expect(legacyRole([VIEWER, RESPONDER])).toBe(VIEWER);
    expect(legacyRole([EDITOR, RESPONDER])).toBe(EDITOR);
    expect(legacyRole([RESPONDER, OWNER])).toBe(OWNER);
  });

  it('the old assert(min) means the capability it always meant', () => {
    expect(capabilityForLegacyRole(VIEWER)).toBe(ChatbotCapability.VIEW);
    expect(capabilityForLegacyRole(EDITOR)).toBe(ChatbotCapability.BUILD);
    expect(capabilityForLegacyRole(OWNER)).toBe(
      ChatbotCapability.MANAGE_PEOPLE,
    );
  });

  it('normalises: dedupes, lower-cases, drops unknown names, canonical order', () => {
    expect(
      normaliseRoles(['viewer', 'OWNER', 'owner', 'admin', 'responder']),
    ).toEqual([OWNER, RESPONDER, VIEWER]);
  });

  it('reads a row an old instance wrote (no roles) from its single role', () => {
    expect(rolesOfRow({ role: 'editor', roles: null })).toEqual([EDITOR]);
    expect(rolesOfRow({ role: 'viewer', roles: [] })).toEqual([VIEWER]);
    expect(rolesOfRow({ role: 'viewer', roles: '{responder,viewer}' })).toEqual(
      [RESPONDER, VIEWER],
    );
    expect(rolesOfRow({ role: 'owner', roles: ['owner'] })).toEqual([OWNER]);
  });

  it('takes the new roles[] or the old single role from the API', () => {
    expect(rolesFromInput({ role: EDITOR })).toEqual([EDITOR]);
    expect(rolesFromInput({ role: OWNER, roles: [RESPONDER] })).toEqual([
      RESPONDER,
    ]);
    expect(rolesFromInput({})).toEqual([]);
  });

  it('only a responder with no viewing role is gated on reading threads', () => {
    expect(isResponderOnly([RESPONDER])).toBe(true);
    expect(isResponderOnly([RESPONDER, VIEWER])).toBe(false);
    expect(isResponderOnly([EDITOR, RESPONDER])).toBe(false);
    expect(isResponderOnly([VIEWER])).toBe(false);
  });
});
