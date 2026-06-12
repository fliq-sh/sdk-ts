import type { QueryParams } from "./client.js";

/** A single page of a cursor-paginated list endpoint. */
export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * Drive an async iterator over a cursor-paginated endpoint. `fetchPage` is
 * called with the current cursor (undefined for the first page) and must return
 * the items plus the next cursor. Iteration stops when `next_cursor` is null.
 */
export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>,
): AsyncGenerator<T, void, unknown> {
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    for (const item of page.items) yield item;
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
}

/** Merge a cursor into a params object for the next page request. */
export function withCursor(
  params: QueryParams,
  cursor: string | undefined,
): QueryParams {
  return cursor === undefined ? params : { ...params, cursor };
}
