import { z } from 'zod';

export const tokenEventSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['mock', 'manual-import', 'openai']),
  model: z.string().min(1),
  kind: z.enum(['input', 'output', 'cached', 'reasoning']),
  tokenCount: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});

export type TokenEvent = z.infer<typeof tokenEventSchema>;
