# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2026-03-30

### Added
- x402 SDK integration (`@x402/core`, `@x402/express`, `@x402/stellar`) wired into `@tollway/express`
- Express middleware now returns proper 402 responses with `X-Payment-Required` header containing Stellar payment instructions
- Payment verification and settlement via the x402 facilitator when `payment-signature` header is present
- Integration test suite for `@tollway/express` (5 tests covering free, unpriced, free-tier, and 402 flows)
- Smoke test script (`examples/basic-api/smoke-test.js`) demonstrating the full payment challenge flow

### Changed
- Express middleware generates 402 challenges directly instead of delegating to `@x402/express` middleware, making the challenge flow work without a facilitator round-trip
- Facilitator client is now only used for payment verification/settlement, not challenge generation

### Fixed
- Default facilitator URLs corrected to `https://channels.openzeppelin.com/testnet` and `/mainnet`
- MCP package hardcoded facilitator URL updated to match

## [0.0.1] - 2026-03-30

### Added
- Initial release
- `@tollway/core`: config parsing, pricing engine (exact/wildcard/parameterized routes), quota tracking (in-memory with adapter interface), analytics (console + webhook)
- `@tollway/express`: Express middleware for x402 monetization on Stellar
- `@tollway/mcp`: MCP server wrapper with `paidTool()` / `freeTool()` helpers
- 24 unit tests for core package
- Two working examples (Express API and MCP server)
