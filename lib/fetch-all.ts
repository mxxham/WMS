/**
 * Supabase (PostgREST) returns at most 1000 rows per request by default.
 * The warehouse has 2,570 bins, so list queries page through with .range().
 * `make(from, to)` must build a fresh query with a stable .order().
 */
export async function fetchAll<T>(
  make: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await make(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) return out;
  }
}
