// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Same method names as thetanuts-sdk src/modules/api.ts APIModule (fetchOrders,
// getMarketData), backed by feed.ts. fetchOrders returns Odette orders only.

import type { OdetteClient } from '../client.js';
import { fetchMarketData, fetchFeed, type FeedRead } from '../feed.js';
import { filterWhitelisted, type RejectReason } from '../whitelist.js';
import type { OdetteOrder } from '../types.js';

export class APIModule {
  constructor(private readonly client: OdetteClient) {}

  private feedOptions() {
    return {
      feedUrl: this.client.feedUrl,
      logger: this.client.logger,
      ...(this.client.fetch ? { fetch: this.client.fetch } : {}),
    };
  }

  /**
   * Fetch the orders the Odette web app lists now. Refused orders are counted
   * by reason and logged at warn, never returned.
   */
  async fetchOrders(now?: number): Promise<OdetteOrder[]> {
    const { orders } = await fetchFeed(this.feedOptions());
    const { accepted, rejected } = filterWhitelisted(orders, {
      enableSpreads: this.client.enableSpreads,
      ...(now !== undefined ? { now } : {}),
    });
    if (rejected.length > 0) {
      const byReason: Partial<Record<RejectReason, number>> = {};
      for (const r of rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
      this.client.logger.warn('Order feed entries are not Odette orders and were skipped', { count: rejected.length, byReason });
    }
    return accepted;
  }

  /** Every well-formed feed entry, before Odette's rules. For diagnostics only. */
  async fetchOrdersRaw(): Promise<FeedRead> {
    return fetchFeed(this.feedOptions());
  }

  /** Market prices from the order feed. A missing asset is absent, never 0. */
  async getMarketData(): Promise<{ prices: Record<string, number> }> {
    return fetchMarketData(this.feedOptions());
  }
}
