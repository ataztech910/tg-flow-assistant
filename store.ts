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
