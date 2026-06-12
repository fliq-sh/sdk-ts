import type { HttpClient } from "../client.js";
import type { APIToken, CreateTokenResponse } from "../types.js";

export class Tokens {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<APIToken[]> {
    return this.http.get<APIToken[]>("/tokens");
  }

  /**
   * Create a new API token. The raw token is returned once in
   * `response.token` and is never retrievable again.
   */
  create(name: string): Promise<CreateTokenResponse> {
    return this.http.post<CreateTokenResponse>("/tokens", { name });
  }

  revoke(id: string): Promise<void> {
    return this.http.delete<void>(`/tokens/${encodeURIComponent(id)}`);
  }
}
