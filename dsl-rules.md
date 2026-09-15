# BotFlow YAML rules

Give this whole document to an LLM together with a description of the bot you want, and ask it to
produce a `flow.yaml` file. Then run `deno run --allow-read --allow-env validate.ts flow.yaml`
before uploading it — fix whatever errors it prints and ask the LLM to correct the file using them.

## Top-level shape

```yaml
start_node: <id of the first node>
nodes:
  <node_id>: { ...node }
  <node_id>: { ...node }
```

- `start_node` MUST be one of the keys under `nodes`.
- Every node id is an arbitrary snake_case string, unique within the file.
- Every field named `next`, `on_error`, or `on_fail` MUST reference an existing node id.
- Do not invent node types beyond the nine listed below.
- `{{field}}` can be used in any `text`, `url`, `headers`, or `body` value, anywhere in the file, to
  insert a value collected earlier by an `input` node (or stored by `save_response_as`). An unknown
  field renders as an empty string — don't reference a field before an `input` node has collected it.

## Node types

### `message`
Shows text, optionally with buttons. Use for pure info screens.
```yaml
about:
  type: message
  text: "Some info."
  buttons:                 # optional
    - label: "⬅️ Back"
      next: welcome
```

### `menu`
Same as `message` but `buttons` is REQUIRED and must have at least one entry. Use when the point of
the screen is to make the user choose.
```yaml
welcome:
  type: menu
  text: "Choose an option:"
  buttons:
    - label: "About"
      next: about
    - label: "Pricing"
      next: pricing
```

### Sending media (`message`/`menu`)
Both `message` and `menu` accept an optional `media` field to send a photo/video/audio/document/
voice note instead of (or alongside) plain text — `text` becomes the caption shown with it.
```yaml
promo:
  type: message
  text: "Check out our new feature!"
  media:
    kind: photo             # photo | video | audio | document | voice
    url: "https://example.com/promo.jpg"
  buttons:
    - label: "Learn more"
      next: about
```
- `url` is either:
  - a full `http://` or `https://` link — Telegram's own servers fetch it, so it must be publicly
    reachable (not `localhost`); or
  - a bare filename (no `http`) — the bot uploads that file itself, directly, from
    `bots/<id>/media/<filename>`. This works even when the server has no public URL at all, since
    the bot only ever calls out to Telegram, never the other way around. Files get there via the
    dashboard's node panel (upload button next to the media URL field) — an AI-generated flow
    should only reference a bare filename if the user has said they already uploaded one with that
    exact name; otherwise use a real `http(s)://` URL or leave `media` out.
  Not a Telegram `file_id` — this engine doesn't track those.
- `text` is still required even with `media` — it becomes the caption. Keep it short (Telegram
  caption limit is 1024 characters).

### `input`
Sends `text`, then waits for the user's next free-text reply and stores it under `save_as`. The
stored value becomes available as `{{save_as}}` in any later node.
```yaml
ask_email:
  type: input
  text: "What's your email?"
  save_as: email
  next: ask_name
```

### `webhook`
Silently calls an external HTTP API (no message shown to the user), then continues to `next`. Use
this to forward collected data to an outside service (a real CRM, Slack, Zapier, etc.).
```yaml
forward_to_crm:
  type: webhook
  url: "https://example.com/api/leads"
  method: POST              # GET | POST | PUT | PATCH, default POST
  headers:                  # optional
    Authorization: "Bearer xyz"
  body:                     # optional, string values only
    name: "{{name}}"
    email: "{{email}}"
  save_response_as: crm_id  # optional: store the raw response text as a field
  next: thank_you
  on_error: webhook_failed  # optional: node to go to if the call fails or returns non-2xx
```
- If `on_error` is omitted, the flow just continues to `next` even when the call fails — do not
  rely on `on_error` unless you actually add that node.

### `collect`
Silently saves data into BotFlow's own storage (not an outside service — this is "keep it for
ourselves", separate from `webhook`). Continues straight to `next`.
```yaml
save_lead:
  type: collect
  fields: [name, email]     # optional; omit to save everything collected so far
  next: forward_to_crm
```
Every saved record automatically includes the user's real, Telegram-verified identity —
`telegram_id`, `telegram_username`, `telegram_first_name`, `telegram_last_name`,
`telegram_language_code` — even if `fields` doesn't list them and no `input` node ever asked for
them. This happens regardless of what the flow does; don't add an `input` node just to re-collect
something Telegram already tells us. These same fields are also available for `{{...}}` templating
anywhere in the flow (e.g. `Hey {{telegram_first_name}}!`) without an `input` node collecting them
first, unlike every other field.

