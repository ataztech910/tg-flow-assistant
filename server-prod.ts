// Production entrypoint for Deno Deploy — deploy THIS file, not server.ts.
//
// Deliberately does not contain the dashboard: editing (node form, AI chat via Kitana's
// subprocess spawn, file uploads, version history) needs local disk writes and subprocess
// access that Deploy's isolates don't have. All editing happens locally against server.ts;
// this file only ever reads the flow.yaml files that were already committed as part of the
// deploy and serves live Telegram traffic for them via webhooks (Deploy's isolate model can't
// sustain a perpetual long-polling loop the way server.ts's BotManager does).
//
// Required env vars (set as Deno Deploy project secrets):
//   PROD_BOT_IDS        comma-separated bot ids to activate, e.g. "8984073292,123456789"
//   BOT_TOKEN_<id>       token for that bot
//   PUBLIC_URL           this deployment's own base URL, e.g. https://yourproject.deno.dev
// Optional:
//   BOT_PROVIDER_TOKEN_<id>   for payment nodes using a real currency instead of Stars
//   WEBHOOK_SECRET            compared against X-Telegram-Bot-Api-Secret-Token on every request

import { webhookCallback } from "https://deno.land/x/grammy@v1.31.0/mod.ts";
import { FlowEngine } from "./engine.ts";
import { createTelegramBot } from "./telegram-adapter.ts";

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const PUBLIC_URL = requireEnv("PUBLIC_URL").replace(/\/$/, "");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || undefined;
const botIds = requireEnv("PROD_BOT_IDS").split(",").map((s) => s.trim()).filter(Boolean);

if (botIds.length === 0) {
  throw new Error("PROD_BOT_IDS is set but empty");
}

const handlers = new Map<string, (req: Request) => Promise<Response>>();

for (const id of botIds) {
  const token = requireEnv(`BOT_TOKEN_${id}`);
  const providerToken = Deno.env.get(`BOT_PROVIDER_TOKEN_${id}`) || undefined;

  const flowYaml = await Deno.readTextFile(`./bots/${id}/flow.yaml`);
  const engine = new FlowEngine(`kv:${id}`); // collect writes go to Deno KV in prod, not disk
  engine.loadFlow(flowYaml);

  const bot = createTelegramBot(token, engine, { providerToken, mediaDir: `./bots/${id}/media` });
  await bot.init(); // required before handleUpdate() will accept webhook requests

  handlers.set(id, webhookCallback(bot, "std/http", { secretToken: WEBHOOK_SECRET }));

  await bot.api.setWebhook(
    `${PUBLIC_URL}/webhook/${id}`,
    WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : undefined,
  );
  console.log(`Bot ${id} (@${bot.botInfo.username}) webhook set to ${PUBLIC_URL}/webhook/${id}`);
}

// Deno Deploy assigns its own port automatically; containerized platforms (Cloud Run, AWS App
// Runner/ECS, plain Docker) expect the app to listen on $PORT.
const PORT = Number(Deno.env.get("PORT") ?? 8000);

Deno.serve({ port: PORT }, async (req) => {
  const { pathname } = new URL(req.url);
  const match = pathname.match(/^\/webhook\/([^/]+)$/);
  if (req.method === "POST" && match) {
    const handler = handlers.get(match[1]);
    if (!handler) return new Response("Unknown bot", { status: 404 });
    return await handler(req);
  }
  return new Response("BotFlow — production. Nothing to see here.", { status: 200 });
});
