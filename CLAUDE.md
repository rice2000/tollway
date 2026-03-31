# Tollway

Turnkey x402 monetization for SaaS APIs and MCP servers, settling on Stellar USDC. One config file, one middleware call.

## Commands

```bash
npm test              # run all tests (core + express)
npm run demo          # interactive CLI demo showing the full payment flow
node demo/index.js    # same as above
```

## Architecture

This is an npm workspace monorepo with three packages:

- **`packages/core/`** (`@tollway/core`) — Framework-agnostic engine. Config validation, pricing resolution (exact/wildcard/parameterized routes, static/dynamic/free), in-memory quota tracking with pluggable store interface, analytics event emitter. No runtime deps.
- **`packages/express/`** (`@tollway/express`) — Express middleware. Wraps core + lazily loads x402 SDK peer deps (`@x402/core`, `@x402/express`, `@x402/stellar`). Generates 402 challenges directly; uses facilitator only for payment verification.
- **`packages/mcp/`** (`@tollway/mcp`) — MCP server wrapper. Exposes `paidTool()` and `freeTool()` methods. Wraps `@modelcontextprotocol/sdk`. Built-in `tollway_pricing` discovery tool.

## Key files

- `packages/core/src/config.js` — `parseConfig()`, validates and normalizes developer config
- `packages/core/src/pricing.js` — `resolvePrice()`, route matching and pricing decision
- `packages/core/src/quota.js` — `createQuotaTracker()`, free-tier usage tracking
- `packages/core/src/analytics.js` — `createAnalytics()`, event emission
- `packages/express/src/index.js` — `tollway()` Express middleware
- `packages/mcp/src/index.js` — `TollwayMCP` class
- `packages/core/src/core.test.js` — unit tests (run with `node --test`)
- `packages/express/src/express.test.js` — integration tests

## Conventions

- All packages are ESM (`"type": "module"`)
- Tests use Node.js built-in test runner (`node:test`, `node:assert/strict`) — no Jest/Vitest
- x402 peer deps are lazy-loaded with `await import()` — don't import them at module level
- Facilitator URLs: `https://channels.openzeppelin.com/testnet` and `/mainnet`
- Price strings use `"$0.01"` format throughout

## Running a single package's tests

```bash
cd packages/core && node --test src/core.test.js
cd packages/express && node --test src/express.test.js
```

---

## For developers integrating Tollway into their own project

If you're using Claude Code in a project that uses `@tollway/express` or `@tollway/mcp`, paste the following into **your project's `CLAUDE.md`**:

---

```markdown
## Tollway (x402 payment middleware)

This project uses Tollway for per-request API monetization via the x402 protocol on Stellar.

**Packages installed:** `@tollway/express` (or `@tollway/mcp`)
**Full docs:** https://github.com/rice2000/tollway / node_modules/@tollway/express

### Express setup (the complete integration)

```js
// tollway.config.js
export default {
  payTo: process.env.STELLAR_PAY_TO,   // Stellar public key (G...)
  network: "stellar:testnet",           // or "stellar:pubnet"
  pricing: {
    "GET /api/data":     { price: "$0.002" },
    "POST /api/action":  { price: "$0.01"  },
    "GET /api/health":   "free",
    "GET /api/items/:id": { price: "$0.001" },  // parameterized
    "GET /api/admin/*":  { price: "$0.05"  },   // wildcard
  },
  freeTier: {
    enabled: true,
    requestsPerDay: 100,
    identifyBy: "ip",    // or "wallet"
  },
};

// server.js
import { tollway } from "@tollway/express";
import config from "./tollway.config.js";
app.use(tollway(config));  // ← entire integration, goes before routes
```

### req.tollway context (available in route handlers)
- `req.tollway.paid` — boolean, true if payment was verified
- `req.tollway.freeTier` — boolean, true if served from free tier
- `req.tollway.remaining` — number, free requests remaining today
- `req.tollway.priceUsd` — number, price charged (when paid: true)

### 402 response (when payment required)
Status 402 with `X-Payment-Required` header and matching JSON body:
```json
{
  "x402Version": 1,
  "accepts": { "scheme": "exact", "price": "$0.002", "network": "stellar:testnet", "payTo": "G..." },
  "resource": "GET /api/data"
}
```

### MCP setup

```js
import { TollwayMCP } from "@tollway/mcp";

const server = new TollwayMCP({ payTo: "G...", network: "stellar:testnet" });

server.freeTool("health", { description: "...", handler: async () => ({}) });
server.paidTool("search", {
  price: "$0.002",
  description: "...",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  handler: async ({ query }) => ({ results: [] }),
});

await server.start();
```

### Environment variables
- `STELLAR_PAY_TO` — your Stellar public key
- `STELLAR_NETWORK` — `stellar:testnet` (default) or `stellar:pubnet`
```
