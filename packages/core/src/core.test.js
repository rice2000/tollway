import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, parsePriceString, ConfigError } from "./config.js";
import { resolvePrice } from "./pricing.js";
import { createQuotaTracker } from "./quota.js";

// --- Config tests ---

describe("parseConfig", () => {
  const validBase = {
    payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    network: "stellar:testnet",
    pricing: {
      "GET /api/search": { price: "$0.002" },
      "POST /api/generate": { price: "$0.01" },
      "GET /api/status": "free",
    },
  };

  it("parses a valid config", () => {
    const config = parseConfig(validBase);
    assert.equal(config.payTo, validBase.payTo);
    assert.equal(config.network, "stellar:testnet");
    assert.equal(config.facilitatorUrl, "https://channels.openzeppelin.com/testnet");
    assert.equal(config.pricing["GET /api/search"].type, "static");
    assert.equal(config.pricing["GET /api/search"].price, 0.002);
    assert.equal(config.pricing["GET /api/status"].type, "free");
  });

  it("defaults network to stellar:testnet", () => {
    const config = parseConfig({ ...validBase, network: undefined });
    assert.equal(config.network, "stellar:testnet");
  });

  it("rejects missing payTo", () => {
    assert.throws(
      () => parseConfig({ ...validBase, payTo: undefined }),
      (err) => err instanceof ConfigError
    );
  });

  it("rejects invalid payTo format", () => {
    assert.throws(
      () => parseConfig({ ...validBase, payTo: "not-a-stellar-key" }),
      (err) => err.message.includes("doesn't look like")
    );
  });

  it("rejects invalid network", () => {
    assert.throws(
      () => parseConfig({ ...validBase, network: "ethereum:mainnet" }),
      (err) => err.message.includes("not supported")
    );
  });

  it("rejects missing pricing", () => {
    assert.throws(
      () => parseConfig({ ...validBase, pricing: undefined }),
      (err) => err.message.includes("pricing is required")
    );
  });

  it("rejects malformed route keys", () => {
    assert.throws(
      () =>
        parseConfig({
          ...validBase,
          pricing: { "api/search": { price: "$0.01" } },
        }),
      (err) => err.message.includes("METHOD /path")
    );
  });

  it("accepts dynamic pricing functions", () => {
    const config = parseConfig({
      ...validBase,
      pricing: {
        "POST /api/generate": (req) => ({ price: "$0.05" }),
      },
    });
    assert.equal(config.pricing["POST /api/generate"].type, "dynamic");
  });

  it("normalizes free tier defaults", () => {
    const config = parseConfig({ ...validBase, freeTier: { enabled: true } });
    assert.equal(config.freeTier.enabled, true);
    assert.equal(config.freeTier.requestsPerDay, 100);
    assert.equal(config.freeTier.identifyBy, "wallet");
  });
});

describe("parsePriceString", () => {
  it('parses "$0.01"', () => assert.equal(parsePriceString("$0.01"), 0.01));
  it('parses "0.01"', () => assert.equal(parsePriceString("0.01"), 0.01));
  it("passes through numbers", () => assert.equal(parsePriceString(0.05), 0.05));
  it("rejects negative", () => {
    assert.throws(() => parsePriceString("-1"));
  });
  it("rejects garbage", () => {
    assert.throws(() => parsePriceString("abc"));
  });
});

// --- Pricing tests ---

describe("resolvePrice", () => {
  const config = parseConfig({
    payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    network: "stellar:testnet",
    pricing: {
      "GET /api/search": { price: "$0.002" },
      "POST /api/generate": { price: "$0.01", description: "AI generation" },
      "GET /api/status": "free",
      "GET /api/users/*": { price: "$0.005" },
      "GET /api/items/:id": { price: "$0.003" },
    },
  });

  it("resolves static price for exact match", async () => {
    const result = await resolvePrice(config, {
      method: "GET",
      path: "/api/search",
    });
    assert.equal(result.action, "paid");
    assert.equal(result.priceUsd, 0.002);
  });

  it("resolves free for free routes", async () => {
    const result = await resolvePrice(config, {
      method: "GET",
      path: "/api/status",
    });
    assert.equal(result.action, "free");
  });

  it("resolves unpriced for unknown routes", async () => {
    const result = await resolvePrice(config, {
      method: "GET",
      path: "/api/unknown",
    });
    assert.equal(result.action, "unpriced");
  });

  it("matches wildcard routes", async () => {
    const result = await resolvePrice(config, {
      method: "GET",
      path: "/api/users/123",
    });
    assert.equal(result.action, "paid");
    assert.equal(result.priceUsd, 0.005);
  });

  it("matches parameterized routes", async () => {
    const result = await resolvePrice(config, {
      method: "GET",
      path: "/api/items/abc",
    });
    assert.equal(result.action, "paid");
    assert.equal(result.priceUsd, 0.003);
  });

  it("includes description when present", async () => {
    const result = await resolvePrice(config, {
      method: "POST",
      path: "/api/generate",
    });
    assert.equal(result.description, "AI generation");
  });
});

// --- Quota tests ---

describe("QuotaTracker", () => {
  it("allows requests within quota", async () => {
    const tracker = createQuotaTracker({
      enabled: true,
      requestsPerDay: 3,
      identifyBy: "ip",
    });

    const reqInfo = { ip: "1.2.3.4" };

    const check1 = await tracker.check(reqInfo);
    assert.equal(check1.allowed, true);
    assert.equal(check1.remaining, 3);

    await tracker.record(reqInfo);
    const check2 = await tracker.check(reqInfo);
    assert.equal(check2.allowed, true);
    assert.equal(check2.remaining, 2);
  });

  it("blocks after quota exhausted", async () => {
    const tracker = createQuotaTracker({
      enabled: true,
      requestsPerDay: 2,
      identifyBy: "ip",
    });

    const reqInfo = { ip: "5.6.7.8" };

    await tracker.record(reqInfo);
    await tracker.record(reqInfo);

    const check = await tracker.check(reqInfo);
    assert.equal(check.allowed, false);
    assert.equal(check.remaining, 0);
  });

  it("tracks different callers independently", async () => {
    const tracker = createQuotaTracker({
      enabled: true,
      requestsPerDay: 1,
      identifyBy: "ip",
    });

    await tracker.record({ ip: "1.1.1.1" });

    const check1 = await tracker.check({ ip: "1.1.1.1" });
    assert.equal(check1.allowed, false);

    const check2 = await tracker.check({ ip: "2.2.2.2" });
    assert.equal(check2.allowed, true);
  });

  it("disabled tracker always returns not-allowed", async () => {
    const tracker = createQuotaTracker({ enabled: false });
    const check = await tracker.check({ ip: "1.2.3.4" });
    assert.equal(check.allowed, false);
  });
});
