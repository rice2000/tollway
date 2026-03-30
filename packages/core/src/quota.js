/**
 * @tollway/core — quota.js
 *
 * Tracks per-caller usage against free tier quotas.
 * Uses an in-memory store by default (good for single-process).
 * Can be swapped for Redis/SQLite via a simple adapter interface.
 *
 * The quota tracker answers one question:
 *   "Has this caller exhausted their free tier for today?"
 */

/**
 * Create a quota tracker from the config's freeTier settings.
 *
 * @param {object} freeTierConfig — normalized freeTier from parseConfig
 * @param {object} [store] — optional external store adapter
 * @returns {QuotaTracker}
 */
export function createQuotaTracker(freeTierConfig, store) {
  if (!freeTierConfig?.enabled) {
    return new DisabledQuotaTracker();
  }
  return new QuotaTracker(freeTierConfig, store || new InMemoryStore());
}

class QuotaTracker {
  constructor(config, store) {
    this.requestsPerDay = config.requestsPerDay;
    this.identifyBy = config.identifyBy;
    this.store = store;
  }

  /**
   * Extract a caller identity from a request.
   * Uses wallet address if available (from x402 payment header),
   * falls back to IP address.
   *
   * @param {object} reqInfo — { ip?: string, walletAddress?: string, headers?: object }
   * @returns {string} caller identifier
   */
  identifyCaller(reqInfo) {
    if (this.identifyBy === "wallet" && reqInfo.walletAddress) {
      return `wallet:${reqInfo.walletAddress}`;
    }
    // Fall back to IP if wallet identification requested but no wallet present
    // (e.g. first request before any payment)
    const ip = reqInfo.ip || reqInfo.headers?.["x-forwarded-for"] || "unknown";
    return `ip:${ip}`;
  }

  /**
   * Check whether the caller still has free requests remaining today.
   *
   * @param {object} reqInfo
   * @returns {Promise<{ allowed: boolean, remaining: number, used: number }>}
   */
  async check(reqInfo) {
    const callerId = this.identifyCaller(reqInfo);
    const dayKey = todayKey();
    const used = await this.store.get(callerId, dayKey);

    return {
      allowed: used < this.requestsPerDay,
      remaining: Math.max(0, this.requestsPerDay - used),
      used,
    };
  }

  /**
   * Record a free-tier request for the caller.
   *
   * @param {object} reqInfo
   * @returns {Promise<void>}
   */
  async record(reqInfo) {
    const callerId = this.identifyCaller(reqInfo);
    const dayKey = todayKey();
    await this.store.increment(callerId, dayKey);
  }
}

/** No-op tracker when free tier is disabled */
class DisabledQuotaTracker {
  async check() {
    return { allowed: false, remaining: 0, used: 0 };
  }
  async record() {}
  identifyCaller() {
    return "disabled";
  }
}

/**
 * Simple in-memory store. Good for development and single-process servers.
 * Data resets on restart — which is fine for daily quotas in dev.
 *
 * Shape: Map<string, Map<string, number>>
 *   outer key = callerId, inner key = dayKey, value = count
 */
class InMemoryStore {
  constructor() {
    this.data = new Map();
    // Prune old days every hour to prevent memory growth
    this._pruneInterval = setInterval(() => this._prune(), 60 * 60 * 1000);
    // Allow the process to exit cleanly
    if (this._pruneInterval.unref) this._pruneInterval.unref();
  }

  async get(callerId, dayKey) {
    return this.data.get(callerId)?.get(dayKey) || 0;
  }

  async increment(callerId, dayKey) {
    if (!this.data.has(callerId)) {
      this.data.set(callerId, new Map());
    }
    const callerMap = this.data.get(callerId);
    callerMap.set(dayKey, (callerMap.get(dayKey) || 0) + 1);
  }

  _prune() {
    const today = todayKey();
    for (const [callerId, dayMap] of this.data) {
      for (const dayKey of dayMap.keys()) {
        if (dayKey !== today) dayMap.delete(dayKey);
      }
      if (dayMap.size === 0) this.data.delete(callerId);
    }
  }
}

/** Returns "2026-03-27" format for today in UTC */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export { InMemoryStore };
