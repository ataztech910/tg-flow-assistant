import * as jsYaml from "npm:js-yaml@5.4.2";
import { FlowDefinitionSchema } from "./schema.ts";
import { checkFlow } from "./flow-check.ts";

if (import.meta.main) {
  const path = Deno.args[0] ?? "./flow.yaml";

  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (e) {
    console.error(`✗ Cannot read ${path}: ${(e as Error).message}`);
    Deno.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = jsYaml.load(raw);
  } catch (e) {
    console.error(`✗ Invalid YAML in ${path}: ${(e as Error).message}`);
    Deno.exit(1);
  }

  const result = FlowDefinitionSchema.safeParse(parsed);
  if (!result.success) {
    console.error(`✗ Schema errors in ${path}:`);
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    Deno.exit(1);
  }

  const flow = result.data;
  const { errors, unreachable } = checkFlow(flow);

  if (errors.length) {
    console.error(`✗ Reference errors in ${path}:`);
    for (const e of errors) console.error(`  - ${e}`);
    Deno.exit(1);
  }

  if (unreachable.length) {
    console.warn(`⚠ Unreachable nodes (never linked to from start_node): ${unreachable.join(", ")}`);
  }

  const nodeCount = Object.keys(flow.nodes).length;
  console.log(`✓ ${path} is valid (${nodeCount} nodes, ${nodeCount - unreachable.length} reachable)`);
}
