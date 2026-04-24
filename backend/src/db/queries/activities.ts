import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { activities } from '../schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Activity = typeof activities.$inferSelect;

export type CreateActivityData = {
  name: string;
  lat?: string | null;
  lng?: string | null;
  notes?: string | null;
  is_optional?: boolean;
  is_generic?: boolean;
  maps_url?: string | null;
  order_index?: number;
};

export type UpdateActivityData = Partial<CreateActivityData>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Return all activities for a given day, ordered by order_index.
 */
export async function getActivitiesByDay(
  db: Db,
  dayId: number,
): Promise<Activity[]> {
  return db
    .select()
    .from(activities)
    .where(eq(activities.day_id, dayId))
    .orderBy(activities.order_index);
}

/**
 * Create a new activity inside a day.
 */
export async function createActivity(
  db: Db,
  dayId: number,
  data: CreateActivityData,
): Promise<Activity> {
  const [created] = await db
    .insert(activities)
    .values({
      day_id: dayId,
      name: data.name,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      notes: data.notes ?? null,
      is_optional: data.is_optional ?? false,
      is_generic: data.is_generic ?? false,
      maps_url: data.maps_url ?? null,
      order_index: data.order_index ?? 0,
    })
    .returning();

  if (!created) throw new Error('createActivity: insert returned no rows');
  return created;
}

/**
 * Update mutable fields on an activity.
 */
export async function updateActivity(
  db: Db,
  actId: number,
  data: UpdateActivityData,
): Promise<Activity> {
  const [updated] = await db
    .update(activities)
    .set(data)
    .where(eq(activities.id, actId))
    .returning();

  if (!updated) throw new Error(`updateActivity: no activity found for id=${actId}`);
  return updated;
}

/**
 * Delete an activity by id.
 */
export async function deleteActivity(db: Db, actId: number): Promise<void> {
  await db.delete(activities).where(eq(activities.id, actId));
}

/**
 * Reorder activities within a day.
 *
 * `orderedIds` must contain every activity id that belongs to `dayId`.
 * Each id receives an order_index equal to its position in the array.
 */
export async function reorderActivities(
  db: Db,
  dayId: number,
  orderedIds: number[],
): Promise<Activity[]> {
  if (orderedIds.length === 0) return [];

  // Build a SQL CASE expression so we can update all rows in a single query.
  // CASE WHEN id = $1 THEN 0 WHEN id = $2 THEN 1 … ELSE order_index END
  const caseWhen = sql.join(
    orderedIds.map((id, index) => sql`WHEN ${activities.id} = ${id} THEN ${index}`),
    sql` `,
  );

  const updated = await db
    .update(activities)
    .set({
      order_index: sql`CASE ${caseWhen} ELSE ${activities.order_index} END`,
    })
    .where(
      and(
        eq(activities.day_id, dayId),
        inArray(activities.id, orderedIds),
      ),
    )
    .returning();

  // Return in the requested order.
  const byId = new Map(updated.map((a) => [a.id, a]));
  return orderedIds.map((id) => byId.get(id)).filter((a): a is Activity => a !== undefined);
}
