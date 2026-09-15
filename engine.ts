import * as jsYaml from "npm:js-yaml@5.4.2";
import { type Button, type FlowDefinition, FlowDefinitionSchema, type Media } from "./schema.ts";
import { saveLead } from "./store.ts";

export type { Button, Media };

export type FlowResult =
  | { kind: "message"; nodeId: string; text: string; media?: Media; buttons?: Button[] }
  | {
    kind: "invoice";
    nodeId: string;
    title: string;
    description: string;
    currency: string;
    amount: number;
    payload: string;
  };

interface UserState {
  nodeId: string;
  data: Record<string, string>;
}

function render(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");
}

export class FlowEngine {
  private flow!: FlowDefinition;
  private state = new Map<number, UserState>();

  constructor(private dataDir: string = "./data") {}

  loadFlow(yaml: string): void {
    this.flow = FlowDefinitionSchema.parse(jsYaml.load(yaml));
  }

  reset(userId: number): UserState {
    const state: UserState = { nodeId: this.flow.start_node, data: {} };
    this.state.set(userId, state);
    return state;
  }

  private getState(userId: number): UserState {
    return this.state.get(userId) ?? this.reset(userId);
  }

  async execute(userId: number, nodeId: string): Promise<FlowResult> {
    const node = this.flow.nodes[nodeId];
    if (!node) {
      const state = this.reset(userId);
      return {
        kind: "message",
        nodeId: state.nodeId,
        text: "⚠️ Unknown step. Returning to start.",
      };
    }
    const state = this.getState(userId);
    state.nodeId = nodeId;

    switch (node.type) {
      case "message":
      case "menu":
        return {
          kind: "message",
          nodeId,
          text: render(node.text, state.data),
          media: node.media,
          buttons: node.buttons,
        };

      case "input":
        return { kind: "message", nodeId, text: render(node.text, state.data) };

      case "collect": {
        const fields = node.fields
          ? Object.fromEntries(node.fields.map((f) => [f, state.data[f] ?? ""]))
          : { ...state.data };
        await saveLead(this.dataDir, fields);
        return this.execute(userId, node.next);
      }

      case "webhook": {
        const url = render(node.url, state.data);
        const body = node.body
          ? Object.fromEntries(
            Object.entries(node.body).map(([k, v]) => [k, render(v, state.data)]),
          )
          : undefined;
        const headers = node.headers
          ? Object.fromEntries(
            Object.entries(node.headers).map(([k, v]) => [k, render(v, state.data)]),
          )
          : undefined;
        try {
          const res = await fetch(url, {
            method: node.method,
            headers: { "content-type": "application/json", ...headers },
            body: body ? JSON.stringify(body) : undefined,
          });
          if (node.save_response_as) {
            state.data[node.save_response_as] = await res.text();
          }
          if (!res.ok && node.on_error) {
            return this.execute(userId, node.on_error);
          }
        } catch (e) {
          console.error(`webhook node "${nodeId}" failed:`, e);
          if (node.on_error) return this.execute(userId, node.on_error);
        }
        return this.execute(userId, node.next);
      }

      case "condition": {
        const value = state.data[node.field];
        const matched = node.equals !== undefined ? value === node.equals : Boolean(value);
        return this.execute(userId, matched ? node.if_true : node.if_false);
      }

      case "payment":
        return {
          kind: "invoice",
          nodeId,
          title: node.title,
          description: node.description,
          currency: node.currency,
          amount: node.amount,
          payload: node.payload,
        };
    }
  }

  handleStart(userId: number): Promise<FlowResult> {
    this.reset(userId);
    return this.execute(userId, this.flow.start_node);
  }

  handleCallback(userId: number, nextNodeId: string): Promise<FlowResult> {
    return this.execute(userId, nextNodeId);
  }

  /** Returns null when the user isn't currently on an `input` node (text wasn't expected). */
  handleText(userId: number, text: string): Promise<FlowResult> | null {
    const state = this.getState(userId);
    const node = this.flow.nodes[state.nodeId];
    if (!node || node.type !== "input") return null;
    state.data[node.save_as] = text;
    return this.execute(userId, node.next);
  }

  /** Telegram never notifies the bot when a user cancels an invoice, so only the success path
   *  resumes the flow. Also records the purchase into state.data under the payment's own
   *  `payload` as the key (set to "true") — a later `condition` node can check that same field to
   *  tell whether this user already bought this specific thing, e.g. to skip straight past a
   *  paywall instead of asking them to pay again. */
  handlePaymentSuccess(userId: number): Promise<FlowResult> {
    const state = this.getState(userId);
    const node = this.flow.nodes[state.nodeId];
    if (!node || node.type !== "payment") {
      return this.handleStart(userId);
    }
    state.data[node.payload] = "true";
    return this.execute(userId, node.next);
  }
}
