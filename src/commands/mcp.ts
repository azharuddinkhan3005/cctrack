import type { Command } from 'commander';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Start MCP server (Model Context Protocol) for Claude Desktop integration')
    .action(async () => {
      const { startMcpServer } = await import('../mcp/server.js');
      await startMcpServer();
    });
}
