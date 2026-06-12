import type { HttpClient } from "../client.js";
import { paginate } from "../pagination.js";
import type {
  CreateScheduleInput,
  Job,
  JobPage,
  ListJobsParams,
  ListSchedulesParams,
  Schedule,
  SchedulePage,
} from "../types.js";

export class Schedules {
  constructor(private readonly http: HttpClient) {}

  create(input: CreateScheduleInput): Promise<Schedule> {
    return this.http.post<Schedule>("/schedules", input);
  }

  get(id: string): Promise<Schedule> {
    return this.http.get<Schedule>(`/schedules/${encodeURIComponent(id)}`);
  }

  list(params: ListSchedulesParams = {}): Promise<SchedulePage> {
    return this.http.get<SchedulePage>("/schedules", params);
  }

  pause(id: string): Promise<void> {
    return this.http.post<void>(`/schedules/${encodeURIComponent(id)}/pause`);
  }

  resume(id: string): Promise<void> {
    return this.http.post<void>(`/schedules/${encodeURIComponent(id)}/resume`);
  }

  delete(id: string): Promise<void> {
    return this.http.delete<void>(`/schedules/${encodeURIComponent(id)}`);
  }

  /** List the jobs spawned by a schedule. */
  listJobs(id: string, params: ListJobsParams = {}): Promise<JobPage> {
    return this.http.get<JobPage>(
      `/schedules/${encodeURIComponent(id)}/jobs`,
      params,
    );
  }

  /** Iterate over every schedule, transparently following `next_cursor`. */
  iterate(
    params: ListSchedulesParams = {},
  ): AsyncGenerator<Schedule, void, unknown> {
    return paginate<Schedule>(async (cursor) => {
      const page = await this.list({ ...params, cursor });
      return { items: page.schedules, next_cursor: page.next_cursor };
    });
  }

  /** Iterate over every job spawned by a schedule, following `next_cursor`. */
  iterateJobs(
    id: string,
    params: ListJobsParams = {},
  ): AsyncGenerator<Job, void, unknown> {
    return paginate<Job>(async (cursor) => {
      const page = await this.listJobs(id, { ...params, cursor });
      return { items: page.jobs, next_cursor: page.next_cursor };
    });
  }
}
