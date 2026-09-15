# Runs server-prod.ts — webhook-only, no dashboard (see README "Deploying to production").
# Works on any container platform: plain Docker, Google Cloud Run, AWS ECS/Fargate/App Runner.
#
# Build:  docker build -t botflow .
# Run:    docker run -p 8000:8000 --env-file deploy.env -v botflow-data:/app/bots botflow

FROM denoland/deno:2.7.14

WORKDIR /app

# Cache dependencies in their own layer so code-only changes don't re-download them.
COPY deno.json deno.lock ./
COPY schema.ts flow-check.ts engine.ts store.ts telegram-adapter.ts ai-editor.ts server-prod.ts ./
COPY dsl-rules.md ./
RUN deno cache --allow-import server-prod.ts

# Everything else (only server-prod.ts's own dependency graph actually gets imported at runtime —
# no dashboard, no views.ts, no bot-manager.ts. See README for why).
COPY . .

# bots/<id>/{flow.yaml,media/} plus Deno KV's local SQLite file (used for `collect`, see
# store.ts) live here — mount a volume so they survive restarts.
VOLUME ["/app/bots"]

EXPOSE 8000
ENV PORT=8000

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-import", "server-prod.ts"]
