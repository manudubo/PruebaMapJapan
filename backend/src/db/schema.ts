import {
  pgTable,
  serial,
  text,
  varchar,
  boolean,
  integer,
  numeric,
  jsonb,
  timestamp,
  date,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    keycloak_id: varchar('keycloak_id', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    avatar_url: text('avatar_url'),
    preferences: jsonb('preferences').$type<Record<string, unknown>>().default({}),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keycloakIdIdx: uniqueIndex('users_keycloak_id_idx').on(table.keycloak_id),
  }),
);

export const usersRelations = relations(users, ({ many }) => ({
  trips: many(trips),
}));

// ---------------------------------------------------------------------------
// trips
// ---------------------------------------------------------------------------
export const trips = pgTable('trips', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  start_date: date('start_date'),
  end_date: date('end_date'),
  cover_image_url: text('cover_image_url'),
  is_public: boolean('is_public').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tripsRelations = relations(trips, ({ one, many }) => ({
  user: one(users, {
    fields: [trips.user_id],
    references: [users.id],
  }),
  destinations: many(destinations),
}));

// ---------------------------------------------------------------------------
// destinations
// ---------------------------------------------------------------------------
export const destinations = pgTable('destinations', {
  id: serial('id').primaryKey(),
  trip_id: integer('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  city_name: varchar('city_name', { length: 255 }).notNull(),
  country: varchar('country', { length: 100 }).notNull(),
  start_date: date('start_date'),
  end_date: date('end_date'),
  lat: numeric('lat', { precision: 10, scale: 7 }),
  lng: numeric('lng', { precision: 10, scale: 7 }),
  zoom_level: integer('zoom_level').default(12),
  order_index: integer('order_index').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const destinationsRelations = relations(destinations, ({ one, many }) => ({
  trip: one(trips, {
    fields: [destinations.trip_id],
    references: [trips.id],
  }),
  hotel: one(hotels, {
    fields: [destinations.id],
    references: [hotels.destination_id],
  }),
  days: many(days),
}));

// ---------------------------------------------------------------------------
// hotels
// ---------------------------------------------------------------------------
export const hotels = pgTable('hotels', {
  id: serial('id').primaryKey(),
  destination_id: integer('destination_id')
    .notNull()
    .references(() => destinations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  lat: numeric('lat', { precision: 10, scale: 7 }),
  lng: numeric('lng', { precision: 10, scale: 7 }),
  check_in_date: date('check_in_date'),
  check_out_date: date('check_out_date'),
});

export const hotelsRelations = relations(hotels, ({ one }) => ({
  destination: one(destinations, {
    fields: [hotels.destination_id],
    references: [destinations.id],
  }),
}));

// ---------------------------------------------------------------------------
// days
// ---------------------------------------------------------------------------
export const days = pgTable('days', {
  id: serial('id').primaryKey(),
  destination_id: integer('destination_id')
    .notNull()
    .references(() => destinations.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  label: varchar('label', { length: 255 }),
  color_hex: varchar('color_hex', { length: 7 }),
  order_index: integer('order_index').notNull().default(0),
});

export const daysRelations = relations(days, ({ one, many }) => ({
  destination: one(destinations, {
    fields: [days.destination_id],
    references: [destinations.id],
  }),
  activities: many(activities),
}));

// ---------------------------------------------------------------------------
// activities
// ---------------------------------------------------------------------------
export const activities = pgTable('activities', {
  id: serial('id').primaryKey(),
  day_id: integer('day_id')
    .notNull()
    .references(() => days.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  lat: numeric('lat', { precision: 10, scale: 7 }),
  lng: numeric('lng', { precision: 10, scale: 7 }),
  notes: text('notes'),
  is_optional: boolean('is_optional').notNull().default(false),
  is_generic: boolean('is_generic').notNull().default(false),
  maps_url: text('maps_url'),
  order_index: integer('order_index').notNull().default(0),
});

export const activitiesRelations = relations(activities, ({ one }) => ({
  day: one(days, {
    fields: [activities.day_id],
    references: [days.id],
  }),
}));
