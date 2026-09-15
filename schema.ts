import { z } from "npm:zod@4.3.6";

const nodeIdRef = z.string().min(1);

const ButtonSchema = z.object({
  label: z.string().min(1),
  next: nodeIdRef,
});

const MediaSchema = z.object({
  kind: z.enum(["photo", "video", "audio", "document", "voice"]),
  url: z.string().min(1),
});

const MessageNodeSchema = z.object({
  type: z.literal("message"),
  text: z.string().min(1),
  media: MediaSchema.optional(),
  buttons: z.array(ButtonSchema).optional(),
});

const MenuNodeSchema = z.object({
  type: z.literal("menu"),
  text: z.string().min(1),
  media: MediaSchema.optional(),
  buttons: z.array(ButtonSchema).min(1),
});

const InputNodeSchema = z.object({
  type: z.literal("input"),
  text: z.string().min(1),
  save_as: z.string().min(1),
  next: nodeIdRef,
});

const WebhookNodeSchema = z.object({
  type: z.literal("webhook"),
  url: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH"]).default("POST"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.string()).optional(),
  save_response_as: z.string().optional(),
  next: nodeIdRef,
  on_error: nodeIdRef.optional(),
});

const CollectNodeSchema = z.object({
  type: z.literal("collect"),
  fields: z.array(z.string().min(1)).optional(),
  next: nodeIdRef,
});

const PaymentNodeSchema = z.object({
  type: z.literal("payment"),
  title: z.string().min(1),
  description: z.string().min(1),
  currency: z.string().length(3),
  amount: z.number().int().positive(),
  payload: z.string().min(1),
  next: nodeIdRef,
  on_fail: nodeIdRef.optional(),
});

const ConditionNodeSchema = z.object({
  type: z.literal("condition"),
  field: z.string().min(1),
  equals: z.string().optional(),
  if_true: nodeIdRef,
  if_false: nodeIdRef,
});

const SubscribeNodeSchema = z.object({
  type: z.literal("subscribe"),
  next: nodeIdRef,
});

// Not reached via `next` like other nodes — it's the target of an external system's HTTP POST
// (see server.ts/server-prod.ts's `/event/<bot-id>/<node-id>` route), rendered against that
// request's JSON body and broadcast to everyone who reached a `subscribe` node.
const EventNodeSchema = z.object({
  type: z.literal("event"),
  message: z.string().min(1),
});

export const FlowNodeSchema = z.discriminatedUnion("type", [
  MessageNodeSchema,
  MenuNodeSchema,
  InputNodeSchema,
  WebhookNodeSchema,
  CollectNodeSchema,
  PaymentNodeSchema,
  ConditionNodeSchema,
  SubscribeNodeSchema,
  EventNodeSchema,
]);

export const FlowDefinitionSchema = z.object({
  start_node: nodeIdRef,
  nodes: z.record(z.string(), FlowNodeSchema),
});

export type Button = z.infer<typeof ButtonSchema>;
export type Media = z.infer<typeof MediaSchema>;
export type FlowNode = z.infer<typeof FlowNodeSchema>;
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;
