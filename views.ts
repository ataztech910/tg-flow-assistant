import type { BotMeta, FlowVersion } from "./bot-manager.ts";
import type { FlowDefinition } from "./schema.ts";
import type { RFGraph } from "./flow-to-reactflow.ts";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Embeds data as JSON inside a <script type="application/json"> tag safely — escapes "<" so a
 *  node's text can never contain a literal "</script>" and break out of the tag. */
function jsonScript(id: string, data: unknown): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script id="${id}" type="application/json">${json}</script>`;
}

const CSS = `
:root {
  --bg: #f6f7f9; --sheet: #ffffff; --canvas: #eef0f3; --grid-line: #e1e5ea; --ink: #131720; --ink-dim: #5b6472;
  --border: #d7dce2; --accent: #0e7c86; --accent-soft: #e3f2f2; --accent-ink: #075158;
  --ok: #1a7f4b; --ok-soft: #e4f5ec; --off: #8b97a6; --off-soft: #eef0f3; --danger: #b3532f;
  --mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --sans: "IBM Plex Sans", system-ui, -apple-system, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0f14; --sheet: #171d26; --canvas: #0e131a; --grid-line: #232c38; --ink: #e7ebef; --ink-dim: #8b97a6;
    --border: #2a3441; --accent: #52d4c7; --accent-soft: #102c2b; --accent-ink: #8fe8dc;
    --ok: #4ad28a; --ok-soft: #113023; --off: #67707c; --off-soft: #1a212a; --danger: #e08e63;
  }
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font-family: var(--sans); margin: 0; }
.wrap { max-width: 980px; margin: 0 auto; padding: 0 20px 48px; }
.topbar { padding: 22px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
.brand { font-family: var(--mono); font-weight: 700; color: var(--ink); text-decoration: none; font-size: 1.05rem; }
h1 { font-family: var(--mono); font-size: 1.3rem; margin: 0 0 4px; text-wrap: balance; }
h2 { font-family: var(--mono); font-size: 0.75rem; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-dim); margin: 0 0 12px; }
a { color: var(--accent-ink); }
.section { margin-bottom: 28px; }
.pill { display: inline-flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: .72rem; padding: 2px 9px; border-radius: 999px; text-transform: uppercase; letter-spacing: .04em; }
.pill.running { background: var(--ok-soft); color: var(--ok); }
.pill.stopped { background: var(--off-soft); color: var(--off); }
.pill::before { content: "●"; font-size: .55rem; }
.card { background: var(--sheet); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
.bot-list { display: flex; flex-direction: column; gap: 10px; }
.bot-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.bot-row .id { color: var(--ink-dim); font-family: var(--mono); font-size: .78rem; }
.bot-row .name { font-weight: 600; }
.bot-row .actions { display: flex; gap: 8px; align-items: center; }
.bot-row a.open { font-family: var(--mono); font-size: .82rem; }
.empty { color: var(--ink-dim); font-size: .9rem; }
form.inline { display: inline; }
label { display: block; font-size: .78rem; color: var(--ink-dim); margin: 14px 0 5px; }
label:first-child { margin-top: 0; }
input[type=text], input[type=password], input[type=number], select, textarea {
  width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 9px 11px; color: var(--ink); font-family: var(--mono); font-size: .85rem;
}
textarea#flow_yaml { min-height: 220px; resize: vertical; line-height: 1.5; }
.form-field textarea { min-height: 70px; }
button {
  font-family: var(--mono); font-size: .82rem; border: 1px solid var(--accent); background: var(--accent-soft);
  color: var(--accent-ink); padding: 7px 14px; border-radius: 6px; cursor: pointer;
}
button:hover { filter: brightness(0.96); }
button.ghost { background: transparent; border-color: var(--border); color: var(--ink-dim); }
button.submit { background: var(--accent); color: white; padding: 10px 18px; font-size: .85rem; }
.error-banner { background: var(--accent-soft); border: 1px solid var(--danger); color: var(--danger); padding: 10px 14px; border-radius: 8px; font-size: .85rem; margin-bottom: 16px; font-family: var(--mono); white-space: pre-wrap; }
.stats { display: flex; gap: 20px; font-family: var(--mono); font-variant-numeric: tabular-nums; margin-bottom: 16px; }
.stat b { display: block; font-size: 1.2rem; }
.stat small { color: var(--ink-dim); font-size: .68rem; text-transform: uppercase; letter-spacing: .06em; }
.sheet { background: var(--canvas); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.rf-wrap { height: 620px; }
.rf-wrap .react-flow__attribution { display: none; }
.rf-wrap .react-flow__edge-text { font-family: var(--sans); font-size: 11px; fill: var(--ink); }
.rf-wrap .react-flow__edge-textbg { fill: var(--sheet); }
.rf-wrap .react-flow__controls { box-shadow: none; }
.rf-wrap .react-flow__controls button { background: var(--sheet); border-bottom: 1px solid var(--border); fill: var(--ink); }
.legend-row { display: flex; gap: 14px; flex-wrap: wrap; padding: 10px 14px; border-top: 1px solid var(--border); font-size: .76rem; color: var(--ink-dim); background: var(--sheet); }
.legend-row .dot { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 5px; vertical-align: middle; }

.flow-card { background: var(--sheet); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 4px 10px rgba(0,0,0,.04); padding: 13px 15px; width: 280px; }
.flow-card .eyebrow { font-family: var(--mono); font-size: .66rem; text-transform: uppercase; letter-spacing: .07em;
  color: var(--ink-dim); display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
.flow-card .title { font-family: var(--mono); font-weight: 600; font-size: .86rem; color: var(--ink);
  margin-bottom: 6px; word-break: break-word; }
.flow-card .body { font-size: .78rem; color: var(--ink-dim); line-height: 1.45; margin-bottom: 8px; }
.flow-card .rows { display: flex; flex-direction: column; gap: 5px; border-top: 1px solid var(--border); padding-top: 8px; }
.flow-card .row { display: flex; align-items: center; gap: 6px; font-size: .74rem; color: var(--ink);
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 5px 9px; }
.flow-card .row .arrow { color: var(--ink-dim); }
.flow-card.active { box-shadow: 0 0 0 2px var(--accent), 0 6px 22px rgba(0,0,0,.16); }

.test-panel { display: flex; flex-direction: column; gap: 10px; }
.test-msg { font-size: .9rem; line-height: 1.5; white-space: pre-wrap; }
.test-invoice { font-family: var(--mono); font-size: .85rem; background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px 12px; width: fit-content; }
.test-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.test-text-form { display: flex; gap: 8px; }
.test-text-form input { flex: 1; }
.test-controls { padding-top: 4px; border-top: 1px solid var(--border); margin-top: 2px; }

button.small { padding: 4px 9px; font-size: .74rem; }
button.danger { border-color: var(--danger); color: var(--danger); background: transparent; }

.node-panel { margin-top: 16px; display: flex; flex-direction: column; gap: 12px; }
.node-panel-header { display: flex; justify-content: space-between; align-items: center; }
.node-panel-header .title { font-family: var(--mono); font-weight: 600; }
.node-form { display: flex; flex-direction: column; gap: 12px; }
.form-field { display: flex; flex-direction: column; gap: 4px; }
.form-field label { font-size: .74rem; color: var(--ink-dim); text-transform: uppercase; letter-spacing: .04em; }
.form-field textarea { font-family: var(--sans); font-size: .85rem; resize: vertical; }
.form-field input[type=number] { width: 140px; }
.media-field { display: flex; flex-direction: column; gap: 6px; }
.media-uploader { display: flex; align-items: center; gap: 8px; }
.media-uploader input[type=file] { width: auto; background: transparent; border: none; padding: 0; font-size: .8rem; }
.button-list { display: flex; flex-direction: column; gap: 6px; }
.button-row { display: flex; gap: 6px; align-items: center; }
.button-row input { flex: 1 1 auto; min-width: 0; }
.button-row select { flex: 0 0 auto; width: auto; min-width: 140px; }
.field-hint { font-size: .72rem; color: var(--ink-dim); margin: -2px 0 2px; }
.node-panel-actions { display: flex; gap: 8px; padding-top: 6px; border-top: 1px solid var(--border); }

.node-panel-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.node-panel-tabs .tab { background: transparent; border: none; border-radius: 0; padding: 6px 4px; margin-bottom: -1px;
  color: var(--ink-dim); border-bottom: 2px solid transparent; }
.node-panel-tabs .tab.active { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
.ai-panel { display: flex; flex-direction: column; gap: 10px; }
.ai-quick-actions { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.ai-input-form { display: flex; gap: 8px; align-items: flex-end; }
.ai-input-form textarea { flex: 1; font-family: var(--sans); font-size: .85rem; min-height: 44px; resize: vertical; }
table { width: 100%; border-collapse: collapse; font-size: .85rem; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); }
th { font-family: var(--mono); font-size: .7rem; text-transform: uppercase; color: var(--ink-dim); letter-spacing: .05em; }
td { font-family: var(--mono); }
code { font-family: var(--mono); background: var(--accent-soft); color: var(--accent-ink); padding: 1px 5px; border-radius: 4px; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="topbar"><a class="brand" href="/">BotFlow</a></div>
  ${body}
</div>
</body>
</html>`;
}

export function renderHome(
  bots: Array<BotMeta & { running: boolean }>,
  opts: { error?: string; prefillToken?: string; prefillFlow?: string } = {},
): string {
  const rows = bots.length
    ? bots.map((b) => `
      <div class="bot-row card">
        <div>
          <span class="name">${escapeHtml(b.name)}</span>
          <span class="id">@${escapeHtml(b.username)} · id ${escapeHtml(b.id)}</span>
        </div>
        <div class="actions">
          <span class="pill ${b.running ? "running" : "stopped"}">${b.running ? "running" : "stopped"}</span>
          <a class="open" href="/bots/${b.id}">Open →</a>
        </div>
      </div>`).join("\n")
    : `<p class="empty">No bots yet — create one below.</p>`;

  const error = opts.error
    ? `<div class="error-banner">${escapeHtml(opts.error)}</div>`
    : "";

  return layout("BotFlow", `
    <div class="section">
      <h2>Bots</h2>
      <div class="bot-list">${rows}</div>
    </div>
    <div class="section">
      <h2>Create a bot</h2>
      <div class="card">
        ${error}
        <form method="POST" action="/bots">
          <label for="token">Bot token (from @BotFather)</label>
          <input type="text" id="token" name="token" placeholder="123456:AA..." value="${
    escapeHtml(opts.prefillToken ?? "")
  }" required>
          <label for="provider_token">Payment provider token (optional — leave empty, Stars work without one)</label>
          <input type="text" id="provider_token" name="provider_token" placeholder="optional">

          <label for="description">Describe the bot you want</label>
          <textarea id="description" placeholder="e.g. A support bot that greets users, asks their name and email, then forwards it to our CRM webhook, then offers a paid Pro plan via Telegram Stars." rows="3"></textarea>
          <div style="margin-top:8px; display:flex; align-items:center; gap:10px;">
            <button type="button" id="generate-btn" class="ghost">✨ Generate flow.yaml</button>
            <span id="generate-status" class="field-hint"></span>
          </div>

          <label for="flow_yaml" style="margin-top:18px">flow.yaml (filled in by Generate above — or paste/edit your own)</label>
          <textarea id="flow_yaml" name="flow_yaml" placeholder="start_node: welcome&#10;nodes:&#10;  welcome:&#10;    type: message&#10;    text: &quot;Hi!&quot;" required>${
    escapeHtml(opts.prefillFlow ?? "")
  }</textarea>
          <div style="margin-top:16px"><button class="submit" type="submit">Validate &amp; start bot</button></div>
        </form>
      </div>
    </div>
    <script>
      (function () {
        var btn = document.getElementById("generate-btn");
        var status = document.getElementById("generate-status");
        var desc = document.getElementById("description");
        var yamlBox = document.getElementById("flow_yaml");
        btn.addEventListener("click", function () {
          var text = desc.value.trim();
          if (!text) { status.textContent = "Describe the bot first."; return; }
          btn.disabled = true;
          status.textContent = "Generating… this calls the model, can take a little while.";
          fetch("/generate-flow", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ description: text }),
          })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (res) {
              btn.disabled = false;
              if (!res.ok) { status.textContent = res.data.error || "Generation failed."; return; }
              yamlBox.value = res.data.yaml;
              status.textContent = "Generated — review below, then Validate & start bot.";
            })
            .catch(function (e) { btn.disabled = false; status.textContent = String(e); });
        });
      })();
    </script>
  `);
}

export function renderNotFound(id: string): string {
  return layout("Not found", `<p>No bot with id <code>${escapeHtml(id)}</code>.</p><p><a href="/">← Back</a></p>`);
}

export function renderError(botId: string, message: string): string {
  return layout("Error · BotFlow", `
    <div class="error-banner">${escapeHtml(message)}</div>
    <p class="empty"><a href="/bots/${escapeHtml(botId)}">← Back to bot</a></p>
  `);
}

const NODE_TYPE_COLORS: Array<[string, string]> = [
  ["message", "#0e7c86"],
  ["menu", "#c78a1f"],
  ["input", "#3866c9"],
  ["webhook", "#8547c9"],
  ["collect", "#1a7f4b"],
  ["payment", "#c23f6c"],
];

export function renderBotDashboard(
  meta: BotMeta,
  running: boolean,
  flow: FlowDefinition,
  graph: RFGraph,
  recentLeads: Record<string, unknown>[],
  versions: FlowVersion[] = [],
): string {
  const nodeCount = Object.keys(flow.nodes).length;
  const versionsList = versions.length
    ? versions.map((v) => `
        <div class="bot-row">
          <div>
            <span class="name">${escapeHtml(v.label)}</span>
            <span class="id">${escapeHtml(new Date(v.createdAt).toLocaleString())}</span>
          </div>
          <form class="inline" method="POST" action="/bots/${meta.id}/versions/${
      encodeURIComponent(v.filename)
    }/restore">
            <button class="ghost small" type="submit">Restore</button>
          </form>
        </div>`).join("\n")
    : `<p class="empty">No saved versions yet — history starts after the first edit.</p>`;
  const leadsTable = recentLeads.length
    ? `<table>
        <thead><tr>${Object.keys(recentLeads[0]).map((k) => `<th>${escapeHtml(k)}</th>`).join("")}</tr></thead>
        <tbody>${
      recentLeads.map((row) =>
        `<tr>${Object.values(row).map((v) => `<td>${escapeHtml(String(v))}</td>`).join("")}</tr>`
      ).join("\n")
    }</tbody>
      </table>`
    : `<p class="empty">No collected data yet.</p>`;

  return layout(`${meta.name} · BotFlow`, `
    <div class="section" style="display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:12px;">
      <div>
        <h1>${escapeHtml(meta.name)} <span style="color:var(--ink-dim); font-weight:400;">@${
    escapeHtml(meta.username)
  }</span></h1>
        <span class="pill ${running ? "running" : "stopped"}">${running ? "running" : "stopped"}</span>
      </div>
      <div style="display:flex; gap:8px;">
        <form class="inline" method="POST" action="/bots/${meta.id}/reload">
          <button class="ghost" type="submit" title="Re-read flow.yaml from disk and apply it without restarting">↻ Reload flow</button>
        </form>
        <form class="inline" method="POST" action="/bots/${meta.id}/${running ? "stop" : "start"}">
          <button class="${running ? "ghost" : ""}" type="submit">${running ? "Stop" : "Start"}</button>
        </form>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><b>${nodeCount}</b><small>nodes</small></div>
      <div class="stat"><b>${escapeHtml(flow.start_node)}</b><small>start node</small></div>
    </div>

    <div class="section" id="dashboard-root"></div>
    ${jsonScript("rf-data", graph)}
    ${
    jsonScript("dash-config", {
      botId: meta.id,
      startNodeId: flow.start_node,
      legend: NODE_TYPE_COLORS,
      flow: flow,
    })
  }

    <div class="section">
      <h2>Version history</h2>
      <div class="bot-list">${versionsList}</div>
    </div>

    <div class="section">
      <h2>Recent collected data</h2>
      <div class="card">${leadsTable}</div>
    </div>

    <p class="empty"><a href="/">← All bots</a></p>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reactflow@11/dist/style.css">
    <script src="https://cdn.jsdelivr.net/npm/reactflow@11/dist/umd/index.js"></script>
    <script>
      (function () {
        var graph = JSON.parse(document.getElementById("rf-data").textContent);
        var config = JSON.parse(document.getElementById("dash-config").textContent);
        var h = React.createElement;
        var RF = window.ReactFlow;
        var gridColor = getComputedStyle(document.documentElement).getPropertyValue("--grid-line").trim();
        var testBase = "/bots/" + config.botId + "/test";

        function CardNode(props) {
          var d = props.data;
          return h("div", { className: "flow-card" + (d.active ? " active" : ""), style: { borderLeft: "4px solid " + d.accent } },
            h(RF.Handle, { type: "target", position: RF.Position.Left }),
            h(RF.Handle, { type: "source", position: RF.Position.Right }),
            h("div", { className: "eyebrow" }, d.icon + " " + d.typeLabel),
            h("div", { className: "title" }, d.title),
            d.body ? h("div", { className: "body" }, d.body) : null,
            d.rows && d.rows.length
              ? h("div", { className: "rows" }, d.rows.map(function (r, i) {
                  return h("div", { className: "row", key: i }, h("span", { className: "arrow" }, "→"), r);
                }))
              : null
          );
        }

        // Stable reference — recreating this object on every render makes React Flow think the
        // node types changed and remount everything, which is a common cause of "drag does nothing".
        var nodeTypes = { card: CardNode };

        function AutoCenter(props) {
          var rf = RF.useReactFlow();
          React.useEffect(function () {
            if (!props.activeId) return;
            rf.fitView({ nodes: [{ id: props.activeId }], duration: 450, padding: 0.6, maxZoom: 1.1 });
          }, [props.activeId]);
          return null;
        }

        function TestPanel(props) {
          var t = props.test;
          var body = [h("div", { className: "test-msg", key: "msg" }, t.text || "Click Start to begin.")];

          if (t.kind === "invoice") {
            body.push(
              h("div", { className: "test-invoice", key: "inv" }, t.title + " — " + t.amount + " " + t.currency),
              h("button", { key: "pay", onClick: props.onPayment }, "Simulate successful payment"),
            );
          } else if (t.buttons && t.buttons.length) {
            body.push(h("div", { className: "test-buttons", key: "btns" },
              t.buttons.map(function (b, i) {
                return h("button", { key: i, className: "ghost", onClick: function () { props.onButton(b.next); } }, b.label);
              })
            ));
          } else if (t.started) {
            body.push(h("form", {
                key: "form", className: "test-text-form", onSubmit: function (e) {
                  e.preventDefault();
                  var input = e.target.elements.reply;
                  if (!input.value) return;
                  props.onText(input.value);
                  input.value = "";
                },
              },
              h("input", { type: "text", name: "reply", placeholder: "Type a reply…", autoComplete: "off" }),
              h("button", { type: "submit" }, "Send"),
            ));
          }
          if (t.ignored) body.push(h("p", { className: "empty", key: "ig" }, "This step doesn't expect a text reply."));

          return h("div", { className: "card test-panel" },
            body,
            h("div", { className: "test-controls", key: "ctrl" },
              h("button", { className: "ghost", onClick: props.onRestart }, t.started ? "↻ Restart test run" : "▶ Start test run")
            )
          );
        }

        var NODE_TYPES = ["message", "menu", "input", "webhook", "collect", "payment", "condition", "subscribe", "event"];

        function defaultNodeFor(type) {
          switch (type) {
            case "message": return { type: "message", text: "New message" };
            case "menu": return { type: "menu", text: "New menu", buttons: [] };
            case "input": return { type: "input", text: "Ask something?", save_as: "field" };
            case "webhook": return { type: "webhook", url: "https://", method: "POST" };
            case "collect": return { type: "collect" };
            case "payment": return { type: "payment", title: "Item", description: "", currency: "XTR", amount: 1, payload: "item" };
            case "condition": return { type: "condition", field: "field_name" };
            case "subscribe": return { type: "subscribe" };
            case "event": return { type: "event", message: "🚨 {{message}}" };
          }
        }

        function field(label, input, key) {
          return h("div", { className: "form-field", key: key || label }, h("label", null, label), input);
        }
        function textInput(value, onInput, placeholder) {
          return h("input", {
            type: "text", value: value || "", placeholder: placeholder || "",
            onChange: function (e) { onInput(e.target.value); },
          });
        }
        function textArea(value, onInput) {
          return h("textarea", { value: value || "", rows: 3, onChange: function (e) { onInput(e.target.value); } });
        }
        function nextSelect(value, onInput, allNodeIds, allowEmpty) {
          var opts = [];
          if (allowEmpty) opts.push(h("option", { value: "", key: "" }, "— none —"));
          allNodeIds.forEach(function (id) { opts.push(h("option", { value: id, key: id }, id)); });
          return h("select", { value: value || "", onChange: function (e) { onInput(e.target.value || undefined); } }, opts);
        }

        function ButtonListEditor(props) {
          var buttons = props.buttons || [];
          function update(i, patch) {
            var next = buttons.slice();
            next[i] = Object.assign({}, next[i], patch);
            props.onChange(next);
          }
          function remove(i) {
            var next = buttons.slice();
            next.splice(i, 1);
            props.onChange(next);
          }
          function add() {
            props.onChange(buttons.concat([{ label: "New button", next: props.allNodeIds[0] || "" }]));
          }
          return h("div", { className: "button-list" },
            buttons.length
              ? h("p", { className: "field-hint", key: "hint" }, "Each row: button text shown to the user, then which node it leads to.")
              : null,
            buttons.map(function (b, i) {
              return h("div", { className: "button-row", key: i },
                textInput(b.label, function (v) { update(i, { label: v }); }, "Button text"),
                nextSelect(b.next, function (v) { update(i, { next: v }); }, props.allNodeIds, false),
                h("button", { type: "button", className: "ghost small", onClick: function () { remove(i); } }, "✕"),
              );
            }),
            h("button", { type: "button", className: "ghost small", onClick: add }, "+ Add button"),
          );
        }

        function MediaUploader(props) {
          var busyS = React.useState(false);
          var busy = busyS[0], setBusy = busyS[1];
          var errS = React.useState("");
          var err = errS[0], setErr = errS[1];

          function handleFile(e) {
            var file = e.target.files[0];
            if (!file) return;
            setBusy(true);
            setErr("");
            var fd = new FormData();
            fd.append("file", file);
            fetch("/bots/" + props.botId + "/media", { method: "POST", body: fd })
              .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
              .then(function (res) {
                setBusy(false);
                if (!res.ok) { setErr(res.data.error || "Upload failed."); return; }
                props.onUploaded(res.data.filename);
              })
              .catch(function (e) { setBusy(false); setErr(String(e)); });
          }

          return h("div", { className: "media-uploader" },
            err ? h("div", { className: "error-banner" }, err) : null,
            h("input", { type: "file", onChange: handleFile, disabled: busy }),
            busy ? h("span", { className: "field-hint" }, "Uploading…") : null,
          );
        }

        function NodeForm(props) {
          var node = props.node;
          var allNodeIds = props.allNodeIds;
          function set(patch) { props.onChange(Object.assign({}, node, patch)); }
          var fields = [];
          switch (node.type) {
            case "message":
            case "menu":
              fields.push(field(
                node.media ? "Text (caption)" : "Text",
                textArea(node.text, function (v) { set({ text: v }); }),
              ));
              fields.push(field("Media (optional)", h("div", { className: "media-field" },
                h("select", {
                    value: (node.media && node.media.kind) || "",
                    onChange: function (e) {
                      var kind = e.target.value;
                      if (!kind) { set({ media: undefined }); return; }
                      set({ media: { kind: kind, url: (node.media && node.media.url) || "" } });
                    },
                  },
                  h("option", { value: "" }, "— none —"),
                  ["photo", "video", "audio", "document", "voice"].map(function (k) {
                    return h("option", { value: k, key: k }, k);
                  }),
                ),
                node.media
                  ? h(React.Fragment, null,
                      textInput(
                        node.media.url,
                        function (v) { set({ media: { kind: node.media.kind, url: v } }); },
                        "https://... (a direct link Telegram can fetch)",
                      ),
                      h("p", { className: "field-hint" }, "— or —"),
                      h(MediaUploader, {
                        botId: props.botId,
                        onUploaded: function (filename) { set({ media: { kind: node.media.kind, url: filename } }); },
                      }),
                      !node.media.url
                        ? h("p", { className: "field-hint" }, "Pick a URL above or upload a file below before saving — an empty value will fail validation.")
                        : (node.media.url.indexOf("http") !== 0
                          ? h("p", { className: "field-hint" }, "Using uploaded file: " + node.media.url + " (sent directly by the bot, no public URL needed)")
                          : null),
                    )
                  : null,
              )));
              fields.push(field(
                node.type === "menu" ? "Buttons (at least one required)" : "Buttons (optional)",
                h(ButtonListEditor, { buttons: node.buttons, allNodeIds: allNodeIds, onChange: function (v) { set({ buttons: v }); } }),
              ));
              break;
            case "input":
              fields.push(field("Prompt text", textArea(node.text, function (v) { set({ text: v }); })));
              fields.push(field("Save reply as", textInput(node.save_as, function (v) { set({ save_as: v }); })));
              fields.push(field("Next", nextSelect(node.next, function (v) { set({ next: v }); }, allNodeIds, false)));
              break;
            case "webhook":
              fields.push(field("URL", textInput(node.url, function (v) { set({ url: v }); })));
              fields.push(field("Method", h("select", { value: node.method || "POST", onChange: function (e) { set({ method: e.target.value }); } },
                ["GET", "POST", "PUT", "PATCH"].map(function (m) { return h("option", { value: m, key: m }, m); }))));
              fields.push(field("Next", nextSelect(node.next, function (v) { set({ next: v }); }, allNodeIds, false)));
              fields.push(field("On error (optional)", nextSelect(node.on_error, function (v) { set({ on_error: v }); }, allNodeIds, true)));
              fields.push(h("p", { className: "empty", key: "adv" }, "Headers/body/save_response_as aren't editable here yet — ask the AI tab or edit flow.yaml directly."));
              break;
            case "collect":
              fields.push(field("Fields (comma-separated, empty = all collected so far)",
                textInput((node.fields || []).join(", "), function (v) {
                  var f = v.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
                  set({ fields: f.length ? f : undefined });
                })));
              fields.push(field("Next", nextSelect(node.next, function (v) { set({ next: v }); }, allNodeIds, false)));
              break;
            case "payment":
              fields.push(field("Title", textInput(node.title, function (v) { set({ title: v }); })));
              fields.push(field("Description", textArea(node.description, function (v) { set({ description: v }); })));
              fields.push(field("Currency (e.g. XTR, USD)", textInput(node.currency, function (v) { set({ currency: v }); })));
              fields.push(field("Amount", h("input", {
                type: "number", value: node.amount || 0,
                onChange: function (e) { set({ amount: Number(e.target.value) }); },
              })));
              fields.push(field("Payload (internal id, not shown to user)", textInput(node.payload, function (v) { set({ payload: v }); })));
              fields.push(field("Next", nextSelect(node.next, function (v) { set({ next: v }); }, allNodeIds, false)));
              break;
            case "condition":
              fields.push(field("Field to check (from an earlier input's save_as, or a payment's payload)",
                textInput(node.field, function (v) { set({ field: v }); })));
              fields.push(field("Equals (optional — leave empty to just check the field is set)",
                textInput(node.equals, function (v) { set({ equals: v || undefined }); })));
              fields.push(field("If true", nextSelect(node.if_true, function (v) { set({ if_true: v }); }, allNodeIds, false)));
              fields.push(field("If false", nextSelect(node.if_false, function (v) { set({ if_false: v }); }, allNodeIds, false)));
              break;
            case "subscribe":
              fields.push(h("p", { className: "field-hint" }, "Adds whoever reaches this node to the subscriber list — no fields to configure."));
              fields.push(field("Next", nextSelect(node.next, function (v) { set({ next: v }); }, allNodeIds, false)));
              break;
            case "event":
              fields.push(h("p", { className: "field-hint" }, "Not reached by users — an external system POSTs to /event/<bot-id>/<this node's id> (see README) and this renders against that request's JSON body, sent to every subscriber."));
              fields.push(field("Message template ({{field}} for values from the POST body)",
                textArea(node.message, function (v) { set({ message: v }); })));
              break;
          }
          return h("div", { className: "node-form" }, fields);
        }

        function AiEditPanel(props) {
          var instrS = React.useState("");
          var instruction = instrS[0], setInstruction = instrS[1];
          var busyS = React.useState(false);
          var busy = busyS[0], setBusy = busyS[1];
          var errS = React.useState("");
          var err = errS[0], setErr = errS[1];

          var quickActions = [
            "Rewrite this node's text to sound friendlier",
            "Add a button to this node",
            "Delete this node and rewire anything that pointed to it",
          ];

          function send(text) {
            if (!text || busy) return;
            setBusy(true);
            setErr("");
            fetch("/bots/" + props.botId + "/ai-edit", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ instruction: text, nodeId: props.nodeId }),
            })
              .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
              .then(function (res) {
                if (!res.ok) {
                  setBusy(false);
                  setErr(res.data.error || "AI edit failed.");
                  return;
                }
                window.location.reload();
              })
              .catch(function (e) { setBusy(false); setErr(String(e)); });
          }

          return h("div", { className: "ai-panel" },
            err ? h("div", { className: "error-banner" }, err) : null,
            h("div", { className: "ai-quick-actions" },
              quickActions.map(function (q, i) {
                return h("button", {
                  key: i, type: "button", className: "ghost small", disabled: busy,
                  onClick: function () { send(q); },
                }, q);
              }),
            ),
            h("form", {
                className: "ai-input-form",
                onSubmit: function (e) { e.preventDefault(); send(instruction); },
              },
              h("textarea", {
                value: instruction, rows: 2, placeholder: "Describe what to change…",
                onChange: function (e) { setInstruction(e.target.value); },
              }),
              h("button", { type: "submit", disabled: busy || !instruction }, busy ? "Thinking…" : "Send"),
            ),
            busy ? h("p", { className: "empty" }, "Calling the model — this can take a little while.") : null,
          );
        }

        function NodePanel(props) {
          var tabS = React.useState("edit");
          var tab = tabS[0], setTab = tabS[1];
          return h("div", { className: "card node-panel" },
            h("div", { className: "node-panel-header" },
              h("span", { className: "title" }, props.nodeId + (props.isStart ? "  ⭐ start" : "")),
              h("button", { className: "ghost small", onClick: props.onClose }, "✕"),
            ),
            h("div", { className: "node-panel-tabs" },
              h("button", {
                type: "button", className: "tab" + (tab === "edit" ? " active" : ""),
                onClick: function () { setTab("edit"); },
              }, "Edit"),
              h("button", {
                type: "button", className: "tab" + (tab === "ai" ? " active" : ""),
                onClick: function () { setTab("ai"); },
              }, "Ask AI"),
            ),
            tab === "edit"
              ? h(React.Fragment, null,
                  props.error ? h("div", { className: "error-banner" }, props.error) : null,
                  h(NodeForm, { node: props.node, allNodeIds: props.allNodeIds, botId: props.botId, onChange: props.onDraftChange }),
                  h("div", { className: "node-panel-actions" },
                    h("button", { onClick: props.onSave, disabled: props.saving }, props.saving ? "Saving…" : "Save"),
                    (props.isStart || props.node.type === "event") ? null : h("button", { className: "ghost", onClick: props.onSetStart }, "Set as start"),
                    h("button", { className: "ghost danger", onClick: props.onDelete }, "Delete node"),
                  ),
                )
              : h(AiEditPanel, { botId: props.botId, nodeId: props.nodeId }),
          );
        }

        function App() {
          var testS = React.useState({ nodeId: config.startNodeId, text: "", started: false });
          var test = testS[0], setTest = testS[1];
          var nodesS = RF.useNodesState(graph.nodes);
          var nodes = nodesS[0], setNodes = nodesS[1], onNodesChange = nodesS[2];
          var edgesS = RF.useEdgesState(graph.edges);
          var edges = edgesS[0], onEdgesChange = edgesS[2];

          // The dashboard's own working copy of the flow, edited by the node panel. The visual
          // graph (nodes/edges above) is NOT kept live in sync with this — a successful save just
          // reloads the page, which recomputes the graph server-side. Simpler than hot-swapping
          // React Flow's layout mid-session, and good enough for this iteration.
          var flowS = React.useState(config.flow);
          var flowState = flowS[0];
          var selS = React.useState(null);
          var selectedId = selS[0], setSelectedId = selS[1];
          var draftS = React.useState(null);
          var draft = draftS[0], setDraft = draftS[1];
          var savingS = React.useState(false);
          var saving = savingS[0], setSaving = savingS[1];
          var formErrorS = React.useState("");
          var formError = formErrorS[0], setFormError = formErrorS[1];
          var newTypeS = React.useState("message");
          var newType = newTypeS[0], setNewType = newTypeS[1];

          React.useEffect(function () {
            setNodes(function (nds) {
              return nds.map(function (n) {
                var active = test.nodeId === n.id;
                if (!!n.data.active === active) return n;
                return Object.assign({}, n, { data: Object.assign({}, n.data, { active: active }) });
              });
            });
          }, [test.nodeId]);

          function call(path, payload) {
            fetch(testBase + path, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: payload ? JSON.stringify(payload) : undefined,
            })
              .then(function (r) { return r.json(); })
              .then(function (data) {
                // {ignored:true} means the step wasn't waiting for text — keep the current node/
                // message on screen (just flag it) instead of wiping state with an empty object.
                if (data.ignored) {
                  setTest(function (prev) { return Object.assign({}, prev, { ignored: true }); });
                } else {
                  setTest(Object.assign({ started: true, ignored: false }, data));
                }
              });
          }

          function openNode(id) {
            setSelectedId(id);
            setDraft(Object.assign({}, flowState.nodes[id]));
            setFormError("");
          }

          function saveFlow(newFlow) {
            setSaving(true);
            setFormError("");
            fetch("/bots/" + config.botId + "/flow", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ flow: newFlow }),
            })
              .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
              .then(function (res) {
                if (!res.ok) {
                  setSaving(false);
                  setFormError(res.data.error || "Save failed.");
                  return;
                }
                window.location.reload();
              })
              .catch(function (e) {
                setSaving(false);
                setFormError(String(e));
              });
          }

          function onSaveNode() {
            var newFlow = Object.assign({}, flowState, { nodes: Object.assign({}, flowState.nodes) });
            newFlow.nodes[selectedId] = draft;
            saveFlow(newFlow);
          }

          function onDeleteNode() {
            var newFlow = Object.assign({}, flowState, { nodes: Object.assign({}, flowState.nodes) });
            delete newFlow.nodes[selectedId];
            saveFlow(newFlow);
          }

          function onSetStart() {
            saveFlow(Object.assign({}, flowState, { start_node: selectedId }));
          }

          function onAddNode() {
            var n = 1;
            while (flowState.nodes["node_" + n]) n++;
            var id = "node_" + n;
            var newFlow = Object.assign({}, flowState, { nodes: Object.assign({}, flowState.nodes) });
            newFlow.nodes[id] = defaultNodeFor(newType);
            saveFlow(newFlow);
          }

          var allNodeIds = Object.keys(flowState.nodes);

          return h(React.Fragment, null,
            h("h2", { key: "h1" }, "Test run"),
            h(TestPanel, {
              key: "panel",
              test: test,
              onRestart: function () { call("/start"); },
              onButton: function (next) { call("/button", { next: next }); },
              onText: function (text) { call("/text", { text: text }); },
              onPayment: function () { call("/payment"); },
            }),
            h("h2", { key: "h2", style: { marginTop: "26px" } }, "Flow diagram"),
            h("div", { className: "sheet", key: "sheet" },
              h("div", { className: "rf-wrap" },
                h(RF.default, {
                    nodes: nodes,
                    edges: edges,
                    onNodesChange: onNodesChange,
                    onEdgesChange: onEdgesChange,
                    onNodeClick: function (_e, node) { openNode(node.id); },
                    nodeTypes: nodeTypes,
                    nodesDraggable: true,
                    minZoom: 0.1,
                    proOptions: { hideAttribution: true },
                  },
                  h(RF.Background, { gap: 20, color: gridColor }),
                  h(RF.Controls, null),
                  h(AutoCenter, { activeId: test.nodeId }),
                )
              ),
              h("div", { className: "legend-row" },
                config.legend.map(function (pair) {
                  return h("span", { key: pair[0] }, h("span", { className: "dot", style: { background: pair[1] } }), pair[0]);
                }),
                h("span", { style: { marginLeft: "auto", display: "flex", gap: "6px", alignItems: "center" } },
                  h("select", { value: newType, onChange: function (e) { setNewType(e.target.value); } },
                    NODE_TYPES.map(function (t) { return h("option", { value: t, key: t }, t); })),
                  h("button", { type: "button", className: "ghost small", onClick: onAddNode, disabled: saving }, "+ Add node"),
                )
              )
            ),
            selectedId
              ? h(NodePanel, {
                  key: "node-panel",
                  botId: config.botId,
                  nodeId: selectedId,
                  node: draft,
                  allNodeIds: allNodeIds,
                  isStart: flowState.start_node === selectedId,
                  saving: saving,
                  error: formError,
                  onClose: function () { setSelectedId(null); },
                  onDraftChange: function (n) { setDraft(n); },
                  onSave: onSaveNode,
                  onDelete: onDeleteNode,
                  onSetStart: onSetStart,
                })
              : null,
          );
        }

        ReactDOM.createRoot(document.getElementById("dashboard-root")).render(h(App));
      })();
    </script>
  `);
}