### `payment`
Sends a real Telegram invoice. Two ways to price it:

- **`currency: "XTR"`** — Telegram Stars, Telegram's own in-app currency. No provider setup at all;
  `amount` is just the number of Stars (no decimals). Best default for testing and for lightweight
  digital goods, since it works immediately. Note: Stars can only be cashed out via Fragment into
  TON crypto, not withdrawn directly as fiat — keep that in mind if this is meant to be real revenue.
- **Any other 3-letter ISO code** (`"USD"`, `"EUR"`, ...) — a real payment provider connected in
  BotFather (Bot Settings → Payments) is required, and its token must be set as
  `TELEGRAM_PROVIDER_TOKEN` when running the bot. `amount` is in the smallest currency unit (cents).

```yaml
pay_pro:
  type: payment
  title: "Pro plan"
  description: "1 month of access"
  currency: "XTR"             # or "USD" / "EUR" with a real provider token configured
  amount: 10                  # 10 Stars, or 1900 = $19.00 for a real provider
  payload: "pro_plan_1m"      # your own identifier for this purchase, not shown to the user
  next: payment_success       # where the flow resumes once payment succeeds
```
- Telegram does not notify the bot when a user cancels or abandons a payment, only on success — do
  not add an `on_fail` node expecting it to fire automatically; there is nothing in this engine that
  triggers it today.
- **On successful payment, the engine automatically records the purchase**: it sets a field named
  exactly like this node's `payload` to `"true"` (e.g. `payload: "pro_plan_1m"` → field `pro_plan_1m`
  becomes `"true"`). Use a `condition` node checking that same field name to tell whether a user
  already bought this specific thing — see the paywall pattern below. Don't invent a separate
  `collect` step to "remember" a purchase; it's already remembered under that field automatically.

### `condition`
Silently branches on a value already in the user's data (something an earlier `input` collected via
`save_as`, or a field a `payment` node set automatically — see above). No message shown. Continues
straight to `if_true` or `if_false`, never both.
```yaml
check_purchased:
  type: condition
  field: pro_plan_1m     # a save_as name, or a payment node's payload
  equals: "true"         # optional — omit to just check the field is non-empty/truthy
  if_true: private_content
  if_false: pay_pro
```
- Use this for a paywall: put the `condition` FIRST (e.g. as what the "unlock content" button leads
  to), checking the relevant payment's `payload` field. If true, go straight to the private node
  (skip payment entirely). If false, go to the `payment` node. This is exactly the pattern for "let
  the user pay once, then always skip straight to the paid content from then on":
  ```yaml
  open_private_area:
    type: condition
    field: pro_plan_1m
    if_true: private_content
    if_false: pay_pro

  pay_pro:
    type: payment
    ...
    payload: "pro_plan_1m"
    next: private_content   # first-time buyers land here right after paying too

  private_content:
    type: message
    text: "Welcome to the paid area!"
  ```
- `equals` only compares strings. There's no `>`, `<`, "contains", or multi-branch (more than
  true/false) support yet — for anything more complex, chain multiple `condition` nodes.

### `subscribe`
Adds whoever reaches this node to the bot's subscriber list, then continues straight to `next`. No
message of its own — pair it with a `message`/`menu` that explains what they're subscribing to.
```yaml
join_alerts:
  type: subscribe
  next: subscribed_confirmation
```
- The subscriber list is per-bot, flat (no topics/channels yet) — every subscriber gets every
  `event` node's broadcasts. If a flow needs separate audiences, that's out of scope today.
- There's no `unsubscribe` node type yet. Don't invent one.

### `event`
Not reached through normal flow navigation — it's the target of an external system's
`POST /event/<bot-id>/<this-node-id>` (see README "Exporting collected leads" section for the
sibling `/admin/leads` pattern; same auth style, a shared secret in an `X-Webhook-Secret` header).
Renders `message` against that request's JSON body and sends the result to every subscriber.
```yaml
otel_alert:
  type: event
  message: "🚨 {{service}}: {{message}} (severity: {{severity}})"
```
- `{{field}}` here refers to keys in the POSTed JSON body, not `state.data` — an `event` node has no
  user and no prior flow state, unlike every other `{{field}}` usage in this document.
