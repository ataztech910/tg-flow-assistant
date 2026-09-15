/** Storage for `collect` nodes. `dataDir` is normally a local directory
 *  (bots/<id>/data) — but a `"kv:<botId>"` value switches to Deno KV instead, for
 *  environments with no persistent local disk (Deno Deploy). Same call site either way;
 *  engine.ts doesn't know or care which backend is in use. */
export async function saveLead(
  dataDir: string,
  fields: Record<string, string>,
): Promise<void> {
  const record = { ...fields, savedAt: new Date().toISOString() };

  if (dataDir.startsWith("kv:")) {
    const botId = dataDir.slice(3);
    const kv = await Deno.openKv();
    await kv.set(["leads", botId, crypto.randomUUID()], record);
    return;
  }

  await Deno.mkdir(dataDir, { recursive: true });
  await Deno.writeTextFile(`${dataDir}/leads.jsonl`, JSON.stringify(record) + "\n", {
    append: true,
  });
}

// addSubscriber's disk branch is read-modify-write (read the whole list, add one id, write it
// back) — two calls for the same file racing (e.g. two users subscribing around the same moment)
// can both read the same old list and the second write silently clobbers the first, dropping a
// subscriber. The KV branch doesn't have this problem (kv.set on a per-user key needs no read),
// but disk does. Queuing writes per path serializes them within this process — the one case this
// doesn't cover is multiple *processes* sharing the same file, which nothing here does today
// (self-hosted targets are documented as single-instance).
const diskWriteQueues = new Map<string, Promise<unknown>>();

function withDiskLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prior = diskWriteQueues.get(path) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  diskWriteQueues.set(path, run.then(() => undefined, () => undefined));
  return run;
}

/** Storage for `subscribe` nodes / the `event` broadcast endpoint. Same `dataDir` / `"kv:<id>"`
 *  convention as `saveLead`. Unlike leads (append-only, one row per collect), subscribers are a
 *  deduplicated set — re-subscribing is a no-op, not a new row. */
export async function addSubscriber(dataDir: string, userId: number): Promise<void> {
  if (dataDir.startsWith("kv:")) {
    const botId = dataDir.slice(3);
    const kv = await Deno.openKv();
    await kv.set(["subscribers", botId, String(userId)], true);
    kv.close();
    return;
  }

  await Deno.mkdir(dataDir, { recursive: true });
  const path = `${dataDir}/subscribers.json`;
  await withDiskLock(path, async () => {
    const ids = new Set(await readSubscribersFromDisk(path));
    ids.add(userId);
    await Deno.writeTextFile(path, JSON.stringify([...ids]));
  });
}

export async function listSubscribers(dataDir: string): Promise<number[]> {
  if (dataDir.startsWith("kv:")) {
    const botId = dataDir.slice(3);
    const kv = await Deno.openKv();
    const ids: number[] = [];
    for await (const entry of kv.list<boolean>({ prefix: ["subscribers", botId] })) {
      ids.push(Number(entry.key[entry.key.length - 1]));
    }
    kv.close();
    return ids;
  }
  return readSubscribersFromDisk(`${dataDir}/subscribers.json`);
}

async function readSubscribersFromDisk(path: string): Promise<number[]> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return [];
  }
}
