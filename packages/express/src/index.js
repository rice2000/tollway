/**
 * @tollway/express
 *
 * Drop-in Express middleware for x402 monetization on Stellar.
 *
 * Usage:
 *   import { tollway } from "@tollway/express";
 *   app.use(tollway(config));
 *
 * This middleware:
 *   1. Parses the Tollway config
 *   2. For each incoming request, resolves the pricing decision
 *   3. If the route has a free tier and the caller hasn't exhausted it, passes through
 *   4. If payment is required, delegates to @x402/express middleware
 *   5. Emits analytics events for every request
 */

import {
  parseConfig,
  resolvePrice,
  createQuotaTracker,
  createAnalytics,
} from "@tollway/core";

/**
 * Create the Tollway Express middleware.
 *
 * @param {object} rawConfig — the developer's tollway.config export
 * @returns {function} Express middleware
 */
export function tollway(rawConfig) {
  const config = parseConfig(rawConfig);
  const quota = createQuotaTracker(config.freeTier);
  const analytics = createAnalytics(config.analytics);

  // Build the x402 route config map for @x402/express.
  // We'll dynamically decide per-request whether to enforce payment
  // (after free-tier checks), so we construct the x402 config for
  // all priced routes upfront.
  const x402RouteConfig = buildX402RouteConfig(config);

  // Lazy-load @x402/express — it's a peer dependency
  let x402Middleware = null;
  let x402Loaded = false;

  async function ensureX402Loaded() {
    if (x402Loaded) return;
    try {
      const { paymentMiddlewareFromConfig } = await import("@x402/express");
      const { HTTPFacilitatorClient } = await import("@x402/core/server");
      const { ExactStellarScheme } = await import("@x402/stellar/exact/server");

      x402Middleware = paymentMiddlewareFromConfig(
        x402RouteConfig,
        new HTTPFacilitatorClient({ url: config.facilitatorUrl }),
        [{ network: config.network, server: new ExactStellarScheme() }]
      );
      x402Loaded = true;
    } catch (err) {
      console.error(
        "[Tollway] Failed to load x402 dependencies. Install them:\n" +
          "  npm install @x402/core @x402/express @x402/stellar\n",
        err.message
      );
      throw err;
    }
  }

  // Return the middleware function
  return async function tollwayMiddleware(req, res, next) {
    const method = req.method;
    const path = req.path || req.url;

    // Resolve what this route should cost
    const decision = await resolvePrice(config, {
      method,
      path,
      req,
    });

    // Unpriced routes pass through untouched
    if (decision.action === "unpriced") {
      analytics.emit("request.unpriced", { route: `${method} ${path}` });
      return next();
    }

    // Free routes always pass through
    if (decision.action === "free") {
      analytics.emit("request.free", { route: `${method} ${path}` });
      return next();
    }

    // Paid route — check free tier first
    if (config.freeTier.enabled) {
      const reqInfo = {
        ip: req.ip || req.socket?.remoteAddress,
        walletAddress: extractWalletAddress(req),
        headers: req.headers,
      };

      const quotaResult = await quota.check(reqInfo);

      if (quotaResult.allowed) {
        // Free tier still has capacity — serve for free and record usage
        await quota.record(reqInfo);
        analytics.emit("request.free", {
          route: `${method} ${path}`,
          caller: quota.identifyCaller(reqInfo),
          remaining: quotaResult.remaining - 1,
        });

        // Attach tollway context to req for the developer's handler
        req.tollway = {
          paid: false,
          freeTier: true,
          remaining: quotaResult.remaining - 1,
        };

        return next();
      }

      // Free tier exhausted — fall through to x402 payment
      analytics.emit("request.blocked", {
        route: `${method} ${path}`,
        caller: quota.identifyCaller(reqInfo),
        priceUsd: decision.priceUsd,
      });
    }

    // Payment required — delegate to x402 middleware
    await ensureX402Loaded();

    // Wrap x402's next to attach tollway context on success
    const originalNext = next;
    const wrappedNext = (err) => {
      if (!err) {
        // Payment succeeded — the x402 middleware called next()
        req.tollway = {
          paid: true,
          freeTier: false,
          priceUsd: decision.priceUsd,
          route: decision.matchedRoute,
        };
        analytics.emit("request.paid", {
          route: `${method} ${path}`,
          priceUsd: decision.priceUsd,
        });
      }
      originalNext(err);
    };

    x402Middleware(req, res, wrappedNext);
  };
}

/**
 * Build the route config object that @x402/express expects.
 *
 * x402 expects: { "GET /path": { accepts: { scheme, price, network, payTo } } }
 */
function buildX402RouteConfig(config) {
  const routes = {};

  for (const [route, entry] of Object.entries(config.pricing)) {
    if (entry.type === "free") continue;

    if (entry.type === "static") {
      routes[route] = {
        accepts: {
          scheme: "exact",
          price: `$${entry.price}`,
          network: config.network,
          payTo: config.payTo,
        },
        description: entry.description,
      };
    }

    // Dynamic pricing routes still need a placeholder in the x402 config.
    // We'll handle the actual price resolution in our middleware layer,
    // but x402 needs to know the route exists.
    if (entry.type === "dynamic") {
      routes[route] = {
        accepts: {
          scheme: "exact",
          price: "$0.01", // placeholder — overridden per-request
          network: config.network,
          payTo: config.payTo,
        },
      };
    }
  }

  return routes;
}

/**
 * Try to extract a wallet address from an x402 payment header.
 * Used for quota identification when identifyBy === "wallet".
 */
function extractWalletAddress(req) {
  // x402 v2 puts the payment payload in the PAYMENT-SIGNATURE header.
  // The wallet address is embedded in the signed auth entry.
  // For free-tier tracking we just need a stable identifier —
  // we can extract it from the base64-decoded payload if present.
  const paymentHeader =
    req.headers["payment-signature"] ||
    req.headers["x-payment"] ||
    req.headers["x-402-payment"];

  if (!paymentHeader) return null;

  try {
    // The payment header is base64-encoded JSON with a payload.authorization
    // that contains the signer's address. This is a best-effort extraction.
    const decoded = JSON.parse(
      Buffer.from(paymentHeader, "base64").toString("utf-8")
    );
    return decoded?.payload?.authorization?.from ||
           decoded?.payload?.signer ||
           decoded?.from ||
           null;
  } catch {
    return null;
  }
}

export default tollway;
