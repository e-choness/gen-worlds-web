// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Data files use snake_case keys (the data-file convention); TypeScript uses camelCase. Loaders
 * convert once here. Only keys change: string values such as ids stay exactly as written.
 */
export function camelizeKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

/** Deep copy of `value` with every object key converted. The caller states the resulting type. */
export function camelize<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => camelize<unknown>(item)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[camelizeKey(key)] = camelize<unknown>(item);
    return out as T;
  }
  return value as T;
}

/** Builds an id → record lookup and fails loudly on duplicates, which would silently shadow data. */
export function indexById<T extends { id: string }>(records: readonly T[], what: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const record of records) {
    if (map.has(record.id)) throw new Error(`Duplicate ${what} id "${record.id}" in the data files.`);
    map.set(record.id, record);
  }
  return map;
}
