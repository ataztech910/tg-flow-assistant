// Deterministic flow.yaml -> React Flow graph converter. Computes a layered layout
// (BFS depth from start_node = column) server-side, so the client just renders nodes/edges —
// no client-side layout library (dagre/elk) needed. Node data is structured (icon/title/body/rows)
// so the client renders proper cards instead of one cramped label string.
import type { FlowDefinition, FlowNode } from "./schema.ts";

export interface RFCardData {
  icon: string;
  typeLabel: string;
  title: string;
  body?: string;
  rows?: string[];
  accent: string;
}

export interface RFNode {
  id: string;
  type: "card";
  position: { x: number; y: number };
  data: RFCardData;
}

export interface RFEdge {
  id: string;
  source: string;
  target: string;
  type: "smoothstep";
  label?: string;
  animated?: boolean;
  style?: Record<string, string | number>;
}

export interface RFGraph {
  nodes: RFNode[];
  edges: RFEdge[];
  startNodeId: string;
}

const ACCENT: Record<FlowNode["type"], string> = {
  message: "#0e7c86",
  menu: "#c78a1f",
  input: "#3866c9",
  webhook: "#8547c9",
  collect: "#1a7f4b",
  payment: "#c23f6c",
  condition: "#6b7280",
  subscribe: "#0f9d8f",
  event: "#d1477a",
};

const ICON: Record<FlowNode["type"], string> = {
  message: "💬",
  menu: "❓",
  input: "⌨️",
  webhook: "🌐",
  collect: "💾",
  payment: "💳",
  condition: "🔀",
  subscribe: "🔔",
  event: "📡",
};

function truncate(s: string, n = 90): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

const MEDIA_ICON: Record<string, string> = {
  photo: "🖼️",
  video: "🎬",
  audio: "🎵",
  document: "📎",
  voice: "🎙️",
};

function cardData(id: string, node: FlowNode): RFCardData {
  const base = { icon: ICON[node.type], typeLabel: node.type, title: id, accent: ACCENT[node.type] };
  switch (node.type) {
    case "message": {
      const mediaRow = node.media ? [`${MEDIA_ICON[node.media.kind]} ${node.media.kind}`] : [];
      return {
        ...base,
        body: truncate(node.text),
        rows: [...mediaRow, ...(node.buttons ?? []).map((b) => b.label)],
      };
    }
    case "menu": {
      const mediaRow = node.media ? [`${MEDIA_ICON[node.media.kind]} ${node.media.kind}`] : [];
      return { ...base, body: truncate(node.text), rows: [...mediaRow, ...node.buttons.map((b) => b.label)] };
    }
    case "input":
      return { ...base, body: truncate(node.text), rows: [`saves reply as "${node.save_as}"`] };
    case "webhook":
      return {
        ...base,
        body: `${node.method} ${truncate(node.url, 60)}`,
        rows: node.on_error ? [`on error → ${node.on_error}`] : undefined,
      };
    case "collect":
      return {
        ...base,
        body: (node.fields ?? ["all collected fields"]).join(", "),
      };
    case "payment":
      return {
        ...base,
        body: node.title,
        rows: [`${node.amount} ${node.currency}`],
      };
    case "condition":
      return {
        ...base,
        body: node.equals !== undefined ? `${node.field} == "${node.equals}"` : `${node.field} is set?`,
        rows: [`✓ true → ${node.if_true}`, `✗ false → ${node.if_false}`],
      };
    case "subscribe":
      return { ...base, body: "adds user to the subscriber list" };
    case "event":
      return {
        ...base,
        body: "triggered externally (POST /event/<bot-id>/<node-id>), not via flow navigation",
        rows: [truncate(node.message)],
      };
  }
}

function eachNext(
  node: FlowNode,
  cb: (target: string, label?: string, dashed?: boolean) => void,
): void {
  switch (node.type) {
    case "message":
      for (const b of node.buttons ?? []) cb(b.next, b.label);
      break;
    case "menu":
      for (const b of node.buttons) cb(b.next, b.label);
      break;
    case "input":
    case "collect":
      cb(node.next);
      break;
    case "webhook":
      cb(node.next);
      if (node.on_error) cb(node.on_error, "on_error", true);
      break;
    case "payment":
      cb(node.next);
      if (node.on_fail) cb(node.on_fail, "on_fail", true);
      break;
    case "condition":
      cb(node.if_true, "true");
      cb(node.if_false, "false");
      break;
    case "subscribe":
      cb(node.next);
      break;
    case "event":
      // No next — reached externally, not walked from another node.
      break;
  }
}

const COL_WIDTH = 520;
const ROW_GAP = 70;
const BASE_HEIGHT = 92;
const ROW_HEIGHT = 26;

function estimateHeight(data: RFCardData): number {
  return BASE_HEIGHT + (data.rows?.length ?? 0) * ROW_HEIGHT;
}

export function flowToReactFlowGraph(flow: FlowDefinition): RFGraph {
  const ids = Object.keys(flow.nodes);

  // BFS layering: column = shortest number of hops from start_node. `event` nodes are their own
  // entry points (triggered externally, never reached by walking the flow) — seeded as extra
  // column-0 roots instead of falling into the far-column "unreachable" bucket below.
  const depth = new Map<string, number>();
  const queue: string[] = [];
  if (flow.nodes[flow.start_node]) {
    depth.set(flow.start_node, 0);
    queue.push(flow.start_node);
  }
  for (const [id, node] of Object.entries(flow.nodes)) {
    if (node.type === "event" && !depth.has(id)) {
      depth.set(id, 0);
      queue.push(id);
    }
  }
  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    const node = flow.nodes[id];
    if (!node) continue;
    eachNext(node, (target) => {
      if (!depth.has(target) && flow.nodes[target]) {
        depth.set(target, d + 1);
        queue.push(target);
      }
    });
  }
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  for (const id of ids) {
    if (!depth.has(id)) depth.set(id, maxDepth + 1); // unreachable — park in a far column
  }

  // Pack nodes within a column top-to-bottom using actual estimated card height, so taller
  // cards (menus with several buttons) don't overlap shorter neighbours.
  const columnY = new Map<number, number>();
  const nodes: RFNode[] = ids.map((id) => {
    const node = flow.nodes[id];
    const d = depth.get(id)!;
    const data = cardData(id, node);
    const y = columnY.get(d) ?? 0;
    columnY.set(d, y + estimateHeight(data) + ROW_GAP);
    return { id, type: "card", position: { x: d * COL_WIDTH, y }, data };
  });

  // "Back to X" / "back to start" navigation clutters the diagram without adding information —
  // it's always either one step back or to the beginning, both obvious from context. Drop any
  // edge that doesn't move forward (target at the same or an earlier column than its source).
  const edges: RFEdge[] = [];
  for (const [id, node] of Object.entries(flow.nodes)) {
    eachNext(node, (target, label, dashed) => {
      if (!flow.nodes[target]) return;
      if (depth.get(target)! <= depth.get(id)!) return;
      edges.push({
        id: `e${edges.length}-${id}->${target}`,
        source: id,
        target,
        type: "smoothstep",
        label,
        animated: !!dashed,
        style: dashed
          ? { stroke: "#b3532f", strokeDasharray: "4 3" }
          : { stroke: "#9aa4b3", strokeWidth: 1.5 },
      });
    });
  }

  return { nodes, edges, startNodeId: flow.start_node };
}
