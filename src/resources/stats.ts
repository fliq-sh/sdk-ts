import type { HttpClient } from "../client.js";
import type { JobStats, UsageSummary } from "../types.js";

export class Stats {
  constructor(private readonly http: HttpClient) {}

  /** Job execution aggregates over the last `days` (default 30, clamped [1,365]). */
  jobs(days?: number): Promise<JobStats> {
    return this.http.get<JobStats>("/stats/jobs", { days });
  }

  /** Daily usage buckets + balance over the last `days`. */
  usage(days?: number): Promise<UsageSummary> {
    return this.http.get<UsageSummary>("/stats/usage", { days });
  }
}
