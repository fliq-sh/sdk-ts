import type { HttpClient } from "../client.js";
import { generateIdempotencyKey } from "../idempotency.js";
import { paginate } from "../pagination.js";
import type {
  CreateJobInput,
  CreateJobResponse,
  Job,
  JobAttempt,
  JobPage,
  ListJobsParams,
  ReplayJobResponse,
} from "../types.js";

export class Jobs {
  constructor(private readonly http: HttpClient) {}

  /**
   * Schedule a job. If `idempotency_key` is omitted the SDK generates one
   * (`crypto.randomUUID()`) so retrying this call is safe by default.
   */
  create(input: CreateJobInput): Promise<CreateJobResponse> {
    const body: CreateJobInput = {
      ...input,
      idempotency_key: input.idempotency_key ?? generateIdempotencyKey(),
    };
    return this.http.post<CreateJobResponse>("/jobs", body);
  }

  get(id: string): Promise<Job> {
    return this.http.get<Job>(`/jobs/${encodeURIComponent(id)}`);
  }

  list(params: ListJobsParams = {}): Promise<JobPage> {
    return this.http.get<JobPage>("/jobs", params);
  }

  /** Cancel a pending job. */
  cancel(id: string): Promise<void> {
    return this.http.delete<void>(`/jobs/${encodeURIComponent(id)}`);
  }

  /**
   * Re-run a permanently-failed job. Clones it into a fresh pending job (passes
   * the same credit gate as a create). Throws `ConflictError` (409) if the job
   * isn't failed, `InsufficientCreditsError` (402) if out of credits.
   */
  replay(id: string): Promise<ReplayJobResponse> {
    return this.http.post<ReplayJobResponse>(
      `/jobs/${encodeURIComponent(id)}/replay`,
    );
  }

  listAttempts(id: string): Promise<JobAttempt[]> {
    return this.http.get<JobAttempt[]>(
      `/jobs/${encodeURIComponent(id)}/attempts`,
    );
  }

  /**
   * Iterate over every job matching `params`, transparently following
   * `next_cursor`. e.g. `for await (const job of fliq.jobs.iterate({ status: "failed" }))`.
   */
  iterate(params: ListJobsParams = {}): AsyncGenerator<Job, void, unknown> {
    return paginate<Job>(async (cursor) => {
      const page = await this.list({ ...params, cursor });
      return { items: page.jobs, next_cursor: page.next_cursor };
    });
  }
}
