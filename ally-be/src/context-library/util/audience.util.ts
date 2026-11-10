import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * Who a chunk, or a document's chunks, reaches: every organisation, or only the ones named.
 * Organisation-scoped use cases (Ally guide, Debrief, Course Copilot) serve a learner the
 * global chunks plus their own organisation's; platform use cases see everything.
 */
export interface ClAudienceFields {
  isGlobal: boolean;
  tenantIds: string[];
}

export interface ClAudienceInput {
  isGlobal?: boolean;
  tenantIds?: string[] | null;
}

export const GLOBAL_AUDIENCE: ClAudienceFields = {
  isGlobal: true,
  tenantIds: [],
};

/**
 * One audience from what was asked for. Global wins and clears any names; "not global" must
 * name at least one organisation, because a chunk that reaches nobody is invisible to every
 * organisation-scoped search and nothing would say so. Asking for neither keeps `fallback`.
 */
export function resolveAudience(
  input: ClAudienceInput,
  fallback: ClAudienceFields = GLOBAL_AUDIENCE,
): ClAudienceFields {
  const tenantIds = [
    ...new Set((input.tenantIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ];
  if (input.isGlobal === true) return { isGlobal: true, tenantIds: [] };
  if (input.isGlobal === false && !tenantIds.length) {
    throw new BadRequestException(
      'Choose at least one organisation, or make it available to every organisation.',
    );
  }
  if (tenantIds.length) return { isGlobal: false, tenantIds };
  return { isGlobal: fallback.isGlobal, tenantIds: [...fallback.tenantIds] };
}

/** Whether the input asks to change the audience at all. */
export const asksForAudience = (input: ClAudienceInput): boolean =>
  input.isGlobal !== undefined || Boolean(input.tenantIds?.length);

/**
 * Whether everyone `inner` reaches also sees `outer`. Extraction merges a repeated idea into an
 * existing chunk only when this holds, so a document for one organisation never vanishes into
 * a chunk only another organisation can read, and a global document never into a targeted one.
 */
export function audienceCovers(
  outer: ClAudienceFields,
  inner: ClAudienceFields,
): boolean {
  if (outer.isGlobal) return true;
  if (inner.isGlobal) return false;
  const reach = new Set(outer.tenantIds ?? []);
  return (inner.tenantIds ?? []).every((id) => reach.has(id));
}

export const sameAudience = (a: ClAudienceFields, b: ClAudienceFields) =>
  a.isGlobal === b.isGlobal &&
  [...(a.tenantIds ?? [])].sort().join() ===
    [...(b.tenantIds ?? [])].sort().join();

/** Every named organisation must exist; an id that names nothing would reach nobody. */
export async function assertTenantsExist(
  manager: EntityManager,
  tenantIds: string[],
): Promise<void> {
  if (!tenantIds.length) return;
  const found: Array<{ id: string }> = await manager.query(
    `SELECT id::text AS id FROM tenants WHERE id::text = ANY($1::text[])`,
    [tenantIds],
  );
  const known = new Set(found.map((r) => r.id));
  const missing = tenantIds.filter((id) => !known.has(id));
  if (missing.length) {
    throw new BadRequestException(
      `No such organisation: ${missing.join(', ')}.`,
    );
  }
}
