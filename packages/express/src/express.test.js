import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { tollway } from "./index.js";

const TEST_PAY_TO = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("@tollway/express middleware", () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = express();
    app.use(express.json());

    app.use(
      tollway({
        payTo: TEST_PAY_TO,
        network: "stellar:testnet",
        pricing: {
          "GET /api/status": "free",
          "GET /api/search": { price: "$0.002" },
          "POST /api/generate": { price: "$0.01" },
        },
        freeTier: {
          enabled: true,
          requestsPerDay: 2,
          identifyBy: "ip",
        },
        analytics: { enabled: false },
      })
    );

    app.get("/api/status", (_req, res) => res.json({ status: "ok" }));
    app.get("/api/search", (req, res) => {
      res.json({ results: [], tollway: req.tollway });
    });
    app.post("/api/generate", (req, res) => {
      res.json({ output: "generated", tollway: req.tollway });
    });
    app.get("/api/unpriced", (_req, res) => res.json({ unpriced: true }));

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  it("passes through free routes with 200", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
  });

  it("passes through unpriced routes with 200", async () => {
    const res = await fetch(`${baseUrl}/api/unpriced`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.unpriced, true);
  });

  it("serves paid routes for free within the free tier quota", async () => {
    const res = await fetch(`${baseUrl}/api/search`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tollway.paid, false);
    assert.equal(body.tollway.freeTier, true);
    assert.equal(typeof body.tollway.remaining, "number");
  });

  it("returns 402 with payment instructions when free tier exhausted", async () => {
    // Exhaust remaining free tier (we used 1 above, quota is 2)
    await fetch(`${baseUrl}/api/search`);

    // This request (3rd) should trigger 402
    const res = await fetch(`${baseUrl}/api/search`);
    assert.equal(res.status, 402);

    // Check for the x402 payment-required header
    const paymentHeader = res.headers.get("x-payment-required");
    assert.ok(paymentHeader, "Expected X-Payment-Required header on 402 response");

    const payment = JSON.parse(paymentHeader);
    assert.ok(payment.accepts, "Payment header should have 'accepts' field");
    assert.equal(payment.accepts.network, "stellar:testnet");
    assert.equal(payment.accepts.payTo, TEST_PAY_TO);
    assert.equal(payment.accepts.scheme, "exact");
    assert.equal(payment.accepts.price, "$0.002");

    // Also verify the JSON body matches
    const body = await res.json();
    assert.equal(body.accepts.network, "stellar:testnet");
    assert.equal(body.accepts.payTo, TEST_PAY_TO);
  });

  it("returns 402 for paid routes with no free tier remaining", async () => {
    // POST /api/generate has no free tier requests left (quota shared across paid routes)
    // Actually, quota is per-caller not per-route, and we already exhausted it above
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    });
    assert.equal(res.status, 402);
  });
});
