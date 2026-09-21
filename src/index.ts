#!/usr/bin/env node
/** stdio entry point. Nothing may be written to stdout except MCP traffic. */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer, VERSION } from "./server.js";

async function main(): Promise<void> {
  if (process.argv.includes("--version")) {
    process.stderr.write(`onshape-mcp ${VERSION}\n`);
    return;
  }
  const server = createServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write(`onshape-mcp ${VERSION} ready on stdio\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`onshape-mcp failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
