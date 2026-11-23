/** Postgres returns `numeric` as a string; read it back as a number. */
export const numericColumn = {
  to: (value?: number | null) => value ?? null,
  from: (value?: string | null) =>
    value === null || value === undefined ? null : parseFloat(value),
};
