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
//   ADMIN_SECRET              enables GET /admin/leads/<id> (?format=csv|json) to export collected
//                             leads — required to be set for that route to work at all; unset means
//                             the route is refused outright, not left open

import { webhookCallback } from "https://deno.land/x/grammy@v1.31.0/mod.ts";
import { timingSafeEqual } from "node:crypto";
import { FlowEngine } from "./engine.ts";
import { createTelegramBot } from "./telegram-adapter.ts";

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Deno Deploy binds `Deno.openKv()` to a managed database once one is provisioned and assigned
// to the app (`deno deploy database provision --kind denokv` + `database assign` — see README);
// there's no persistent local disk across its isolates, so that's where `collect` writes need to
// go. Everywhere else this file runs (Docker, Cloud Run, AWS, bare `deno run`), there's no such
// binding and Deno.openKv() needs an unstable flag — but those targets already have a real,
// persistent filesystem (the same `bots/` volume flow.yaml and media live on), so leads go to
// disk there instead, same as local dev. Probing actual capability instead of guessing from an
// env var means this keeps working correctly even if Deploy's env conventions change.
async function kvAvailable(): Promise<boolean> {
  try {
    const kv = await Deno.openKv();
    kv.close();
    return true;
  } catch {
    return false;
  }
}
const useKv = await kvAvailable();

const PUBLIC_URL = requireEnv("PUBLIC_URL").replace(/\/$/, "");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || undefined;
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET") || undefined;
const botIds = requireEnv("PROD_BOT_IDS").split(",").map((s) => s.trim()).filter(Boolean);

if (botIds.length === 0) {
  throw new Error("PROD_BOT_IDS is set but empty");
}

const handlers = new Map<string, (req: Request) => Promise<Response>>();

for (const id of botIds) {
  const token = requireEnv(`BOT_TOKEN_${id}`);
  const providerToken = Deno.env.get(`BOT_PROVIDER_TOKEN_${id}`) || undefined;

  const flowYaml = await Deno.readTextFile(`./bots/${id}/flow.yaml`);
  const engine = new FlowEngine(useKv ? `kv:${id}` : `./bots/${id}/data`);
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

async function readLeads(id: string): Promise<Record<string, string>[]> {
  if (useKv) {
    const kv = await Deno.openKv();
    const leads: Record<string, string>[] = [];
    for await (const entry of kv.list<Record<string, string>>({ prefix: ["leads", id] })) {
      leads.push(entry.value);
    }
    kv.close();
    return leads;
  }
  try {
    const text = await Deno.readTextFile(`./bots/${id}/data/leads.jsonl`);
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function leadsToCsv(leads: Record<string, string>[]): string {
  const columns = [...new Set(leads.flatMap((l) => Object.keys(l)))].sort();
  const escape = (raw: string) => {
    // Fields like telegram_first_name/telegram_username are set by the user themselves via
    // Telegram, not by us — a value starting with =/+/-/@ opens a formula-injection hole in
    // Excel/Sheets once an admin opens the exported file. Prefixing a bare quote neutralizes it
    // without changing the visible value.
    const v = raw ?? "";
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = leads.map((l) => columns.map((c) => escape(l[c] ?? "")).join(","));
  return [columns.map(escape).join(","), ...rows].join("\n");
}

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  // Constant-time comparison — a plain !== leaks how many leading bytes matched via response
  // timing, which turns a guessable-length secret into a byte-at-a-time oracle.
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Deno Deploy assigns its own port automatically; containerized platforms (Cloud Run, AWS App
// Runner/ECS, plain Docker) expect the app to listen on $PORT.
const PORT = Number(Deno.env.get("PORT") ?? 8000);

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);

  const webhookMatch = url.pathname.match(/^\/webhook\/([^/]+)$/);
  if (req.method === "POST" && webhookMatch) {
    const handler = handlers.get(webhookMatch[1]);
    if (!handler) return new Response("Unknown bot", { status: 404 });
    return await handler(req);
  }

  const leadsMatch = url.pathname.match(/^\/admin\/leads\/([^/]+)$/);
  if (req.method === "GET" && leadsMatch) {
    if (!ADMIN_SECRET) return new Response("Admin export not configured", { status: 404 });
    if (!secretMatches(req.headers.get("x-admin-secret"), ADMIN_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const leads = await readLeads(leadsMatch[1]);
    if (url.searchParams.get("format") === "csv") {
      return new Response(leadsToCsv(leads), {
        headers: {
          "content-type": "text/csv",
          "content-disposition": `attachment; filename="leads-${leadsMatch[1]}.csv"`,
        },
      });
    }
    return new Response(JSON.stringify(leads, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("BotFlow — production. Nothing to see here.", { status: 200 });
});
