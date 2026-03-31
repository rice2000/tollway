#!/usr/bin/env node
/**
 * Tollway Interactive Demo
 *
 * Starts a real Express + Tollway server, walks through the full x402
 * payment flow with scripted requests, then drops into a live REPL.
 *
 * Usage: node demo/index.js
 */

import express from "express";
import { tollway } from "@tollway/express";
import readline from "node:readline";

// ─── ANSI ─────────────────────────────────────────────────────────────────────

const R = "\x1b[0m";
const B = "\x1b[1m";   // bold
const D = "\x1b[2m";   // dim

const clr = {
  red:     s => `\x1b[31m${s}${R}`,
  green:   s => `\x1b[32m${s}${R}`,
  yellow:  s => `\x1b[33m${s}${R}`,
  cyan:    s => `\x1b[36m${s}${R}`,
  gray:    s => `\x1b[90m${s}${R}`,
  grnB:    s => `\x1b[92m${s}${R}`,
  ylwB:    s => `\x1b[93m${s}${R}`,
  cynB:    s => `\x1b[96m${s}${R}`,
  whtB:    s => `\x1b[97m${s}${R}`,
  magenta: s => `\x1b[35m${s}${R}`,
};

const bold = s => `${B}${s}${R}`;
const dim  = s => `${D}${s}${R}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const W      = 68;
const hr     = (ch = "─") => clr.gray(ch.repeat(W));
const pad    = (s, n = 4) => s.split("\n").map(l => " ".repeat(n) + l).join("\n");

function spinner(label) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r  ${clr.cyan(frames[i++ % frames.length])}  ${label}   `);
  }, 80);
  return {
    stop(done) {
      clearInterval(id);
      process.stdout.write(`\r  ${clr.grnB("✓")}  ${done}${" ".repeat(20)}\n`);
    },
  };
}

async function typewrite(text, delay = 14) {
  for (const ch of text) {
    process.stdout.write(ch);
    await sleep(delay);
  }
}

// ─── JSON syntax highlighting ─────────────────────────────────────────────────

function highlight(obj, indent = 2) {
  return JSON.stringify(obj, null, indent).replace(
    /("(?:\\.|[^"\\])*"(\s*:)?|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    m => {
      if (/^".*":$/.test(m)) return clr.cyan(m);
      if (/^"/.test(m))      return clr.green(m);
      if (/^(true|false)$/.test(m)) return clr.magenta(m);
      if (m === "null")      return clr.red(m);
      return clr.yellow(m);
    }
  );
}

function renderStatus(code) {
  if (code === 200) return clr.grnB("200 OK");
  if (code === 402) return clr.ylwB("402 Payment Required");
  if (code >= 400)  return clr.red(String(code));
  return clr.whtB(String(code));
}

// ─── App config ───────────────────────────────────────────────────────────────

const PAY_TO    = process.env.STELLAR_PAY_TO || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const FREE_TIER = 3;

const tollwayConfig = {
  payTo:   PAY_TO,
  network: "stellar:testnet",
  pricing: {
    "GET /api/status":    "free",
    "GET /api/search":    { price: "$0.002", description: "Search the knowledge base" },
    "POST /api/generate": { price: "$0.01",  description: "Generate content with AI"  },
  },
  freeTier: { enabled: true, requestsPerDay: FREE_TIER, identifyBy: "ip" },
  analytics: { enabled: false },
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(tollway(tollwayConfig));

  app.get("/api/status", (_req, res) => {
    res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  });

  app.get("/api/search", (req, res) => {
    res.json({
      query: req.query.q || "stellar",
      results: [
        { title: "Stellar x402 Protocol",  score: 0.97 },
        { title: "USDC Micropayments",      score: 0.91 },
        { title: "MCP Agent Tool Payments", score: 0.84 },
      ],
      _tollway: req.tollway,
    });
  });

  app.post("/api/generate", (req, res) => {
    res.json({
      prompt: req.body?.prompt || "hello",
      output: `Generated: "${req.body?.prompt || "hello"}"`,
      tokens: 42,
      _tollway: req.tollway,
    });
  });

  return app;
}

