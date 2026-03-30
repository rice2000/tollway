/**
 * @tollway/core — pricing.js
 *
 * The pricing engine resolves what to charge for a given incoming request.
 * It matches the request method + path against the config's pricing map,
 * handles dynamic pricing functions, and returns a pricing decision.
 */

/**
 * @typedef {Object} PricingDecision
 * @property {"free"|"paid"|"unpriced"} action
 * @property {number} [priceUsd]        — USD amount (only when action === "paid")
 * @property {string} [priceString]     — human-readable, e.g. "$0.01"
 * @property {string} [description]     — optional description for the 402 response
 * @property {string} [matchedRoute]    — the config route key that matched
 */

/**
 * Resolve the price for an incoming request.
 *
 * @param {object} config — parsed Tollway config
 * @param {object} reqInfo — { method: string, path: string, req?: express.Request }
 * @returns {Promise<PricingDecision>}
 */
export async function resolvePrice(config, reqInfo) {
  const { method, path } = reqInfo;
  const routeKey = `${method.toUpperCase()} ${path}`;

  // Try exact match first
  let entry = config.pricing[routeKey];

  // If no exact match, try pattern matching (prefix match for parameterized routes)
  if (!entry) {
    entry = findMatchingRoute(config.pricing, method, path);
  }

  // No pricing entry at all — this route isn't monetized
  if (!entry) {
    return { action: "unpriced" };
  }

  if (entry.type === "free") {
    return { action: "free", matchedRoute: routeKey };
  }

  if (entry.type === "static") {
    return {
      action: "paid",
      priceUsd: entry.price,
      priceString: `$${entry.price}`,
      description: entry.description,
      matchedRoute: entry._routeKey || routeKey,
    };
  }

  if (entry.type === "dynamic") {
    try {
      const result = await entry.priceFn(reqInfo.req || reqInfo);
      if (result === "free" || result?.price === "free") {
        return { action: "free", matchedRoute: routeKey };
      }
      const price = typeof result === "object" ? result.price : result;
      const priceUsd = typeof price === "string"
        ? parseFloat(price.replace(/^\$/, ""))
        : price;
      return {
        action: "paid",
        priceUsd,
        priceString: `$${priceUsd}`,
        description: result?.description,
        matchedRoute: routeKey,
      };
    } catch (err) {
      // Dynamic pricing function threw — fail open (don't charge, let request through)
      // but log the error. Developers should know their pricing fn is broken.
      console.error(`[Tollway] Dynamic pricing function threw for ${routeKey}:`, err);
      return { action: "unpriced" };
    }
  }

  return { action: "unpriced" };
}

/**
 * Find a matching route using prefix/glob matching.
 * Supports:
 *   - Exact: "GET /api/search" matches GET /api/search
 *   - Prefix with wildcard: "GET /api/users/*" matches GET /api/users/123
 *   - Simple parameterized: "GET /api/users/:id" matches GET /api/users/123
 */
function findMatchingRoute(pricing, method, path) {
  const upperMethod = method.toUpperCase();

  for (const [routeKey, entry] of Object.entries(pricing)) {
    const spaceIdx = routeKey.indexOf(" ");
    const routeMethod = routeKey.slice(0, spaceIdx).toUpperCase();
    const routePath = routeKey.slice(spaceIdx + 1);

    if (routeMethod !== upperMethod) continue;

    // Wildcard match: "GET /api/*"
    if (routePath.endsWith("/*")) {
      const prefix = routePath.slice(0, -2);
      if (path === prefix || path.startsWith(prefix + "/")) {
        return { ...entry, _routeKey: routeKey };
      }
    }

    // Parameterized match: "GET /api/users/:id"
    if (routePath.includes(":")) {
      const routeParts = routePath.split("/");
      const pathParts = path.split("/");
      if (routeParts.length === pathParts.length) {
        const matches = routeParts.every(
          (part, i) => part.startsWith(":") || part === pathParts[i]
        );
        if (matches) {
          return { ...entry, _routeKey: routeKey };
        }
      }
    }
  }

  return null;
}
