/**
 * tollway.config.js
 *
 * This is the single file a developer edits to monetize their API.
 * Everything else is handled by the Tollway middleware.
 */

export default {
  // The Stellar address that receives USDC revenue.
  // Replace with your own address.
  payTo: process.env.STELLAR_PAY_TO || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",

  // Which Stellar network to settle on.
  // Use "stellar:testnet" for development, "stellar:pubnet" for production.
  network: process.env.STELLAR_NETWORK || "stellar:testnet",

  // Pricing per route.
  // Each key is "METHOD /path" — the same format Express uses.
  pricing: {
    // Static pricing: charge $0.002 per search request
    "GET /api/search": {
      price: "$0.002",
      description: "Search the dataset",
    },

    // Higher price for compute-intensive work
    "POST /api/generate": {
      price: "$0.01",
      description: "AI text generation",
    },

    // Dynamic pricing: charge based on request parameters
    "POST /api/analyze": (req) => {
      const depth = req.body?.depth || "shallow";
      return {
        price: depth === "deep" ? "$0.05" : "$0.01",
        description: `${depth} analysis`,
      };
    },

    // Explicitly free routes — no payment ever required
    "GET /api/status": "free",
    "GET /api/pricing": "free",
  },

  // Free tier: let new users try before they pay.
  // After exhausting the daily quota, the middleware returns 402.
  freeTier: {
    enabled: true,
    requestsPerDay: 50,
    identifyBy: "ip",
  },

  analytics: {
    enabled: true,
    logger: "console",
  },
};
