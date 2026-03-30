/**
 * @tollway/mcp
 *
 * A wrapper around the MCP SDK that adds x402 payment gating to tools.
 * Developers define tools as paid or free; the wrapper handles the
 * payment challenge/response flow.
 *
 * Usage:
 *
 *   import { TollwayMCP } from "@tollway/mcp";
 *
 *   const server = new TollwayMCP({
 *     payTo: "G...",
 *     network: "stellar:testnet",
 *   });
 *
 *   server.paidTool("search", {
 *     price: "$0.002",
 *     description: "Search the index",
 *     inputSchema: { type: "object", properties: { query: { type: "string" } } },
 *     handler: async (params) => {
 *       return { results: [...] };
 *     },
 *   });
 *
 *   server.freeTool("health", {
 *     description: "Health check",
 *     handler: async () => ({ status: "ok" }),
 *   });
 *
 *   await server.start();
 */

import {
  parseConfig,
  createQuotaTracker,
  createAnalytics,
  parsePriceString,
} from "@tollway/core";

export class TollwayMCP {
  /**
   * @param {object} config — Tollway config (at minimum: payTo, network)
   */
  constructor(config) {
    // Build a minimal config for the core library
    this._rawConfig = {
      payTo: config.payTo,
      network: config.network || "stellar:testnet",
      facilitatorUrl: config.facilitatorUrl,
      pricing: {}, // populated as tools are registered
      freeTier: config.freeTier || { enabled: false },
      analytics: config.analytics,
    };

    this._tools = new Map();
    this._freeTools = new Map();

    this.analytics = createAnalytics(config.analytics);
    this.quota = createQuotaTracker(
      config.freeTier?.enabled ? config.freeTier : { enabled: false }
    );
  }

  /**
   * Register a paid tool.
   *
   * @param {string} name — tool name (must be unique)
   * @param {object} opts
   * @param {string|number} opts.price — e.g. "$0.01" or 0.01
   * @param {string} opts.description — human-readable description
   * @param {object} [opts.inputSchema] — JSON Schema for tool params
   * @param {function} opts.handler — async (params) => result
   */
  paidTool(name, opts) {
    if (this._tools.has(name) || this._freeTools.has(name)) {
      throw new Error(`[Tollway] Tool "${name}" is already registered.`);
    }

    const priceUsd = parsePriceString(opts.price);

    this._tools.set(name, {
      name,
      priceUsd,
      priceString: `$${priceUsd}`,
      description: opts.description || name,
      inputSchema: opts.inputSchema || { type: "object" },
      handler: opts.handler,
    });

    // Add to pricing map for consistency
    this._rawConfig.pricing[`TOOL ${name}`] = {
      type: "static",
      price: priceUsd,
    };
  }

  /**
   * Register a free tool.
   *
   * @param {string} name
   * @param {object} opts
   * @param {string} opts.description
   * @param {object} [opts.inputSchema]
   * @param {function} opts.handler — async (params) => result
   */
  freeTool(name, opts) {
    if (this._tools.has(name) || this._freeTools.has(name)) {
      throw new Error(`[Tollway] Tool "${name}" is already registered.`);
    }

    this._freeTools.set(name, {
      name,
      description: opts.description || name,
      inputSchema: opts.inputSchema || { type: "object" },
      handler: opts.handler,
    });
  }

  /**
   * Build the MCP server and register all tools.
   * Returns an McpServer instance ready to connect to transport.
   *
   * @returns {Promise<McpServer>}
   */
  async build() {
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const mcpServer = new McpServer({
      name: "tollway",
      version: "0.0.1",
    });

    // Register free tools directly
    for (const [name, tool] of this._freeTools) {
      mcpServer.tool(
        name,
        tool.description,
        tool.inputSchema,
        async (params) => {
          this.analytics.emit("request.free", { route: `TOOL ${name}` });
          const result = await tool.handler(params);
          return {
            content: [
              {
                type: "text",
                text:
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          };
        }
      );
    }

    // Register paid tools with payment challenge flow
    for (const [name, tool] of this._tools) {
      mcpServer.tool(
        name,
        `${tool.description} [Price: ${tool.priceString} USDC]`,
        tool.inputSchema,
        async (params) => {
          // In the MCP x402 flow, payment proof arrives in the tool call
          // context. For now, we implement a challenge-response pattern:
          //
          // 1. If no payment proof → return 402-style challenge
          // 2. If payment proof present → verify and execute
          //
          // The actual x402 MCP integration depends on the client's
          // payment capability. We emit the challenge in a format that
          // x402-aware clients (like Vercel's x402-mcp) understand.

          const paymentProof = params?._payment || params?._x402;

          if (!paymentProof) {
            // Return payment required challenge
            this.analytics.emit("request.blocked", {
              route: `TOOL ${name}`,
              priceUsd: tool.priceUsd,
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: 402,
                    message: "Payment required",
                    x402: {
                      scheme: "exact",
                      price: tool.priceString,
                      network: this._rawConfig.network,
                      payTo: this._rawConfig.payTo,
                      facilitatorUrl:
                        this._rawConfig.facilitatorUrl ||
                        "https://channels.openzeppelin.com/x402/testnet",
                      resource: name,
                    },
                  }),
                },
              ],
              isError: true,
            };
          }

          // Payment proof present — in a production implementation,
          // we'd verify via the facilitator here. For now, log and execute.
          this.analytics.emit("request.paid", {
            route: `TOOL ${name}`,
            priceUsd: tool.priceUsd,
          });

          const result = await tool.handler(params);

          return {
            content: [
              {
                type: "text",
                text:
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          };
        }
      );
    }

    // Also register a discovery tool so agents can see pricing
    mcpServer.tool(
      "tollway_pricing",
      "List all available tools and their prices",
      { type: "object" },
      async () => {
        const tools = [];

        for (const [name, tool] of this._freeTools) {
          tools.push({
            name,
            price: "free",
            description: tool.description,
          });
        }

        for (const [name, tool] of this._tools) {
          tools.push({
            name,
            price: tool.priceString,
            network: this._rawConfig.network,
            description: tool.description,
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ tools, payTo: this._rawConfig.payTo }, null, 2),
            },
          ],
        };
      }
    );

    return mcpServer;
  }

  /**
   * Build and start the server with stdio transport.
   */
  async start() {
    const mcpServer = await this.build();
    const { StdioServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/stdio.js"
    );
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error(
      `[Tollway] MCP server started with ${this._freeTools.size} free + ${this._tools.size} paid tools`
    );
  }
}

export default TollwayMCP;
