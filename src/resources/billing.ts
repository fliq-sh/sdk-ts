import type { HttpClient } from "../client.js";
import { paginate } from "../pagination.js";
import type {
  BillingBalance,
  CheckoutResponse,
  CreditTransaction,
  CreditTransactionPage,
  ListTransactionsParams,
} from "../types.js";

export class Billing {
  constructor(private readonly http: HttpClient) {}

  /** Current credit balance, plan, and daily limit. */
  getBalance(): Promise<BillingBalance> {
    return this.http.get<BillingBalance>("/billing/balance");
  }

  /** Create a Stripe checkout session to top up `credits` credits. */
  createCheckout(credits: number): Promise<CheckoutResponse> {
    return this.http.post<CheckoutResponse>("/billing/checkout", { credits });
  }

  listTransactions(
    params: ListTransactionsParams = {},
  ): Promise<CreditTransactionPage> {
    return this.http.get<CreditTransactionPage>(
      "/billing/transactions",
      params,
    );
  }

  /** Iterate over every credit transaction, following `next_cursor`. */
  iterateTransactions(
    params: ListTransactionsParams = {},
  ): AsyncGenerator<CreditTransaction, void, unknown> {
    return paginate<CreditTransaction>(async (cursor) => {
      const page = await this.listTransactions({ ...params, cursor });
      return { items: page.transactions, next_cursor: page.next_cursor };
    });
  }
}
