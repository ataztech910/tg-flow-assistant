import type { FlowDefinition, FlowNode } from "./schema.ts";

function eachRef(node: FlowNode, cb: (field: string, ref: string) => void): void {
  switch (node.type) {
    case "message":
      for (const b of node.buttons ?? []) cb(`button "${b.label}".next`, b.next);
      break;
    case "menu":
      for (const b of node.buttons) cb(`button "${b.label}".next`, b.next);
      break;
    case "input":
    case "collect":
      cb("next", node.next);
      break;
    case "webhook":
      cb("next", node.next);
      if (node.on_error) cb("on_error", node.on_error);
      break;
    case "payment":
      cb("next", node.next);
      if (node.on_fail) cb("on_fail", node.on_fail);
      break;
    case "condition":
      cb("if_true", node.if_true);
      cb("if_false", node.if_false);
      break;
  }
}

export interface FlowCheckResult {
  /** Fatal: a next/on_error/on_fail (or start_node) points at a node that doesn't exist. */
  errors: string[];
  /** Non-fatal: nodes never reached by walking every path from start_node. */
  unreachable: string[];
}

/** Reference-integrity + reachability check shared by validate.ts (CLI) and bot-manager.ts
 *  (bot creation) — schema.ts only checks shape, this checks that the graph is well-formed. */
export function checkFlow(flow: FlowDefinition): FlowCheckResult {
  const nodeIds = new Set(Object.keys(flow.nodes));
  const errors: string[] = [];

  if (!nodeIds.has(flow.start_node)) {
    errors.push(`start_node "${flow.start_node}" is not defined in nodes`);
  }

  for (const [id, node] of Object.entries(flow.nodes)) {
    eachRef(node, (field, ref) => {
      if (!nodeIds.has(ref)) {
        errors.push(`node "${id}": ${field} references unknown node "${ref}"`);
      }
    });
  }

  const unreachable: string[] = [];
  if (errors.length === 0) {
    const visited = new Set<string>();
    const queue = [flow.start_node];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id) || !nodeIds.has(id)) continue;
      visited.add(id);
      eachRef(flow.nodes[id], (_field, ref) => queue.push(ref));
    }
    unreachable.push(...[...nodeIds].filter((id) => !visited.has(id)));
  }

  return { errors, unreachable };
}
