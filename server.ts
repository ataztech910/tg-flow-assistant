import * as jsYaml from "npm:js-yaml@5.4.2";
import { timingSafeEqual } from "node:crypto";
import { FlowDefinitionSchema } from "./schema.ts";
import { flowToReactFlowGraph } from "./flow-to-reactflow.ts";
import { aiEditFlow, aiGenerateFlow } from "./ai-editor.ts";
import { BotManager } from "./bot-manager.ts";
import { renderBotDashboard, renderError, renderHome, renderNotFound } from "./views.ts";

const PORT = Number(Deno.env.get("PORT") ?? 8000);

const manager = new BotManager();
await manager.loadAll();
console.log(`Loaded ${manager.list().length} bot(s) from disk.`);

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { location: to } });
}

// Reserved session for the in-browser "test run" panel — real Telegram user ids are always
// positive, so this can never collide with an actual conversation's state.
const TEST_USER_ID = -1;

// Optional — matches server-prod.ts's EVENT_SECRET. Unset means /event/<id>/<node> 404s outright
// rather than being left open, same "off by default" rule as the admin export.
const EVENT_SECRET = Deno.env.get("EVENT_SECRET") || undefined;

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function readRecentLeads(id: string, limit = 10): Promise<Record<string, unknown>[]> {
  try {
    const text = await Deno.readTextFile(`./bots/${id}/data/leads.jsonl`);
    const lines = text.trim().split("\n").filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

Deno.serve({ port: PORT }, async (req) => {
  const { pathname } = new URL(req.url);

  if (req.method === "GET" && pathname === "/") {
    return html(renderHome(manager.list()));
  }

  if (req.method === "POST" && pathname === "/generate-flow") {
    try {
      const { description } = await req.json();
      if (!description || typeof description !== "string") {
        return json({ error: "Missing description" }, 400);
      }
      const yamlText = await aiGenerateFlow(description);
      return json({ yaml: yamlText });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }

  if (req.method === "POST" && pathname === "/bots") {
    const form = await req.formData();
    const token = String(form.get("token") ?? "").trim();
    const flowYaml = String(form.get("flow_yaml") ?? "");
    const providerToken = String(form.get("provider_token") ?? "").trim() || undefined;
    try {
      const meta = await manager.createBot(token, flowYaml, providerToken);
      return redirect(`/bots/${meta.id}`);
    } catch (e) {
      return html(
        renderHome(manager.list(), {
          error: (e as Error).message,
          prefillToken: token,
          prefillFlow: flowYaml,
        }),
        400,
      );
    }
  }

  const botMatch = pathname.match(/^\/bots\/([^/]+)$/);
  if (req.method === "GET" && botMatch) {
    const id = botMatch[1];
    const entry = manager.get(id);
    if (!entry) return html(renderNotFound(id), 404);
    const flowYaml = await Deno.readTextFile(`./bots/${id}/flow.yaml`);
    const flow = FlowDefinitionSchema.parse(jsYaml.load(flowYaml));
    const graph = flowToReactFlowGraph(flow);
    const leads = await readRecentLeads(id);
    const versions = await manager.listVersions(id);
    return html(renderBotDashboard(entry.meta, entry.running, flow, graph, leads, versions));
  }

  const testStartMatch = pathname.match(/^\/bots\/([^/]+)\/test\/start$/);
  if (req.method === "POST" && testStartMatch) {
    const entry = manager.get(testStartMatch[1]);
    if (!entry) return json({ error: "Unknown bot" }, 404);
    return json(await entry.engine.handleStart(TEST_USER_ID));
  }

  const testButtonMatch = pathname.match(/^\/bots\/([^/]+)\/test\/button$/);
  if (req.method === "POST" && testButtonMatch) {
    const entry = manager.get(testButtonMatch[1]);
    if (!entry) return json({ error: "Unknown bot" }, 404);
    const body = await req.json();
    return json(await entry.engine.handleCallback(TEST_USER_ID, String(body.next)));
  }

  const testTextMatch = pathname.match(/^\/bots\/([^/]+)\/test\/text$/);
  if (req.method === "POST" && testTextMatch) {
    const entry = manager.get(testTextMatch[1]);
    if (!entry) return json({ error: "Unknown bot" }, 404);
    const body = await req.json();
    const pending = entry.engine.handleText(TEST_USER_ID, String(body.text));
    if (!pending) return json({ ignored: true });
    return json(await pending);
  }

  const testPaymentMatch = pathname.match(/^\/bots\/([^/]+)\/test\/payment$/);
  if (req.method === "POST" && testPaymentMatch) {
    const entry = manager.get(testPaymentMatch[1]);
    if (!entry) return json({ error: "Unknown bot" }, 404);
    return json(await entry.engine.handlePaymentSuccess(TEST_USER_ID));
  }

  const aiEditMatch = pathname.match(/^\/bots\/([^/]+)\/ai-edit$/);
  if (req.method === "POST" && aiEditMatch) {
    const id = aiEditMatch[1];
    try {
      const { instruction, nodeId } = await req.json();
      if (!instruction || typeof instruction !== "string") {
        return json({ error: "Missing instruction" }, 400);
      }
      const currentYaml = await Deno.readTextFile(`./bots/${id}/flow.yaml`);
      const newYaml = await aiEditFlow(currentYaml, instruction, nodeId || undefined);
      await manager.saveFlow(id, newYaml, `ai-edit-${instruction.slice(0, 40)}`);
      return json({ ok: true });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }

  const mediaUploadMatch = pathname.match(/^\/bots\/([^/]+)\/media$/);
  if (req.method === "POST" && mediaUploadMatch) {
    const id = mediaUploadMatch[1];
    if (!manager.get(id)) return json({ error: "Unknown bot" }, 404);
    try {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "No file uploaded" }, 400);
      // Keep only a safe basename — this becomes a path segment on disk (bots/<id>/media/<name>).
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "upload";
      const dir = `./bots/${id}/media`;
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeFile(`${dir}/${safeName}`, new Uint8Array(await file.arrayBuffer()));
      return json({ filename: safeName });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }

  const flowSaveMatch = pathname.match(/^\/bots\/([^/]+)\/flow$/);
  if (req.method === "POST" && flowSaveMatch) {
    const id = flowSaveMatch[1];
    try {
      const body = await req.json();
      const yamlText = jsYaml.dump(body.flow);
      await manager.saveFlow(id, yamlText, "form-edit");
      return json({ ok: true });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }

  const versionsMatch = pathname.match(/^\/bots\/([^/]+)\/versions$/);
  if (req.method === "GET" && versionsMatch) {
    return json(await manager.listVersions(versionsMatch[1]));
  }

  const restoreMatch = pathname.match(/^\/bots\/([^/]+)\/versions\/([^/]+)\/restore$/);
  if (req.method === "POST" && restoreMatch) {
    const id = restoreMatch[1];
    try {
      await manager.restoreVersion(id, decodeURIComponent(restoreMatch[2]));
    } catch (e) {
      return html(renderError(id, `Restore failed: ${(e as Error).message}`), 400);
    }
    return redirect(`/bots/${id}`);
  }

  const reloadMatch = pathname.match(/^\/bots\/([^/]+)\/reload$/);
  if (req.method === "POST" && reloadMatch) {
    const id = reloadMatch[1];
    try {
      await manager.reloadFlow(id);
    } catch (e) {
      return html(renderError(id, `Reload failed: ${(e as Error).message}`), 400);
    }
    return redirect(`/bots/${id}`);
  }

  const stopMatch = pathname.match(/^\/bots\/([^/]+)\/stop$/);
  if (req.method === "POST" && stopMatch) {
    await manager.stop(stopMatch[1]);
    return redirect(`/bots/${stopMatch[1]}`);
  }

  const startMatch = pathname.match(/^\/bots\/([^/]+)\/start$/);
  if (req.method === "POST" && startMatch) {
    await manager.start(startMatch[1]);
    return redirect(`/bots/${startMatch[1]}`);
  }

  const eventMatch = pathname.match(/^\/event\/([^/]+)\/([^/]+)$/);
  if (req.method === "POST" && eventMatch) {
    const [, botId, nodeId] = eventMatch;
    if (!EVENT_SECRET) return json({ error: "Event endpoint not configured" }, 404);
    if (!secretMatches(req.headers.get("x-webhook-secret"), EVENT_SECRET)) {
      return json({ error: "Unauthorized" }, 401);
    }
    const entry = manager.get(botId);
    if (!entry) return json({ error: "Unknown bot" }, 404);

    let payload: Record<string, string>;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const result = await entry.engine.notifyEvent(nodeId, payload);
    if (!result) return json({ error: `Unknown event node "${nodeId}"` }, 404);

    const outcomes = await Promise.allSettled(
      result.userIds.map((uid) => entry.bot.api.sendMessage(uid, result.text)),
    );
    const sent = outcomes.filter((o) => o.status === "fulfilled").length;
    for (const o of outcomes) {
      if (o.status === "rejected") console.error(`event "${nodeId}" delivery failed:`, o.reason);
    }
    return json({ sent, subscribers: result.userIds.length });
  }

  return new Response("Not found", { status: 404 });
});

console.log(`BotFlow server on http://localhost:${PORT}`);
