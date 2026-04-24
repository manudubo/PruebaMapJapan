import { eq } from 'drizzle-orm';
import type { Db } from '../index';
import { days } from '../schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Day = typeof days.$inferSelect;

export type CreateDayData = {
  date: string;
  label?: string | null;
  color_hex?: string | null;
  order_index?: number;
};

export type UpdateDayData = Partial<CreateDayData>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Return all days for a given destination, ordered by order_index.
 */
export async function getDaysByDestination(
  db: Db,
  destinationId: number,
): Promise<Day[]> {
  return db
    .select()
    .from(days)
    .where(eq(days.destination_id, destinationId))
    .orderBy(days.order_index);
}

/**
 * Return a single day by id, or undefined if not found.
 */
export async function getDayById(
  db: Db,
  dayId: number,
): Promise<Day | undefined> {
  const results = await db
    .select()
    .from(days)
    .where(eq(days.id, dayId))
    .limit(1);
  return results[0];
}

/**
 * Create a new day inside a destination.
 */
export async function createDay(
  db: Db,
  destinationId: number,
  data: CreateDayData,
): Promise<Day> {
  const [created] = await db
    .insert(days)
    .values({
      destination_id: destinationId,
      date: data.date,
      label: data.label ?? null,
      color_hex: data.color_hex ?? null,
      order_index: data.order_index ?? 0,
    })
    .returning();

  if (!created) throw new Error('createDay: insert returned no rows');
  return created;
}

/**
 * Update mutable fields on a day.
 */
export async function updateDay(
  db: Db,
  dayId: number,
  data: UpdateDayData,
): Promise<Day> {
  const [updated] = await db
    .update(days)
    .set(data)
    .where(eq(days.id, dayId))
    .returning();

  if (!updated) throw new Error(`updateDay: no day found for id=${dayId}`);
  return updated;
}

/**
 * Delete a day (cascades to activities).
 */
export async function deleteDay(db: Db, dayId: number): Promise<void> {
  await db.delete(days).where(eq(days.id, dayId));
}