- Don't give an `event` node a `next`, buttons, or make anything else `next` to it — nothing in the
  flow can reach it, and it doesn't continue anywhere itself. It's a broadcast trigger, not a step.

## Common patterns

### "Book a call / appointment"
No dedicated node type for this — it's just `input` (collect what you need) → `collect` (keep it
for yourself) and/or `webhook` (forward to a calendar/CRM that actually manages availability). This
engine has no live calendar integration or dynamic buttons, so it can't show real open time slots —
collect a *preferred* time as free text and let a human (or the external system on the other end of
the webhook) confirm it.
```yaml
book_call:
  type: menu
  text: "Want to book a call with us?"
  buttons:
    - label: "Yes, book a call"
      next: ask_booking_name

ask_booking_name:
  type: input
  text: "What's your name?"
  save_as: booking_name
  next: ask_booking_time

ask_booking_time:
  type: input
  text: "What day/time works for you? (we'll confirm by message)"
  save_as: booking_time
  next: save_booking

save_booking:
  type: collect
  fields: [booking_name, booking_time]
  next: notify_booking

notify_booking:
  type: webhook
  url: "https://example.com/api/bookings"     # your calendar/CRM's intake endpoint
  body: { name: "{{booking_name}}", time: "{{booking_time}}" }
  next: booking_confirmed

booking_confirmed:
  type: message
  text: "Thanks {{booking_name}}! We'll confirm {{booking_time}} shortly."
```

### Monitoring / alerts ("notify me when an external system has something to say")
This is what `subscribe` + `event` are for. Let users opt in, then have the external system (a CI
pipeline, an OpenTelemetry collector, a cron job, anything that can make an HTTP POST) push events
in as they happen.
```yaml
welcome:
  type: menu
  text: "Get notified about deploy failures?"
  buttons:
    - label: "Yes, subscribe me"
      next: join_alerts

join_alerts:
  type: subscribe
  next: subscribed_confirmation

subscribed_confirmation:
  type: message
  text: "You're in — you'll get a message here whenever something fires."

deploy_failed:
  type: event
  message: "🔴 Deploy failed: {{service}} on {{branch}} — {{error}}"
```
The external system then does `curl -X POST https://<your-app>/event/<bot-id>/deploy_failed -H
"X-Webhook-Secret: ..." -d '{"service":"api","branch":"main","error":"..."}'` whenever it wants to
alert everyone subscribed. No polling, no bot-side scheduler involved.

### Scheduled / recurring content (e.g. "send a tip every 6 hours")
**Not supported by this engine itself** — it has no internal scheduler or timer. But combined with
`subscribe`/`event` above, an *external* scheduler (cron, a serverless scheduled function, GitHub
Actions on a schedule, ...) hitting `/event/<bot-id>/<node-id>` on a timer covers this legitimately —
the flow doesn't need to know it's on a schedule, it's just another `event` POST. Don't generate a
flow that assumes BotFlow schedules anything on its own; if asked for recurring content, use this
pattern and say the actual timing lives outside the bot, in whatever's doing the POSTing.

## Worked example

```yaml
start_node: welcome
nodes:
  welcome:
    type: menu
    text: "Hi! Want the demo?"
    buttons:
      - label: "Start"
        next: ask_name

  ask_name:
    type: input
    text: "What's your name?"
    save_as: name
    next: save_lead

  save_lead:
    type: collect
    next: forward_to_crm

  forward_to_crm:
    type: webhook
    url: "https://example.com/leads"
    body: { name: "{{name}}" }
    next: pay_pro

  pay_pro:
    type: payment
    title: "Access"
    description: "One-time unlock"
    currency: "USD"
    amount: 500
    payload: "unlock"
    next: done

  done:
    type: message
    text: "All set, {{name}}!"
```

## Checklist before you upload the file

- [ ] `start_node` exists under `nodes`
- [ ] every `next` / `on_error` refers to a real node id
- [ ] every `menu` node has at least one button
- [ ] every `input`'s `save_as` is a distinct field name
- [ ] `{{field}}` references only fields that were actually collected earlier in the flow
- [ ] ran `deno run --allow-read --allow-env validate.ts flow.yaml` and it printed `✓`
