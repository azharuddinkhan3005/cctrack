import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import type { UsageEntry, AggregatedEntry, CostBreakdown, CostMode } from './types.js';
import { processEntry, emptyTokens, emptyCost, addTokens, addCosts } from './calculator.js';

export interface AgentMeta {
  agentId: string;
  agentType: string;
  description: string;
  parentSessionId: string;
  jsonlPath: string;
}

export interface AgentNode {
  id: string;
  type: 'session' | 'agent';
  agentType?: string;
  description?: string;
  project: string;
  ownTokens: number;
  ownCost: number;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
  children: AgentNode[];
}

/**
 * Discover subagent metadata from the filesystem.
 * Walks the session directory structure looking for subagents/ directories.
 *
 * Returns a map of agentId -> AgentMeta for all discovered subagents.
 */
export function discoverAgentMeta(jsonlFiles: string[]): Map<string, AgentMeta> {
  const agents = new Map<string, AgentMeta>();

  for (const file of jsonlFiles) {
    const dir = dirname(file);
    const name = basename(file);

    // Check if this file is inside a subagents/ directory
    if (!dir.endsWith('/subagents') && !dir.includes('/subagents/')) continue;
    if (!name.startsWith('agent-') || !name.endsWith('.jsonl')) continue;

    const agentId = name.replace('agent-', '').replace('.jsonl', '');
    const metaPath = file.replace('.jsonl', '.meta.json');

    // Extract parent session ID from directory structure:
    // .../projects/<project>/<session-uuid>/subagents/agent-xxx.jsonl
    const subagentsDir = dirname(file);
    const sessionDir = dirname(subagentsDir);
    const parentSessionId = basename(sessionDir);

    let agentType = 'unknown';
    let description = '';

    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        agentType = meta.agentType ?? 'unknown';
        description = meta.description ?? '';
      } catch { /* skip corrupt meta */ }
    }

    agents.set(agentId, {
      agentId,
      agentType,
      description,
      parentSessionId,
      jsonlPath: file,
    });
  }

  return agents;
}

/**
 * Build a hierarchy tree for a given session.
 * The root is the parent session, with child nodes for each subagent.
 */
export function buildSessionHierarchy(
  sessionId: string,
  entries: UsageEntry[],
  agentMeta: Map<string, AgentMeta>,
  mode: CostMode = 'calculate',
): AgentNode | null {
  // Find entries belonging to this session
  const sessionEntries = entries.filter((e) => e.sessionId === sessionId);
  if (sessionEntries.length === 0) return null;

  // Separate parent entries from agent entries
  const agentIds = new Set<string>();
  const agentEntries = new Map<string, UsageEntry[]>();

  // Identify which agentIds belong to this session
  for (const [id, meta] of agentMeta) {
    if (meta.parentSessionId === sessionId) {
      agentIds.add(id);
      agentEntries.set(id, []);
    }
  }

  // Categorize entries: parent session vs. agent
  const parentEntries: UsageEntry[] = [];
  for (const entry of sessionEntries) {
    // Check if entry has agentId field (subagent entries carry this)
    const raw = entry as Record<string, unknown>;
    const entryAgentId = raw.agentId as string | undefined;

    if (entryAgentId && agentIds.has(entryAgentId)) {
      agentEntries.get(entryAgentId)!.push(entry);
    } else {
      parentEntries.push(entry);
    }
  }

  // Compute parent's own cost
  let parentOwnTokens = 0;
  let parentOwnCost = 0;
  let parentRequestCount = 0;
  for (const e of parentEntries) {
    const result = processEntry(e, mode);
    parentOwnTokens += result.tokens.total_tokens;
    parentOwnCost += result.cost.total_cost;
    parentRequestCount++;
  }

  // Build child nodes
  const children: AgentNode[] = [];
  for (const [agentId, meta] of agentMeta) {
    if (meta.parentSessionId !== sessionId) continue;

    const aEntries = agentEntries.get(agentId) ?? [];
    let ownTokens = 0;
    let ownCost = 0;
    let requestCount = 0;

    for (const e of aEntries) {
      const result = processEntry(e, mode);
      ownTokens += result.tokens.total_tokens;
      ownCost += result.cost.total_cost;
      requestCount++;
    }

    children.push({
      id: agentId,
      type: 'agent',
      agentType: meta.agentType,
      description: meta.description,
      project: sessionEntries[0].cwd ?? 'unknown',
      ownTokens,
      ownCost,
      totalTokens: ownTokens, // Agents don't have sub-agents (flat hierarchy)
      totalCost: ownCost,
      requestCount,
      children: [],
    });
  }

  // Sort children by cost descending
  children.sort((a, b) => b.totalCost - a.totalCost);

  // Root node
  const totalTokens = parentOwnTokens + children.reduce((s, c) => s + c.totalTokens, 0);
  const totalCost = parentOwnCost + children.reduce((s, c) => s + c.totalCost, 0);

  return {
    id: sessionId,
    type: 'session',
    project: sessionEntries[0].cwd ?? 'unknown',
    ownTokens: parentOwnTokens,
    ownCost: parentOwnCost,
    totalTokens,
    totalCost,
    requestCount: parentRequestCount + children.reduce((s, c) => s + c.requestCount, 0),
    children,
  };
}
