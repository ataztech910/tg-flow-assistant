import { Bot } from "https://deno.land/x/grammy@v1.31.0/mod.ts";
import * as jsYaml from "npm:js-yaml@5.4.2";
import { FlowDefinitionSchema } from "./schema.ts";
import { checkFlow } from "./flow-check.ts";
import { FlowEngine } from "./engine.ts";
import { createTelegramBot } from "./telegram-adapter.ts";

export interface BotMeta {
  id: string;
  name: string;
  username: string;
  token: string;
  providerToken?: string;
  createdAt: string;
}

interface BotEntry {
  meta: BotMeta;
  bot: Bot;
  engine: FlowEngine;
  running: boolean;
}

const BOTS_DIR = "./bots";
const VERSIONS_SUBDIR = "versions";

export interface FlowVersion {
  filename: string;
  label: string;
  createdAt: string;
}

/** Runs several Telegram bots concurrently in this one process (parallel long polling — see
 *  TASKS.md "Архитектура для нескольких ботов на одном сервере"). Each bot gets its own
 *  FlowEngine (isolated user state) and its own data dir (bots/<id>/data). */
export class BotManager {
  private bots = new Map<string, BotEntry>();

  async loadAll(): Promise<void> {
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(BOTS_DIR));
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return;
      throw e;
    }
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      try {
        await this.startFromDisk(entry.name);
      } catch (e) {
        console.error(`Failed to load bot ${entry.name}:`, e);
      }
    }
  }

  private async startFromDisk(id: string): Promise<void> {
    const dir = `${BOTS_DIR}/${id}`;
    const meta: BotMeta = JSON.parse(await Deno.readTextFile(`${dir}/meta.json`));
    const flowYaml = await Deno.readTextFile(`${dir}/flow.yaml`);
    const engine = new FlowEngine(`${dir}/data`);
    engine.loadFlow(flowYaml);
    const bot = createTelegramBot(meta.token, engine, {
      providerToken: meta.providerToken,
      mediaDir: `${dir}/media`,
    });
    this.bots.set(id, { meta, bot, engine, running: true });
    this.launch(id, meta, bot);
  }

  /** bot.start() rejects if the token turns out to be invalid/revoked at connect time — this
   *  must never crash the whole process (it would take every other bot down with it), so every
   *  launch is isolated here instead of a bare `void bot.start()`. */
  private launch(id: string, meta: BotMeta, bot: Bot): void {
    bot.start({ onStart: () => console.log(`Bot @${meta.username} (${id}) is polling...`) })
      .catch((e) => {
        console.error(`Bot @${meta.username} (${id}) failed to start:`, (e as Error).message);
        const entry = this.bots.get(id);
        if (entry) entry.running = false;
      });
  }

  /** Throws with a human-readable message if the YAML doesn't parse, doesn't match the schema,
   *  or has dangling references — same checks as validate.ts, shared so createBot/reloadFlow
   *  can't drift apart. */
  private assertValidFlow(flowYamlText: string): void {
    const parsed = FlowDefinitionSchema.safeParse(jsYaml.load(flowYamlText));
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid flow.yaml: ${msg}`);
    }
    const { errors } = checkFlow(parsed.data);
    if (errors.length) {
      throw new Error(`Invalid flow.yaml:\n${errors.join("\n")}`);
    }
  }

  /** Re-reads bots/<id>/flow.yaml from disk and applies it to the already-running bot's engine —
   *  no restart, no polling interruption. Use this after editing a flow.yaml file directly
   *  (e.g. asking Claude Code to make the change) instead of going through the create form. */
  async reloadFlow(id: string): Promise<void> {
    const entry = this.bots.get(id);
    if (!entry) throw new Error(`Unknown bot: ${id}`);
    const flowYamlText = await Deno.readTextFile(`${BOTS_DIR}/${id}/flow.yaml`);
    this.assertValidFlow(flowYamlText);
    entry.engine.loadFlow(flowYamlText);
  }

  /** Copies the current flow.yaml into versions/ before it gets overwritten — no-op if there's
   *  nothing there yet (brand-new bot). */
  private async archiveCurrentFlow(id: string, label: string): Promise<void> {
    const dir = `${BOTS_DIR}/${id}`;
    let current: string;
    try {
      current = await Deno.readTextFile(`${dir}/flow.yaml`);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return;
      throw e;
    }
    const versionsDir = `${dir}/${VERSIONS_SUBDIR}`;
    await Deno.mkdir(versionsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60) || "edit";
    await Deno.writeTextFile(`${versionsDir}/${ts}__${safeLabel}.yaml`, current);
  }

  /** Validates, archives the current flow.yaml as a restorable snapshot, writes the new one, and
   *  applies it to the live engine. Every accepted edit (form or AI) goes through here — nothing
   *  overwrites flow.yaml without a backup first. */
  async saveFlow(id: string, newYamlText: string, label: string): Promise<void> {
    const entry = this.bots.get(id);
    if (!entry) throw new Error(`Unknown bot: ${id}`);
    this.assertValidFlow(newYamlText);
    await this.archiveCurrentFlow(id, label);
    const dir = `${BOTS_DIR}/${id}`;
    await Deno.writeTextFile(`${dir}/flow.yaml`, newYamlText);
    entry.engine.loadFlow(newYamlText);
  }

  async listVersions(id: string): Promise<FlowVersion[]> {
    const versionsDir = `${BOTS_DIR}/${id}/${VERSIONS_SUBDIR}`;
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(versionsDir));
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return [];
      throw e;
    }
    const versions: FlowVersion[] = [];
    for (const e of entries) {
      if (!e.isFile || !e.name.endsWith(".yaml")) continue;
      const stat = await Deno.stat(`${versionsDir}/${e.name}`);
      const label = e.name.replace(/\.yaml$/, "").split("__").slice(1).join("__") || e.name;
      versions.push({
        filename: e.name,
        label,
        createdAt: (stat.mtime ?? new Date()).toISOString(),
      });
    }
    versions.sort((a, b) => b.filename.localeCompare(a.filename)); // newest first
    return versions;
  }

  /** Restores a past snapshot — the current state is archived first too, so restoring is itself
   *  undoable (it just becomes the newest entry in the same history). */
  async restoreVersion(id: string, filename: string): Promise<void> {
    if (filename.includes("/") || filename.includes("..")) {
      throw new Error("Invalid version filename");
    }
    const text = await Deno.readTextFile(`${BOTS_DIR}/${id}/${VERSIONS_SUBDIR}/${filename}`);
    await this.saveFlow(id, text, `restore-${filename.slice(0, 40)}`);
  }

  /** Validates the flow + token, persists bots/<id>/{meta.json,flow.yaml}, and starts polling. */
  async createBot(
    token: string,
    flowYamlText: string,
    providerToken?: string,
  ): Promise<BotMeta> {
    this.assertValidFlow(flowYamlText);

    const probe = new Bot(token);
    let me: Awaited<ReturnType<typeof probe.api.getMe>>;
    try {
      me = await probe.api.getMe();
    } catch (e) {
      throw new Error(`Invalid bot token: ${(e as Error).message}`);
    }

    const id = String(me.id);
    const dir = `${BOTS_DIR}/${id}`;
    await Deno.mkdir(dir, { recursive: true });

    const meta: BotMeta = {
      id,
      name: me.first_name,
      username: me.username ?? "",
      token,
      providerToken,
      createdAt: new Date().toISOString(),
    };
    await Deno.writeTextFile(`${dir}/meta.json`, JSON.stringify(meta, null, 2));
    await Deno.writeTextFile(`${dir}/flow.yaml`, flowYamlText);

    await this.stop(id); // re-submitting an existing bot's token restarts it on the new flow

    const engine = new FlowEngine(`${dir}/data`);
    engine.loadFlow(flowYamlText);
    const bot = createTelegramBot(token, engine, { providerToken, mediaDir: `${dir}/media` });
    this.bots.set(id, { meta, bot, engine, running: true });
    this.launch(id, meta, bot);

    return meta;
  }

  async stop(id: string): Promise<void> {
    const entry = this.bots.get(id);
    if (!entry || !entry.running) return;
    await entry.bot.stop();
    entry.running = false;
  }

  // Kept async to mirror stop()'s signature at call sites (`await manager.start(id)`); the
  // actual launch is fire-and-forget by design, see launch().
  // deno-lint-ignore require-await
  async start(id: string): Promise<void> {
    const entry = this.bots.get(id);
    if (!entry) throw new Error(`Unknown bot: ${id}`);
    if (entry.running) return;
    const bot = createTelegramBot(entry.meta.token, entry.engine, {
      providerToken: entry.meta.providerToken,
      mediaDir: `${BOTS_DIR}/${id}/media`,
    });
    entry.bot = bot;
    entry.running = true;
    this.launch(id, entry.meta, bot);
  }

  list(): Array<BotMeta & { running: boolean }> {
    return [...this.bots.values()].map((e) => ({ ...e.meta, running: e.running }));
  }

  get(id: string): BotEntry | undefined {
    return this.bots.get(id);
  }
}
