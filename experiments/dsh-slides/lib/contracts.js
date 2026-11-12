// Generated from src/lib/slides/contracts.ts; run build-shared.mjs after changing it.
import { z } from 'zod';
/** Small, text-only Marp deck for the first local pilot. */
export const createSlideDeckInput = z.object({
    title: z.string().trim().min(1).max(100),
    markdown: z.string().trim().min(1).max(12000),
}).strict();
