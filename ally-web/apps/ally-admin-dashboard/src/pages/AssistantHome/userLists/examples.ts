import type { ReadyMadeCatalogue, UserList } from "@types";

/**
 * A ready-made list's "your services" choice that still holds its example values, so the list
 * asks the owner to replace them (chunk 5b). Null once they've changed any of them.
 */
export const exampleOptions = (
  list: UserList,
  catalogue: ReadyMadeCatalogue | undefined,
): { field: string; label: string } | null => {
  for (const group of catalogue?.groups ?? []) {
    for (const item of group.items) {
      for (const need of item.needs_options) {
        if (need.list !== list.key) continue;
        const field = list.fields.find(f => f.key === need.field && !f.archived_at);
        const values = field?.options.values ?? [];
        if (
          field &&
          values.length === need.examples.length &&
          values.every((v, i) => v === need.examples[i])
        ) {
          return { field: field.key, label: field.label };
        }
      }
    }
  }
  return null;
};
