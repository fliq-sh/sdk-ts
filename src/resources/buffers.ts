import type { HttpClient } from "../client.js";
import { generateIdempotencyKey } from "../idempotency.js";
import { paginate } from "../pagination.js";
import type {
  Buffer,
  BufferItem,
  BufferItemPage,
  BufferPage,
  BufferStats,
  CreateBufferInput,
  ListBufferItemsParams,
  ListBuffersParams,
  PushBufferItemInput,
} from "../types.js";

export class Buffers {
  constructor(private readonly http: HttpClient) {}

  create(input: CreateBufferInput): Promise<Buffer> {
    return this.http.post<Buffer>("/buffers", input);
  }

  get(id: string): Promise<Buffer> {
    return this.http.get<Buffer>(`/buffers/${encodeURIComponent(id)}`);
  }

  list(params: ListBuffersParams = {}): Promise<BufferPage> {
    return this.http.get<BufferPage>("/buffers", params);
  }

  pause(id: string): Promise<void> {
    return this.http.post<void>(`/buffers/${encodeURIComponent(id)}/pause`);
  }

  resume(id: string): Promise<void> {
    return this.http.post<void>(`/buffers/${encodeURIComponent(id)}/resume`);
  }

  delete(id: string): Promise<void> {
    return this.http.delete<void>(`/buffers/${encodeURIComponent(id)}`);
  }

  /** Per-buffer item status breakdown — server-aggregated (not page-limited). */
  stats(bufferId: string): Promise<BufferStats> {
    return this.http.get<BufferStats>(
      `/buffers/${encodeURIComponent(bufferId)}/stats`,
    );
  }

  /**
   * Enqueue an item onto a buffer. If `idempotency_key` is omitted the SDK
   * generates one (`crypto.randomUUID()`) so retrying this call is safe.
   */
  pushItem(
    bufferId: string,
    input: PushBufferItemInput = {},
  ): Promise<BufferItem> {
    const body: PushBufferItemInput = {
      ...input,
      idempotency_key: input.idempotency_key ?? generateIdempotencyKey(),
    };
    return this.http.post<BufferItem>(
      `/buffers/${encodeURIComponent(bufferId)}/items`,
      body,
    );
  }

  listItems(
    bufferId: string,
    params: ListBufferItemsParams = {},
  ): Promise<BufferItemPage> {
    return this.http.get<BufferItemPage>(
      `/buffers/${encodeURIComponent(bufferId)}/items`,
      params,
    );
  }

  getItem(bufferId: string, itemId: string): Promise<BufferItem> {
    return this.http.get<BufferItem>(
      `/buffers/${encodeURIComponent(bufferId)}/items/${encodeURIComponent(itemId)}`,
    );
  }

  /**
   * Re-run a permanently-failed item. Clones it onto the tail of the buffer so
   * it drains in order after the current queue. Throws `ConflictError` (409) if
   * the item isn't failed.
   */
  replayItem(bufferId: string, itemId: string): Promise<BufferItem> {
    return this.http.post<BufferItem>(
      `/buffers/${encodeURIComponent(bufferId)}/items/${encodeURIComponent(itemId)}/replay`,
    );
  }

  /** Iterate over every buffer, transparently following `next_cursor`. */
  iterate(
    params: ListBuffersParams = {},
  ): AsyncGenerator<Buffer, void, unknown> {
    return paginate<Buffer>(async (cursor) => {
      const page = await this.list({ ...params, cursor });
      return { items: page.buffers, next_cursor: page.next_cursor };
    });
  }

  /** Iterate over every item in a buffer, following `next_cursor`. */
  iterateItems(
    bufferId: string,
    params: ListBufferItemsParams = {},
  ): AsyncGenerator<BufferItem, void, unknown> {
    return paginate<BufferItem>(async (cursor) => {
      const page = await this.listItems(bufferId, { ...params, cursor });
      return { items: page.items, next_cursor: page.next_cursor };
    });
  }
}
