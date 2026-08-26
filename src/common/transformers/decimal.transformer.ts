import { ValueTransformer } from 'typeorm';

/**
 * PostgreSQL returns `numeric` columns as strings to avoid precision loss.
 * Money values in this application fit comfortably in a JS number, so they are
 * converted back on read to keep the entity types honest.
 */
export const decimalTransformer: ValueTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};
