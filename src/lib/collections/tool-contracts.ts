import { z } from 'zod';

const id = z.string().min(1).max(100);
const version = z.number().int().positive();
const values = z.record(z.string(), z.union([z.string().max(20000), z.number().finite(), z.boolean(), z.null()]));

/** Platform-independent tool contracts. Execution, auth and transactions stay in adapters. */
export const collectionRecordContracts = {
  describeCollection: {
    description: 'Read an enabled collection definition, stable field IDs, types and reference targets before querying or writing.',
    inputSchema: z.object({ collectionId: id }).strict(),
  },
  readCollectionRecord: {
    description: 'Read a full record within its enabled collection. Returns record version and schemaVersion; check the original values before updating.',
    inputSchema: z.object({ collectionId: id, recordId: id }).strict(),
  },
  createCollectionRecord: {
    description: 'Create one custom record only when requested. Values use defined field IDs and actual types; date is YYYY-MM-DD. Read definition first and supply schemaVersion.',
    inputSchema: z.object({ collectionId: id, schemaVersion: version, values }).strict(),
  },
  updateCollectionRecord: {
    description: 'Patch only explicitly requested fields of an existing active record; other fields are retained. null clears an optional field. Requires freshly read record version and schemaVersion.',
    inputSchema: z.object({ collectionId: id, recordId: id, expectedVersion: version, schemaVersion: version, values }).strict(),
  },
};
