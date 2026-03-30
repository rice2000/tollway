/**
 * @tollway/core — analytics.js
 *
 * Collects and emits events for every request that flows through Tollway.
 * In v0.1, this logs to console. Designed to be pluggable — a future hosted
 * dashboard service would receive these events via webhook.
 *
 * Events emitted:
 *   - request.free       — free-tier request served
 *   - request.paid       — paid request settled
 *   - request.blocked    — free tier exhausted, 402 returned
 *   - request.unpriced   — route not in pricing config, passed through
 *   - payment.settled    — on-chain settlement confirmed
 *   - payment.failed     — settlement failed
 */

/**
 * Create an analytics collector from config.
 *
 * @param {object} analyticsConfig — normalized analytics config
 * @returns {AnalyticsCollector}
 */
export function createAnalytics(analyticsConfig) {
  return new AnalyticsCollector(analyticsConfig);
}

class AnalyticsCollector {
  constructor(config) {
    this.enabled = config?.enabled !== false;
    this.logger = config?.logger || "console";
    this.webhookUrl = config?.webhookUrl;
    this._listeners = new Map();
  }

  /**
   * Emit an event with a data payload.
   *
   * @param {string} event
   * @param {object} data
   */
  emit(event, data) {
    if (!this.enabled) return;

    const enriched = {
      event,
      timestamp: new Date().toISOString(),
      ...data,
    };

    // Console logger
    if (this.logger === "console") {
      const icon = EVENT_ICONS[event] || "📊";
      console.log(`${icon} [Tollway] ${event}`, formatForConsole(enriched));
    }

    // Webhook (fire-and-forget, best-effort)
    if (this.webhookUrl) {
      this._sendWebhook(enriched).catch(() => {});
    }

    // Custom listeners
    const listeners = this._listeners.get(event) || [];
    for (const fn of listeners) {
      try {
        fn(enriched);
      } catch {
        // listener errors shouldn't break the request flow
      }
    }
  }

  /**
   * Register a listener for an event type.
   *
   * @param {string} event
   * @param {function} fn
   */
  on(event, fn) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(fn);
  }

  async _sendWebhook(data) {
    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // silent — webhook failures should never affect the request
    }
  }
}

const EVENT_ICONS = {
  "request.free": "🆓",
  "request.paid": "💰",
  "request.blocked": "🚫",
  "request.unpriced": "➡️",
  "payment.settled": "✅",
  "payment.failed": "❌",
};

function formatForConsole(data) {
  const { event, timestamp, ...rest } = data;
  // Compact single-line output for dev
  const parts = [];
  if (rest.route) parts.push(`route=${rest.route}`);
  if (rest.priceUsd !== undefined) parts.push(`price=$${rest.priceUsd}`);
  if (rest.caller) parts.push(`caller=${rest.caller}`);
  if (rest.remaining !== undefined) parts.push(`remaining=${rest.remaining}`);
  if (rest.txHash) parts.push(`tx=${rest.txHash.slice(0, 12)}...`);
  return parts.join(" | ");
}