async function startServer() {
  return new Promise(resolve => {
    const app = buildApp();
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

// ─── HTTP client ──────────────────────────────────────────────────────────────

async function request(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, headers: res.headers, body: json };
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function renderResult({ status, body }) {
  const lines = ["", `    ${dim("←")} ${renderStatus(status)}`, ""];
  lines.push(pad(highlight(body), 6));
  lines.push("");
  return lines.join("\n");
}

function render402({ body }) {
  const a = body?.accepts || {};
  return [
    "",
    `    ${clr.ylwB("⚡")} ${bold(clr.ylwB("402 Payment Required"))}`,
    "",
    `    ${dim("The caller has exhausted their free tier.")}`,
    `    ${dim("Tollway returned this challenge in")} ${clr.cyan("X-Payment-Required")}${dim(":")}`,
    "",
    pad(highlight({
      x402Version: body.x402Version,
      scheme:      a.scheme,
      price:       a.price,
      network:     a.network,
      payTo:       a.payTo,
    }), 6),
    "",
    `    ${clr.gray("An x402-enabled client would now:")}`,
    `    ${clr.gray("  1.")} Read this challenge`,
    `    ${clr.gray("  2.")} Sign a Soroban auth entry paying ${clr.ylwB(a.price || "$0.002")} USDC on Stellar`,
    `    ${clr.gray("  3.")} Retry the request with the ${clr.cyan("payment-signature")} header`,
    `    ${clr.gray("  4.")} Receive a ${clr.grnB("200 OK")} (~5s Stellar settlement)`,
    "",
  ].join("\n");
}

// ─── Scripted demo ────────────────────────────────────────────────────────────

const DEMO_STEPS = [
  {
    method: "GET",
    path:   "/api/status",
    note:   "free route — always passes through",
  },
  {
    method: "GET",
    path:   "/api/search?q=stellar",
    note:   `free tier  (request 1 of ${FREE_TIER})`,
  },
  {
    method: "GET",
    path:   "/api/search?q=usdc",
    note:   `free tier  (request 2 of ${FREE_TIER})`,
  },
  {
    method: "GET",
    path:   "/api/search?q=mcp+tools",
    note:   `free tier  (request 3 of ${FREE_TIER})`,
  },
  {
    method: "GET",
    path:   "/api/search?q=agents",
    note:   "free tier exhausted — watch the 402 ↓",
  },
  {
    method: "POST",
    path:   "/api/generate",
    body:   { prompt: "explain x402 in one sentence" },
    note:   "also requires payment now",
  },
];

// ─── Code snippet ─────────────────────────────────────────────────────────────

function renderCodeSnippet() {
  const c = clr;
  const lines = [
    "",
    `  ${bold("Integration")}  ${dim("— the entire setup for your own API")}`,
    "",
    pad([
      `${dim("// tollway.config.js")}`,
      `${c.cyan("export default")} {`,
      `  payTo:   ${c.green('"G..."')},             ${dim("// your Stellar address")}`,
      `  network: ${c.green('"stellar:testnet"')},`,
      `  pricing: {`,
      `    ${c.green('"GET /api/search"')}:    { price: ${c.green('"$0.002"')} },`,
      `    ${c.green('"POST /api/generate"')}: { price: ${c.green('"$0.01"')}  },`,
      `    ${c.green('"GET /api/status"')}:    ${c.yellow('"free"')},`,
      `  },`,
      `  freeTier: { enabled: ${c.magenta("true")}, requestsPerDay: ${c.yellow("100")} },`,
      `};`,
      ``,
      `${dim("// server.js")}`,
      `${c.cyan("import")} { tollway } ${c.cyan("from")} ${c.green('"@tollway/express"')};`,
      `app.use(tollway(config));  ${dim("← that's it")}`,
    ].join("\n")),
    "",
    "  " + hr(),
    "",
  ];
  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.clear();

  // ── Header ────────────────────────────────────────────────────────────────
  console.log("");
  console.log(`  ${bold(clr.cynB("🛣   TOLLWAY"))}   ${dim("─")}   ${clr.gray("Per-request payments for APIs and MCP servers")}`);
  console.log(`  ${dim("x402 protocol  ·  Stellar USDC  ·  One middleware call")}`);
  console.log("");
  console.log("  " + hr("━"));
  console.log("");

  // ── Config ────────────────────────────────────────────────────────────────
  const shortAddr = `${PAY_TO.slice(0, 4)}${"•".repeat(48)}${PAY_TO.slice(-4)}`;
  console.log(`  ${clr.gray("Config")}`);
  console.log("");
  console.log(`    ${clr.cyan("payTo")}     ${clr.whtB(shortAddr)}`);
  console.log(`    ${clr.cyan("network")}   ${clr.whtB("stellar:testnet")}`);
  console.log(`    ${clr.cyan("routes")}    ${clr.grnB("GET")}  /api/status     ${clr.gray("→")}  ${dim("free")}`);
  console.log(`               ${clr.grnB("GET")}  /api/search     ${clr.gray("→")}  ${clr.ylwB("$0.002")} USDC`);
  console.log(`               ${clr.magenta("POST")} /api/generate  ${clr.gray("→")}  ${clr.ylwB("$0.01")}  USDC`);
  console.log(`    ${clr.cyan("freeTier")}  ${clr.whtB(String(FREE_TIER))} requests/day per IP ${clr.gray("(demo mode)")}`);
  console.log("");

  // ── Server ────────────────────────────────────────────────────────────────
  const spin = spinner("Starting server...");
  await sleep(600);
  let { server, port } = await startServer();
  spin.stop(`Server running  ${dim("→")}  ${clr.cynB(`http://127.0.0.1:${port}`)}`);
  console.log("");
  console.log("  " + hr("━"));

  // ── Scripted demo ─────────────────────────────────────────────────────────
  console.log("");
  console.log(`  ${bold("Demo")}  ${dim("— watching the payment flow in real time")}`);
  console.log("");

  for (const step of DEMO_STEPS) {
    await sleep(700);

    const methodClr = step.method === "GET" ? clr.grnB : clr.magenta;
    const [path, qs] = step.path.split("?");
    const pathDisplay = qs
      ? `${bold(path)}${clr.gray("?" + qs)}`
      : bold(step.path);

    process.stdout.write(
      `  ${clr.gray("$")} ${dim("curl")} ${methodClr(step.method)} ${pathDisplay}`
    );
    await typewrite(`  ${dim("# " + step.note)}\n`, 10);

    await sleep(280);
    const result = await request(port, step.method, step.path, step.body);
    console.log(result.status === 402 ? render402(result) : renderResult(result));
  }

  await sleep(400);
  console.log("  " + hr("━"));

  // ── Code snippet ──────────────────────────────────────────────────────────
  console.log(renderCodeSnippet());

  // ── Interactive REPL ──────────────────────────────────────────────────────
  console.log(`  ${bold("Interactive")}  ${dim("— the server is still running. try it yourself.")}`);
  console.log("");
  console.log(`  ${dim("Endpoints:")}  ${clr.grnB("GET")} /api/status   ${clr.grnB("GET")} /api/search   ${clr.magenta("POST")} /api/generate`);
  console.log(`  ${dim("Commands:")}   ${clr.cyan("reset")} ${dim("— refill free tier")}   ${clr.cyan("quit")} ${dim("— exit")}`);
  console.log(`  ${dim("Note:")}       Free tier is exhausted after the demo — type ${clr.cyan("reset")} to refill.`);
  console.log("");

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: `  ${clr.cynB("tollway")} ${clr.gray("›")} `,
    terminal: true,
  });

  rl.prompt();

  rl.on("line", async raw => {
    const line = raw.trim();
    if (!line) { rl.prompt(); return; }

    // ── quit ──────────────────────────────────────────────────────────────
    if (line === "quit" || line === "exit" || line === "q") {
      rl.close();
      return;
    }

    // ── reset ─────────────────────────────────────────────────────────────
    if (line === "reset") {
      await new Promise(r => server.close(r));
      const next = await startServer();
      server = next.server;
      port   = next.port;
      console.log(`\n  ${clr.grnB("✓")}  Free tier refilled — ${FREE_TIER} requests available.\n`);
      rl.prompt();
      return;
    }

    // ── help ──────────────────────────────────────────────────────────────
    if (line === "help" || line === "?") {
      console.log("");
      console.log(`  ${dim("Available requests:")}`);
      console.log(`    ${clr.grnB("GET")}  /api/status`);
      console.log(`    ${clr.grnB("GET")}  /api/search${clr.gray("?q=<query>")}`);
      console.log(`    ${clr.magenta("POST")} /api/generate ${clr.gray('{"prompt":"..."}')}`);
      console.log("");
      rl.prompt();
      return;
    }

    // ── parse request ─────────────────────────────────────────────────────
    const parts = line.split(/\s+/);
    let method = "GET";
    let path;
    let body;

    if (/^(GET|POST|PUT|DELETE|PATCH)$/i.test(parts[0])) {
      method = parts[0].toUpperCase();
      path   = parts[1];
      if (parts[2]) {
        try { body = JSON.parse(parts.slice(2).join(" ")); } catch {}
      }
    } else if (parts[0].startsWith("/")) {
      path = parts[0];
    } else {
      console.log(`\n  ${clr.red("Unknown command.")} Type ${clr.cyan("help")} for options.\n`);
      rl.prompt();
      return;
    }

    if (!path) {
      console.log(`\n  ${clr.red("Missing path.")} e.g. ${clr.cyan("GET /api/search")}\n`);
      rl.prompt();
      return;
    }

    // Default body for POST /api/generate
    if (method === "POST" && path.startsWith("/api/generate") && !body) {
      body = { prompt: "hello from demo" };
    }

    try {
      const result = await request(port, method, path, body);
      console.log(result.status === 402 ? render402(result) : renderResult(result));
    } catch (err) {
      console.log(`\n  ${clr.red("Request failed:")} ${err.message}\n`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("");
    console.log("  " + hr("━"));
    console.log("");
    console.log(`  ${bold("Get started")}`);
    console.log(`  ${clr.cyan("npm install @tollway/express")}  then add one middleware call.`);
    console.log(`  ${clr.gray("github.com/rice2000/tollway")}`);
    console.log("");
    server.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
