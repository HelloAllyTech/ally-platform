import { ValueTransformer } from 'typeorm';

/** Postgres `numeric` comes back as a string; money and prices are read as numbers. */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
