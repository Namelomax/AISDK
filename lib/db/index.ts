// index.ts:
// Connection
export { getDB, getDB as default } from "./connection";
export type { BaseRecord, TimeFields } from "./base";
// Base repository utilities
export {
  BaseRepository,
  recordIdToString,
  recordsToString,
} from "./base";
// Repositories
export {
  type Prompt,
  PromptsRepository,
  promptsRepository,
} from "./promts";
// Schema initialization
export {
  initializeDatabase,
  initializeSchema,
  seedDefaultData,
} from "./schema";
