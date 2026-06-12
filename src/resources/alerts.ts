import type { HttpClient } from "../client.js";
import type {
  AlertChannel,
  AlertChannelList,
  CreateAlertChannelInput,
} from "../types.js";

export class Alerts {
  constructor(private readonly http: HttpClient) {}

  /** List alert channels. */
  async list(): Promise<AlertChannel[]> {
    const res = await this.http.get<AlertChannelList>("/alerts");
    return res.channels;
  }

  get(id: string): Promise<AlertChannel> {
    return this.http.get<AlertChannel>(`/alerts/${encodeURIComponent(id)}`);
  }

  create(input: CreateAlertChannelInput): Promise<AlertChannel> {
    return this.http.post<AlertChannel>("/alerts", input);
  }

  setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.http.patch<void>(`/alerts/${encodeURIComponent(id)}`, {
      enabled,
    });
  }

  delete(id: string): Promise<void> {
    return this.http.delete<void>(`/alerts/${encodeURIComponent(id)}`);
  }
}
