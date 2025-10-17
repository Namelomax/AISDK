import { StringRecordId } from "surrealdb";
import { getDB } from "./connection";

export interface BaseRecord {
  id: string;
  [key: string]: unknown;
}

export interface TimeFields {
  created: string;
  updated: string;
}

/**
 * Converts SurrealDB RecordId to string for frontend compatibility
 */
export function recordIdToString<T extends { id: { toString(): string } }>(
  record: T,
): T & { id: string } {
  return {
    ...record,
    id: record.id.toString(),
  };
}

/**
 * Converts array of records with RecordId to string ids
 */
export function recordsToString<T extends { id: { toString(): string } }>(
  records: T[],
): (T & { id: string })[] {
  return records.map(recordIdToString);
}

/**
 * Base repository class with common CRUD operations
 */
export class BaseRepository<T extends BaseRecord> {
  protected tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  /**
   * Get all records from table
   */
  async findAll(): Promise<(T & { id: string })[]> {
    try {
      const db = await getDB();
      const records = await db.select(this.tableName);

      if (!records || !Array.isArray(records)) {
        return [];
      }

      return recordsToString(records as (T & { id: { toString(): string } })[]);
    } catch (error) {
      console.error(`Failed to fetch all ${this.tableName}:`, error);
      return [];
    }
  }

  /**
   * Find record by ID
   */
  async findById(id: string): Promise<(T & { id: string }) | null> {
    try {
      const db = await getDB();
      const record = await db.select(new StringRecordId(id));

      if (!record) {
        return null;
      }

      return recordIdToString(record as T & { id: { toString(): string } });
    } catch (error) {
      console.error(`Failed to fetch ${this.tableName} by id ${id}:`, error);
      return null;
    }
  }

  /**
   * Create new record
   */
  async create(data: Omit<T, "id" | "time">): Promise<T & { id: string }> {
    const db = await getDB();
    const result = await db.create(this.tableName, data);

    // db.create returns array, take first element
    const record = Array.isArray(result) ? result[0] : result;

    return recordIdToString(record as T & { id: { toString(): string } });
  }

  /**
   * Update record by ID
   */
  async update(
    id: string,
    updates: Partial<Omit<T, "id" | "time">>,
  ): Promise<T & { id: string }> {
    const db = await getDB();
    const result = await db.merge(new StringRecordId(id), updates);

    return recordIdToString(result as T & { id: { toString(): string } });
  }

  /**
   * Delete record by ID
   */
  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete(new StringRecordId(id));
  }

  /**
   * Check if record exists
   */
  async exists(id: string): Promise<boolean> {
    try {
      const record = await this.findById(id);
      return record !== null;
    } catch (error) {
      console.error(`Failed to check if ${this.tableName} exists:`, error);
      return false;
    }
  }

  /**
   * Count all records in table
   */
  async count(): Promise<number> {
    try {
      const records = await this.findAll();
      return records.length;
    } catch (error) {
      console.error(`Failed to count ${this.tableName}:`, error);
      return 0;
    }
  }
}