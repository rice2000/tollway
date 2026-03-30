/**
 * Example: MCP Server monetized with Tollway
 *
 * This is a Stellar network data tool that agents can pay to use.
 * Free tools: health check, pricing discovery
 * Paid tools: account lookup, transaction search
 *
 * To run with Claude Desktop, add to your MCP config:
 *   {
 *     "mcpServers": {
 *       "stellar-data": {
 *         "command": "node",
 *         "args": ["path/to/server.js"]
 *       }
 *     }
 *   }
 */

import { TollwayMCP } from "@tollway/mcp";

const server = new TollwayMCP({
  payTo: process.env.STELLAR_PAY_TO || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  network: "stellar:testnet",
});

// ─── Free tools ────────────────────────────────────────────────────

server.freeTool("health", {
  description: "Check if the Stellar data service is running",
  handler: async () => ({
    status: "ok",
    network: "stellar:testnet",
    timestamp: new Date().toISOString(),
  }),
});

// ─── Paid tools ────────────────────────────────────────────────────

server.paidTool("account_info", {
  price: "$0.001",
  description: "Look up a Stellar account — balances, signers, and thresholds",
  inputSchema: {
    type: "object",
    properties: {
      account_id: {
        type: "string",
        description: "Stellar public key (G...)",
      },
    },
    required: ["account_id"],
  },
  handler: async (params) => {
    const accountId = params.account_id;

    // In production, this would call the Stellar Horizon API.
    // For the example, we return mock data.
    return {
      account_id: accountId,
      balances: [
        { asset_type: "native", balance: "1234.5678" },
        { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "500.00" },
      ],
      sequence: "123456789",
      signers: [{ key: accountId, weight: 1 }],
      thresholds: { low: 1, med: 1, high: 1 },
    };
  },
});

server.paidTool("transaction_search", {
  price: "$0.005",
  description: "Search recent transactions for a Stellar account",
  inputSchema: {
    type: "object",
    properties: {
      account_id: {
        type: "string",
        description: "Stellar public key to search transactions for",
      },
      limit: {
        type: "number",
        description: "Number of transactions to return (default 10, max 100)",
      },
    },
    required: ["account_id"],
  },
  handler: async (params) => {
    const limit = Math.min(params.limit || 10, 100);

    // Mock data — would call Horizon in production
    return {
      account_id: params.account_id,
      transactions: Array.from({ length: limit }, (_, i) => ({
        hash: `tx_${Date.now()}_${i}`,
        created_at: new Date(Date.now() - i * 3600000).toISOString(),
        type: i % 2 === 0 ? "payment" : "create_account",
        amount: (Math.random() * 100).toFixed(2),
        asset: "USDC",
      })),
      _meta: { count: limit, has_more: true },
    };
  },
});

server.paidTool("network_stats", {
  price: "$0.002",
  description: "Get current Stellar network statistics — TPS, ledger info, fee stats",
  inputSchema: { type: "object" },
  handler: async () => {
    // Mock data
    return {
      network: "testnet",
      latest_ledger: 52345678,
      ledger_close_time: "5.2s",
      tps_current: 142,
      tps_max: 1000,
      base_fee: "100 stroops",
      protocol_version: 21,
      total_accounts: 8234567,
    };
  },
});

// ─── Start ─────────────────────────────────────────────────────────

await server.start();
