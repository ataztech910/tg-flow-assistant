// Single-bot CLI runner, for local testing without the multi-bot server.
// Wiring itself lives in telegram-adapter.ts, shared with server.ts/bot-manager.ts.
import { FlowEngine } from "./engine.ts";
import { createTelegramBot } from "./telegram-adapter.ts";

if (import.meta.main) {
  const token = Deno.env.get("TELEGRAM_TOKEN");
  if (!token) throw new Error("TELEGRAM_TOKEN is not set");
  const providerToken = Deno.env.get("TELEGRAM_PROVIDER_TOKEN");

  const engine = new FlowEngine();
  engine.loadFlow(await Deno.readTextFile("./flow.yaml"));

  const bot = createTelegramBot(token, engine, { providerToken, mediaDir: "./media" });

  console.log("Calling getMe...");
  try {
    const me = await bot.api.getMe();
    console.log("Token OK, bot:", me.username);
  } catch (e) {
    console.error("getMe failed:", e);
    Deno.exit(1);
  }

  await bot.start({
    onStart: (info) => console.log(`Bot @${info.username} is polling...`),
  });
}
