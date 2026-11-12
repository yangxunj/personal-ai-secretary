import { z } from 'zod';

/** Small, text-only Marp deck for the first local pilot. */
export const createSlideDeckInput = z.object({
  title: z.string().trim().min(1).max(100),
  markdown: z.string().trim().min(1).max(12000),
}).strict();
export type CreateSlideDeckInput = z.infer<typeof createSlideDeckInput>;
