# Tollway

Turnkey x402 monetization for SaaS APIs and MCP servers, settling on Stellar.

Tollway replaces subscription billing with per-request payments. One config file, one middleware call — your API earns from both human users and AI agents.

## Why

The x402 protocol lets any HTTP endpoint accept stablecoin payments. But the raw SDKs only handle the payment flow — you still need to figure out pricing logic, free-tier quotas, analytics, and the bridge between "charge per request" and "run a business."

Tollway is that bridge. It wraps the x402 protocol with an opinionated config-driven layer so you can go from zero to monetized in 15 minutes.

**Why Stellar?** Transaction fees of ~$0.00001 mean micropayments actually work economically. A $0.001 API call nets ~$0.001. The Built on Stellar facilitator covers network fees entirely.

## Quickstart

### Express API

```js
// tollway.config.js
export default {
  payTo: "G...your_stellar_address...",
  network: "stellar:testnet",
  pricing: {
    "GET /api/search":    { price: "$0.002" },
    "POST /api/generate": { price: "$0.01" },
    "GET /api/status":    "free",
  },
  freeTier: {
    enabled: true,
    requestsPerDay: 100,
    identifyBy: "ip",
  },
};
```

```js
// server.js
import express from "express";
import { tollway } from "@tollway/express";
import config from "./tollway.config.js";

const app = express();
app.use(tollway(config));

app.get("/api/search", (req, res) => {
  // This only runs if the caller paid or is within their free tier.
  // req.tollway.paid tells you which.
  res.json({ results: ["..."] });
});

app.listen(3001);
```

### MCP Server

```js
import { TollwayMCP } from "@tollway/mcp";

const server = new TollwayMCP({
  payTo: "G...your_stellar_address...",
  network: "stellar:testnet",
});

server.freeTool("health", {
  description: "Health check",
  handler: async () => ({ status: "ok" }),
});

server.paidTool("search", {
  price: "$0.002",
  description: "Search the knowledge base",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  handler: async (params) => {
    return { results: ["..."] };
  },
});

await server.start();
```

## Packages

| Package | Description |
|---------|-------------|
| `@tollway/core` | Config parsing, pricing engine, quota tracking, analytics |
| `@tollway/express` | Express middleware (wraps @x402/express + @x402/stellar) |
| `@tollway/mcp` | MCP server wrapper with paidTool() / freeTool() helpers |

## Config Reference

### payTo (required)
Stellar public key (G...) that receives USDC revenue.

### network
"stellar:testnet" or "stellar:pubnet". Defaults to testnet.

### facilitatorUrl
Override the x402 facilitator endpoint. Defaults to the Built on Stellar facilitator (OpenZeppelin).

### pricing (required)
A map of "METHOD /path" to pricing rules:

- `{ price: "$0.01" }` — static price
- `"free"` — always free
- `(req) => ({ price: "$0.05" })` — dynamic pricing
- `"GET /path/*"` — wildcard match
- `"GET /path/:id"` — parameterized match

### freeTier

When enabled, callers get N free requests per day before x402 payment kicks in. This lets users try your API before committing, and graduates them from free to paid organically.

### analytics

Events are emitted for every request: request.free, request.paid, request.blocked, request.unpriced. Console logging by default; optional webhook URL for a hosted dashboard.

## How It Works

1. Request arrives at your Express app or MCP server
2. Tollway middleware resolves the pricing rule for this route
3. If the route is free or unpriced, the request passes through
4. If the route is paid, Tollway checks the free-tier quota
5. If the caller has free requests remaining, it passes through and decrements the quota
6. If the quota is exhausted, it delegates to the x402 middleware
7. The x402 middleware returns a 402 with payment instructions
8. The client pays in USDC on Stellar (~5 second settlement)
9. The client retries with payment proof, and the request succeeds
10. Analytics events are emitted at every step

## Prerequisites

For the Express middleware to handle actual x402 payments:

```bash
npm install @x402/core @x402/express @x402/stellar
```

For MCP servers:

```bash
npm install @modelcontextprotocol/sdk
```

## Development

```bash
git clone https://github.com/yourname/tollway.git
cd tollway
npm install
npm test
```

## Roadmap

- @tollway/hono — Hono middleware variant
- @tollway/next — Next.js middleware variant
- @tollway/dashboard — hosted analytics dashboard
- MPP (Stripe/Tempo) dual-protocol support
- Redis quota store adapter
- Pricing advisor (suggest optimal prices from usage data)
- CLI scaffolding tool (tollway init)

## License

Apache-2.0
