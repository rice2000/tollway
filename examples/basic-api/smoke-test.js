#!/usr/bin/env node

/**
 * Smoke test for the Tollway Express example.
 *
 * Boots the example API on a random port, makes requests against free and paid
 * routes, and prints the results. Demonstrates the full x402 402-challenge flow
 * working against the real Stellar testnet facilitator.
 *
 * Usage:
 *   node examples/basic-api/smoke-test.js
 */

import express from "express";
import { tollway } from "@tollway/express";

const PAY_TO =
  process.env.STELLAR_PAY_TO ||
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const app = express();
app.use(express.json());

app.use(
  tollway({
    payTo: PAY_TO,
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
  })
);

app.get("/api/status", (_req, res) => res.json({ status: "ok" }));
app.get("/api/search", (req, res) =>
  res.json({ results: ["result1"], tollway: req.tollway })
);
app.post("/api/generate", (req, res) =>
  res.json({ output: "generated", tollway: req.tollway })
);

const server = app.listen(0, async () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  console.log(`\n--- Tollway Smoke Test (port ${port}) ---\n`);

  try {
    // 1. Free route
    console.log("1. GET /api/status (free route)");
    let res = await fetch(`${base}/api/status`);
    console.log(`   Status: ${res.status}`);
    console.log(`   Body:   ${await res.text()}\n`);

    // 2. Paid route — within free tier
    console.log("2. GET /api/search (paid route, free tier request 1/2)");
    res = await fetch(`${base}/api/search`);
    console.log(`   Status: ${res.status}`);
    console.log(`   Body:   ${await res.text()}\n`);

    // 3. Paid route — last free tier request
    console.log("3. GET /api/search (paid route, free tier request 2/2)");
    res = await fetch(`${base}/api/search`);
    console.log(`   Status: ${res.status}`);
    console.log(`   Body:   ${await res.text()}\n`);

    // 4. Paid route — free tier exhausted, should get 402
    console.log("4. GET /api/search (paid route, free tier exhausted -> 402)");
    res = await fetch(`${base}/api/search`);
    console.log(`   Status: ${res.status}`);
    const paymentHeader = res.headers.get("x-payment-required");
    if (paymentHeader) {
      const payment = JSON.parse(paymentHeader);
      console.log(`   x-payment-required header:`);
      console.log(`   ${JSON.stringify(payment, null, 2).split("\n").join("\n   ")}`);
    } else {
      console.log(`   (no x-payment-required header)`);
      console.log(`   Body: ${await res.text()}`);
    }
    console.log();

    // 5. POST paid route — also exhausted
    console.log("5. POST /api/generate (paid route, free tier exhausted -> 402)");
    res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });
    console.log(`   Status: ${res.status}\n`);

    console.log("--- Smoke test complete ---\n");
  } catch (err) {
    console.error("Smoke test failed:", err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
