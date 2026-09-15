// Stand-in "CRM" for local testing — point a webhook node's url at this instead
// of a real service. Prints whatever it receives.

const port = 8787;

Deno.serve({ port }, async (req) => {
  const body = await req.text();
  console.log(`\n[mock-crm] ${req.method} ${req.url}`);
  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    console.log(body);
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
});

console.log(`Mock CRM listening on http://localhost:${port}`);
