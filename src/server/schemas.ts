import { z } from "zod";
import { MODEL_CHOICES, PROVIDERS, STATUSES, TOGGLE_KEYS } from "../shared/types.ts";

const modelId = z.enum(MODEL_CHOICES.map((m) => m.id) as [string, ...string[]]);
// Codex model names vary by account, so any plain model name is accepted. It's passed as one CLI argument, never through a shell.
const anyModel = z.string().trim().regex(/^[A-Za-z0-9][\w.:-]{0,63}$/, "Use a model name like gpt-5.6-luna");
const provider = z.enum(PROVIDERS);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const toggleSchema = z
  .object(Object.fromEntries(TOGGLE_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof TOGGLE_KEYS)[number], z.ZodBoolean>)
  .partial()
  .strict();

const ticketFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(50_000),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  labels: z.array(z.string().trim().min(1).max(40)).max(20),
  dueDate: isoDate.nullable(),
  linkedPath: z.string().trim().min(1).max(500).nullable(),
  toggles: toggleSchema,
  provider: provider.nullable(),
  model: anyModel.nullable(),
};

export const createTicketSchema = z
  // In Progress is set by the runner when a run starts, never on create.
  .object({ ...ticketFields, status: z.enum(STATUSES).exclude(["in_progress"]) })
  .partial()
  .required({ title: true })
  .strict();

export const patchTicketSchema = z.object(ticketFields).partial().strict();

export const statusSchema = z.object({ status: z.enum(STATUSES) }).strict();

export const commentSchema = z.object({ body: z.string().trim().min(1).max(20_000) }).strict();

export const spendMaxSchema = z.object({ max: z.number().finite().min(0).max(1e9) }).strict();

export const modelSettingsSchema = z
  .object({ main: modelId, agents: z.record(z.string().min(1).max(100), modelId) })
  .strict();

export const providerSettingsSchema = z
  .object({ provider, codexModel: z.union([z.literal(""), anyModel]) })
  .strict();

// Agent (MCP) calls
export const agentStatusSchema = z.object({ status: z.enum(["review", "blocked"]) }).strict();
export const agentAttachmentSchema = z.object({ path: z.string().min(1).max(1000), name: z.string().min(1).max(200).optional() }).strict();
export const spendPlanSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            service: z.string().trim().min(1).max(80),
            unit: z.string().trim().min(1).max(30),
            reason: z.string().trim().max(300),
            estimate: z.number().finite().min(0).max(1e9),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const reportSpendSchema = z
  .object({ service: z.string().trim().min(1).max(80), amount: z.number().finite().positive().max(1e9) })
  .strict();

export const idParam = z.coerce.number().int().positive();
