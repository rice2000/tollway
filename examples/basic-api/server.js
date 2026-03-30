/**
 * Example: Basic API monetized with Tollway
 *
 * This shows the developer experience — the entire monetization setup
 * is a config object + one middleware call.
 *
 * To run:
 *   1. Copy .env.example to .env and add your Stellar testnet key
 *   2. npm install
 *   3. node server.js
 *   4. curl http://localhost:3001/api/status     → free (always)
 *   5. curl http://localhost:3001/api/search      → free for first 50 reqs/day, then 402
 *   6. curl http://localhost:3001/api/generate    → always requires payment ($0.01)
 */

import express from "express";
import { tollway } from "@tollway/express";

// ─── Your Tollway config ───────────────────────────────────────
// In a real project this would be in tollway.config.js

const config = {
  // The Stellar address that receives revenue
  payTo: process.env.STELLAR_PAY_TO || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",

  // Which Stellar network to settle on
  network: "stellar:testnet",

  // Route-level pricing
  pricing: {
    // Free endpoint — no payment ever required
    "GET /api/status": "free",

    // Paid endpoints — $0.002 per search, $0.01 per generation
    "GET /api/search": {
      price: "$0.002",
      description: "Search the knowledge base",
    },

    "POST /api/generate": {
      price: "$0.01",
      description: "Generate content with AI",
    },

    // Dynamic pricing — cost depends on request parameters
    "POST /api/analyze": (req) => {
      const depth = req?.body?.depth || "shallow";
      return {
        price: depth === "deep" ? "$0.05" : "$0.01",
        description: `${depth} analysis`,
      };
    },
  },

  // Free tier: first 50 requests/day are free, then payment kicks in
  freeTier: {
    enabled: true,
    requestsPerDay: 50,
    identifyBy: "ip", // "wallet" in production
  },
};

// ─── App setup ─────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// One line — this is the entire Tollway integration
app.use(tollway(config));

// ─── Your route handlers (business logic only, no payment code) ───

app.get("/api/status", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    version: "0.0.1",
  });
});

app.get("/api/search", (req, res) => {
  const query = req.query.q || "default";

  // req.tollway tells you how this request was authorized
  const sg = req.tollway || {};

  res.json({
    query,
    results: [
      { title: "Result 1", score: 0.95 },
      { title: "Result 2", score: 0.87 },
      { title: "Result 3", score: 0.72 },
    ],
    _meta: {
      paid: sg.paid || false,
      freeTier: sg.freeTier || false,
      remaining: sg.remaining,
    },
  });
});

app.post("/api/generate", (req, res) => {
  const prompt = req.body?.prompt || "Hello world";

  res.json({
    prompt,
    output: `Generated content for: "${prompt}"`,
    model: "example-v1",
    tokens: 42,
  });
});

app.post("/api/analyze", (req, res) => {
  const depth = req.body?.depth || "shallow";
  const data = req.body?.data || "sample data";

  res.json({
    depth,
    analysis: `${depth} analysis of: "${data}"`,
    confidence: depth === "deep" ? 0.95 : 0.72,
  });
});

// ─── Root: show available endpoints and pricing ────────────────────

app.get("/", (_req, res) => {
  res.json({
    name: "Tollway Example API",
    endpoints: {
      "GET /api/status": "free",
      "GET /api/search?q=...": "$0.002 (50 free/day)",
      "POST /api/generate": "$0.01",
      "POST /api/analyze": "$0.01-$0.05 (depends on depth)",
    },
    network: config.network,
    payTo: config.payTo,
  });
});

// ─── Start ─────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\nTollway Example API running on http://localhost:${PORT}`);
  console.log(`\n   GET  /                -> API info`);
  console.log(`   GET  /api/status      -> free`);
  console.log(`   GET  /api/search?q=.. -> $0.002 (50 free/day)`);
  console.log(`   POST /api/generate    -> $0.01`);
  console.log(`   POST /api/analyze     -> $0.01-$0.05\n`);
});
