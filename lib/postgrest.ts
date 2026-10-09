/**
 * Values interpolated into a PostgREST filter string (`.or("a.eq.x,b.eq.y")`):
 * double-quoted and escaped so a comma, dot, parenthesis or quote inside the
 * value can never add or change a filter condition.
 */
export function pgrstValue(v: string): string {
  return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A list of ids for `col.in.(…)`, each quoted the same way. */
export function pgrstList(values: string[]): string {
  return values.map(pgrstValue).join(",");
}
