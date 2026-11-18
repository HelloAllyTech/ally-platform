import { CustomFieldDefinition } from "@types";

/**
 * Reading stored select values. The web stores option ids (a JSON id array
 * for multi-select), but the mobile app saved option *labels* until 2026-11,
 * and released builds keep doing so. A label-stored value on an admin-created
 * field (uuid option ids) used to render as "—" here. These helpers accept
 * either form; a value matching no option is kept as-is, never hidden.
 */
type Options = Pick<CustomFieldDefinition, "options">;

export const resolveOptionId = (def: Options, raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const options = def.options ?? [];
  const byId = options.find(o => o.id === raw);
  if (byId) return byId.id;
  const lowered = raw.trim().toLowerCase();
  return options.find(o => o.label.trim().toLowerCase() === lowered)?.id ?? null;
};

export const optionLabel = (def: Options, raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const id = resolveOptionId(def, raw);
  return (id && def.options?.find(o => o.id === id)?.label) || raw;
};

const parseItems = (raw: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // A bare value (older builds): one item.
  }
  return [raw];
};

/** Multi-select: the stored items as option ids (unmatched items kept). */
export const resolveOptionIds = (def: Options, raw: string | null | undefined): string[] =>
  raw ? parseItems(raw).map(item => resolveOptionId(def, item) ?? item) : [];
