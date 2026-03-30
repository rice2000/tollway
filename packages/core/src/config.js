/**
 * @tollway/core — config.js
 *
 * Defines the Tollway configuration schema.
 * A developer's config file is the single source of truth for how their
 * API/MCP server is monetized.
 *
 * Example config:
 *
 *   export default {
 *     payTo: "G...",
 *     network: "stellar:pubnet",
 *     facilitatorUrl: "https://channels.openzeppelin.com/x402",
 *     pricing: {
 *       "GET /api/search": { price: "$0.002" },
 *       "POST /api/generate": { price: "$0.01" },
 *       "GET /api/status": "free",
 *     },
 *     freeTier: {
 *       enabled: true,
 *       requestsPerDay: 100,
 *       identifyBy: "wallet",  // "wallet" | "ip"
 *     },
 *   }
 */

const VALID_NETWORKS = [
  "stellar:testnet",
  "stellar:pubnet",
];

const DEFAULT_FACILITATOR_URLS = {
  "stellar:testnet": "https://channels.openzeppelin.com/x402/testnet",
  "stellar:pubnet": "https://channels.openzeppelin.com/x402",
};

/**
 * Normalize and validate a Tollway config object.
 * Throws descriptive errors for anything misconfigured.
 *
 * @param {object} raw — the developer's config export
 * @returns {object} normalized config
 */
export function parseConfig(raw) {
  if (!raw || typeof raw !== "object") {
    throw new ConfigError("Config must be a non-null object.");
  }

  const config = { ...raw };

  // --- payTo ---
  if (!config.payTo || typeof config.payTo !== "string") {
    throw new ConfigError(
      "config.payTo is required — set it to the Stellar address that receives revenue."
    );
  }
  if (!config.payTo.startsWith("G") || config.payTo.length !== 56) {
    throw new ConfigError(
      `config.payTo "${config.payTo}" doesn't look like a valid Stellar public key (should start with G and be 56 chars).`
    );
  }

  // --- network ---
  config.network = config.network || "stellar:testnet";
  if (!VALID_NETWORKS.includes(config.network)) {
    throw new ConfigError(
      `config.network "${config.network}" is not supported. Use one of: ${VALID_NETWORKS.join(", ")}`
    );
  }

  // --- facilitatorUrl ---
  config.facilitatorUrl =
    config.facilitatorUrl || DEFAULT_FACILITATOR_URLS[config.network];

  // --- pricing ---
  if (!config.pricing || typeof config.pricing !== "object") {
    throw new ConfigError(
      'config.pricing is required — define at least one route, e.g. { "GET /api/data": { price: "$0.01" } }'
    );
  }
  config.pricing = normalizePricing(config.pricing);

  // --- freeTier ---
  config.freeTier = normalizeFreeTier(config.freeTier);

  // --- analytics ---
  config.analytics = normalizeAnalytics(config.analytics);

  return Object.freeze(config);
}

/**
 * Normalize the pricing map.
 * Accepts:
 *   - { "GET /path": { price: "$0.01" } }             → static price
 *   - { "GET /path": "free" }                          → free route
 *   - { "GET /path": (req) => ({ price: "$0.05" }) }   → dynamic pricing
 *
 * Returns a map of route keys → { type, price?, priceFn?, description? }
 */
function normalizePricing(pricing) {
  const normalized = {};

  for (const [route, value] of Object.entries(pricing)) {
    // Validate route format: "METHOD /path"
    if (!/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\//.test(route)) {
      throw new ConfigError(
        `Pricing route "${route}" must be in "METHOD /path" format, e.g. "GET /api/data".`
      );
    }

    if (value === "free") {
      normalized[route] = { type: "free" };
    } else if (typeof value === "function") {
      normalized[route] = { type: "dynamic", priceFn: value };
    } else if (value && typeof value === "object" && value.price) {
      normalized[route] = {
        type: "static",
        price: parsePriceString(value.price),
        description: value.description || undefined,
      };
    } else {
      throw new ConfigError(
        `Pricing for "${route}" must be "free", a function, or an object with { price: "$X.XX" }.`
      );
    }
  }

  return normalized;
}

/**
 * Parse a human-readable price string like "$0.01" into a numeric USD value.
 * The x402 Stellar SDK also accepts this format natively.
 */
export function parsePriceString(str) {
  if (typeof str === "number") return str;
  if (typeof str !== "string") {
    throw new ConfigError(`Price must be a string like "$0.01" or a number. Got: ${typeof str}`);
  }

  const cleaned = str.replace(/^\$/, "").trim();
  const num = parseFloat(cleaned);

  if (isNaN(num) || num < 0) {
    throw new ConfigError(`Invalid price "${str}". Use a format like "$0.01" or "0.01".`);
  }

  return num;
}

function normalizeFreeTier(freeTier) {
  if (!freeTier || freeTier.enabled === false) {
    return { enabled: false };
  }

  return {
    enabled: true,
    requestsPerDay: freeTier.requestsPerDay ?? 100,
    identifyBy: freeTier.identifyBy ?? "wallet",
  };
}

function normalizeAnalytics(analytics) {
  if (!analytics) {
    return { enabled: true, logger: "console" };
  }
  return {
    enabled: analytics.enabled !== false,
    logger: analytics.logger || "console",
    webhookUrl: analytics.webhookUrl || undefined,
  };
}

export class ConfigError extends Error {
  constructor(message) {
    super(`[Tollway] ${message}`);
    this.name = "TollwayConfigError";
  }
}
