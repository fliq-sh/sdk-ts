import { HttpClient, type FliqOptions } from "./client.js";
import { Alerts } from "./resources/alerts.js";
import { Billing } from "./resources/billing.js";
import { Buffers } from "./resources/buffers.js";
import { Jobs } from "./resources/jobs.js";
import { Schedules } from "./resources/schedules.js";
import { Stats } from "./resources/stats.js";
import { Tokens } from "./resources/tokens.js";

/**
 * The Fliq client. Construct once with your API key and reuse it.
 *
 * ```ts
 * const fliq = new Fliq({ apiKey: "fliq_sk_..." });
 * await fliq.jobs.create({ url: "https://example.com/hook", method: "POST", scheduled_at: new Date().toISOString() });
 * ```
 */
export class Fliq {
  readonly jobs: Jobs;
  readonly schedules: Schedules;
  readonly buffers: Buffers;
  readonly alerts: Alerts;
  readonly stats: Stats;
  readonly billing: Billing;
  readonly tokens: Tokens;

  /** The underlying HTTP client — escape hatch for endpoints not yet wrapped. */
  readonly http: HttpClient;

  constructor(options: FliqOptions) {
    this.http = new HttpClient(options);
    this.jobs = new Jobs(this.http);
    this.schedules = new Schedules(this.http);
    this.buffers = new Buffers(this.http);
    this.alerts = new Alerts(this.http);
    this.stats = new Stats(this.http);
    this.billing = new Billing(this.http);
    this.tokens = new Tokens(this.http);
  }
}
