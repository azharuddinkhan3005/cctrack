#!/usr/bin/env node
import { startMcpServer } from './server.js';

startMcpServer().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
