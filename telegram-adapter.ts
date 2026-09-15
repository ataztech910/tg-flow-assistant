import { Bot, InlineKeyboard, InputFile } from "https://deno.land/x/grammy@v1.31.0/mod.ts";
import { FlowEngine, FlowResult } from "./engine.ts";

export interface CreateTelegramBotOptions {
  providerToken?: string;
  /** Directory holding files uploaded via the dashboard, for `media.url` values that aren't a
   *  full http(s):// URL — see `resolveMediaSource` below. */
  mediaDir?: string;
}

/** A `media.url` starting with http(s):// is fetched by Telegram's own servers — fine for a
 *  publicly reachable file. Anything else is treated as a filename under `mediaDir` and uploaded
 *  directly by the bot process itself (multipart), which works even when this server only runs on
 *  localhost — Telegram never needs to reach back in. */
function resolveMediaSource(url: string, mediaDir?: string): string | InputFile {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return new InputFile(`${mediaDir ?? "./media"}/${url}`);
}

function buildKeyboard(result: FlowResult): InlineKeyboard | undefined {
  if (result.kind !== "message" || !result.buttons?.length) return undefined;
  const kb = new InlineKeyboard();
  for (const btn of result.buttons) {
    kb.text(btn.label, btn.next).row();
  }
  return kb;
}

/** Wires a FlowEngine to a grammy Bot. The engine has no idea Telegram exists — all of that
 *  lives here, so this same function backs both the single-bot CLI (bot.ts) and BotManager. */
export function createTelegramBot(
  token: string,
  engine: FlowEngine,
  opts: CreateTelegramBotOptions = {},
): Bot {
  const providerToken = opts.providerToken;
  const bot = new Bot(token);

  async function sendResult(
    ctx: {
      reply: Function;
      replyWithInvoice: Function;
      replyWithPhoto: Function;
      replyWithVideo: Function;
      replyWithAudio: Function;
      replyWithDocument: Function;
      replyWithVoice: Function;
    },
    result: FlowResult,
  ) {
    if (result.kind === "invoice") {
      const isStars = result.currency === "XTR";
      if (!isStars && !providerToken) {
        await ctx.reply("⚠️ Payments are not configured (missing a provider token).");
        return;
      }
      // Telegram Stars (XTR) invoices are known to sometimes not render on Desktop/Web clients
      // (e.g. https://github.com/telegramdesktop/tdesktop/issues/30266) — the send succeeds
      // server-side either way, so a silent invoice looks identical to a broken one from here.
      // Heading it off with a plain-text note costs nothing and saves the "is this even working"
      // confusion for every Stars payment, not just this one.
      if (isStars) {
        await ctx.reply(
          "⚠️ Sending your Stars invoice now — if it doesn't show up, check on your phone. " +
            "Some desktop/web Telegram clients don't render Stars payments.",
        );
      }
      try {
        await ctx.replyWithInvoice(
          result.title,
          result.description,
          result.payload,
          result.currency,
          [{ label: result.title, amount: result.amount }],
          { provider_token: isStars ? "" : providerToken! },
        );
        console.log(`[${token.split(":")[0]}] Invoice sent: ${result.nodeId}`);
      } catch (e) {
        console.error(`[${token.split(":")[0]}] Invoice send FAILED for ${result.nodeId}:`, e);
        throw e;
      }
      return;
    }

    const kb = buildKeyboard(result);
    const other = kb ? { reply_markup: kb } : undefined;

    if (result.media) {
      const other2 = { caption: result.text, ...other };
      const source = resolveMediaSource(result.media.url, opts.mediaDir);
      switch (result.media.kind) {
        case "photo":
          await ctx.replyWithPhoto(source, other2);
          return;
        case "video":
          await ctx.replyWithVideo(source, other2);
          return;
        case "audio":
          await ctx.replyWithAudio(source, other2);
          return;
        case "document":
          await ctx.replyWithDocument(source, other2);
          return;
        case "voice":
          await ctx.replyWithVoice(source, other2);
          return;
      }
    }

    await ctx.reply(result.text, other);
  }

  bot.use((ctx: any, next: any) => {
    console.log(`[${token.split(":")[0]}] Update:`, JSON.stringify(ctx.update));
    return next();
  });

  // Real, Telegram-verified identity — independent of whatever an `input` node does or doesn't
  // ask. Runs on every update, before any command/handler below, so it's already in state.data
  // by the time a flow's first node renders or a `collect` node fires.
  bot.use((ctx: any, next: any) => {
    if (ctx.from) {
      engine.setUserProfile(ctx.from.id, {
        telegram_id: String(ctx.from.id),
        telegram_username: ctx.from.username ?? "",
        telegram_first_name: ctx.from.first_name ?? "",
        telegram_last_name: ctx.from.last_name ?? "",
        telegram_language_code: ctx.from.language_code ?? "",
      });
    }
    return next();
  });

  bot.command("start", async (ctx) => {
    const userId = ctx.from!.id;
    const result = await engine.handleStart(userId);
    await sendResult(ctx, result);
  });

  // Dev-only shortcut: simulates a successful payment without needing real Stars/money,
  // by calling the exact same resume logic the real "message:successful_payment" handler uses below.
  bot.command("simulate_payment", async (ctx) => {
    const userId = ctx.from!.id;
    const result = await engine.handlePaymentSuccess(userId);
    await sendResult(ctx, result);
  });

  bot.on("callback_query:data", async (ctx) => {
    const userId = ctx.from.id;
    const nextNodeId = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();
    const result = await engine.handleCallback(userId, nextNodeId);
    await sendResult(ctx, result);
  });

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from!.id;
    const pending = engine.handleText(userId, ctx.message.text);
    if (!pending) return; // not awaiting free-text input right now
    const result = await pending;
    await sendResult(ctx, result);
  });

  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("message:successful_payment", async (ctx) => {
    const userId = ctx.from!.id;
    const result = await engine.handlePaymentSuccess(userId);
    await sendResult(ctx, result);
  });

  bot.catch((err) => console.error(`[${token.split(":")[0]}] Bot error:`, err));

  return bot;
}
