-- BIZ-07: cross-level date coherence, enforced by the database.
--
--   trip      ⊇ destination   every non-null destination date lies within
--                             the trip's non-null bounds
--   destination ⊇ day         a day's date lies within the destination's
--                             non-null bounds
--   siblings don't overlap    two destinations of one trip that both have
--                             start AND end must not share more than a
--                             boundary day (a.start < b.end AND b.start < a.end
--                             is an overlap; touching end = start is allowed)
--   start <= end              also for a PATCH that sends only one date and
--                             is compared with the stored other one
--
-- Every comparison is null-safe: a missing date on either side never
-- constrains (partial dates stay valid). Shrinking a parent that would leave
-- a child outside is rejected (never cascaded / silently clamped).
--
-- Why triggers rather than route-level checks: production runs on the Neon
-- HTTP driver, which has no interactive transactions, so a route cannot hold
-- a lock between "check" and "write". Each trigger runs inside the writing
-- statement and takes a row lock on the parent first:
--   * day write          → FOR SHARE on its destination (conflicts with a
--                          concurrent UPDATE of that destination)
--   * destination write  → FOR NO KEY UPDATE on its trip (serializes sibling
--                          destination writes of one trip and trip updates)
--   * trip/destination UPDATE → the row itself is already locked by the
--                          UPDATE before BEFORE-row triggers run
-- After a lock wait, the next query in the function takes a fresh snapshot
-- (READ COMMITTED, VOLATILE plpgsql), so it sees the rows the other
-- transaction committed. Two parallel edits therefore cannot jointly
-- violate a rule.
--
-- Violations raise SQLSTATE 'DC001' with COLUMN = the offending field and a
-- human-readable message; the API maps it to 422 { code: 'date_conflict' }.
-- Triggers fire only when a date column (or the parent key) is written, so
-- legacy incoherent rows stay renamable/reorderable until their dates are
-- edited. Existing rows are not validated by this migration.

CREATE OR REPLACE FUNCTION biz07_range_text(s date, e date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN s IS NOT NULL AND e IS NOT NULL THEN s::text || ' to ' || e::text
    WHEN s IS NOT NULL THEN 'from ' || s::text
    WHEN e IS NOT NULL THEN 'until ' || e::text
    ELSE 'no dates'
  END
$$;--> statement-breakpoint

-- Which of start_date/end_date to report: the one this UPDATE changed when
-- exactly one changed, otherwise `fallback`.
CREATE OR REPLACE FUNCTION biz07_changed_column(
  is_update boolean, old_s date, new_s date, old_e date, new_e date, fallback text
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN is_update AND (old_s IS DISTINCT FROM new_s) AND NOT (old_e IS DISTINCT FROM new_e) THEN 'start_date'
    WHEN is_update AND (old_e IS DISTINCT FROM new_e) AND NOT (old_s IS DISTINCT FROM new_s) THEN 'end_date'
    ELSE fallback
  END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION biz07_trips_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  is_upd boolean := TG_OP = 'UPDATE';
  col text;
  d record;
BEGIN
  IF NEW.start_date > NEW.end_date THEN
    col := biz07_changed_column(is_upd, OLD.start_date, NEW.start_date, OLD.end_date, NEW.end_date, 'end_date');
    RAISE EXCEPTION 'The trip end date (%) must be on or after its start date (%).', NEW.end_date, NEW.start_date
      USING ERRCODE = 'DC001', COLUMN = col, TABLE = 'trips';
  END IF;

  IF is_upd THEN
    -- This row is locked by the UPDATE; destination writes of this trip
    -- lock it too, so none can slip in between this check and commit.
    SELECT x.city_name, x.start_date, x.end_date INTO d
      FROM destinations x
     WHERE x.trip_id = NEW.id
       AND (x.start_date < NEW.start_date OR x.end_date < NEW.start_date
         OR x.start_date > NEW.end_date OR x.end_date > NEW.end_date)
     ORDER BY coalesce(x.start_date, x.end_date), x.id
     LIMIT 1;
    IF FOUND THEN
      IF d.start_date < NEW.start_date OR d.end_date < NEW.start_date THEN
        col := biz07_changed_column(true, OLD.start_date, NEW.start_date, OLD.end_date, NEW.end_date, 'start_date');
      ELSE
        col := biz07_changed_column(true, OLD.start_date, NEW.start_date, OLD.end_date, NEW.end_date, 'end_date');
      END IF;
      RAISE EXCEPTION 'The trip dates (%) would leave destination "%" (%) outside the trip. Change or remove that destination first.',
        biz07_range_text(NEW.start_date, NEW.end_date), d.city_name, biz07_range_text(d.start_date, d.end_date)
        USING ERRCODE = 'DC001', COLUMN = col, TABLE = 'trips';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION biz07_destinations_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  is_upd boolean := TG_OP = 'UPDATE';
  col text;
  t record;
  o record;
  n_out integer;
  first_out date;
  last_out date;
BEGIN
  IF NEW.start_date > NEW.end_date THEN
    col := biz07_changed_column(is_upd, OLD.start_date, NEW.start_date, OLD.end_date, NEW.end_date, 'end_date');
    RAISE EXCEPTION 'The departure date (%) must be on or after the arrival date (%).', NEW.end_date, NEW.start_date
      USING ERRCODE = 'DC001', COLUMN = col, TABLE = 'destinations';
  END IF;

  -- Serialize with sibling destination writes and with trip updates.
  SELECT x.start_date, x.end_date INTO t FROM trips x WHERE x.id = NEW.trip_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports the missing trip
  END IF;

  -- Within the trip.
  IF NEW.start_date < t.start_date OR NEW.start_date > t.end_date
     OR NEW.end_date < t.start_date OR NEW.end_date > t.end_date THEN
    IF NEW.start_date < t.start_date OR NEW.start_date > t.end_date THEN
      col := biz07_changed_column(is_upd, OLD.start_date, NEW.start_date, OLD.end_date, NEW.end_date, 'start_date');
    ELSE
      col := biz07_changed_column(is_upd, OLD.start_date, NEW.start_date, OLD.end_date, NEW.end_date, 'end_date');
    END IF;
    RAISE EXCEPTION 'The destination dates (%) must be within the trip dates (%).',
      biz07_range_text(NEW.start_date, NEW.end_date), biz07_range_text(t.start_date, t.end_date)
      USING ERRCODE = 'DC001', COLUMN = col, TABLE = 'destinations';
  END IF;

  -- No overlap with a fully dated sibling (touching boundaries allowed).
  IF NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL THEN
    SELECT x.city_name, x.start_date, x.end_date INTO o
      FROM destinations x
     WHERE x.trip_id = NEW.trip_id
       AND x.id <> NEW.id
       AND x.start_date < NEW.end_date
       AND NEW.start_date < x.end_date
     ORDER BY x.start_date, x.id
     LIMIT 1;
    IF FOUND THEN
      col := biz07_changed_column(is_upd, OLD.start_date, NEW.start_date, OLD.end_date, NEW.end_date,
        CASE WHEN NEW.start_date < o.start_date THEN 'end_date' ELSE 'start_date' END);
      RAISE EXCEPTION 'The destination dates (%) overlap with "%" (%). Destinations may only share their first/last day.',
        biz07_range_text(NEW.start_date, NEW.end_date), o.city_name, biz07_range_text(o.start_date, o.end_date)
        USING ERRCODE = 'DC001', COLUMN = col, TABLE = 'destinations';
    END IF;
  END IF;

  -- Days must stay inside (only existing rows can have days). This row is
  -- locked by the UPDATE; day writes take FOR SHARE on it.
  IF is_upd THEN
    SELECT count(*), min(y.date), max(y.date) INTO n_out, first_out, last_out
      FROM days y
     WHERE y.destination_id = NEW.id
       AND (y.date < NEW.start_date OR y.date > NEW.end_date);
    IF n_out > 0 THEN
      IF first_out < NEW.start_date THEN
        col := biz07_changed_column(true, OLD.start_date, NEW.start_date, OLD.end_date, NEW.end_date, 'start_date');
      ELSE
        col := biz07_changed_column(true, OLD.start_date, NEW.start_date, OLD.end_date, NEW.end_date, 'end_date');
      END IF;
      RAISE EXCEPTION 'The destination dates (%) would leave % % outside the range (%). Move or delete those days first.',
        biz07_range_text(NEW.start_date, NEW.end_date), n_out,
        CASE WHEN n_out = 1 THEN 'day' ELSE 'days' END,
        CASE WHEN first_out = last_out THEN first_out::text ELSE first_out::text || ' … ' || last_out::text END
        USING ERRCODE = 'DC001', COLUMN = col, TABLE = 'destinations';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION biz07_days_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d record;
BEGIN
  -- FOR SHARE: waits for (and then sees) a concurrent destination UPDATE.
  SELECT x.start_date, x.end_date INTO d FROM destinations x WHERE x.id = NEW.destination_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports the missing destination
  END IF;
  IF NEW.date < d.start_date OR NEW.date > d.end_date THEN
    RAISE EXCEPTION 'The day date (%) must be within the destination dates (%).',
      NEW.date, biz07_range_text(d.start_date, d.end_date)
      USING ERRCODE = 'DC001', COLUMN = 'date', TABLE = 'days';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER trips_biz07_date_coherence
  BEFORE INSERT OR UPDATE OF start_date, end_date ON trips
  FOR EACH ROW EXECUTE FUNCTION biz07_trips_check();--> statement-breakpoint

CREATE TRIGGER destinations_biz07_date_coherence
  BEFORE INSERT OR UPDATE OF start_date, end_date, trip_id ON destinations
  FOR EACH ROW EXECUTE FUNCTION biz07_destinations_check();--> statement-breakpoint

CREATE TRIGGER days_biz07_date_coherence
  BEFORE INSERT OR UPDATE OF date, destination_id ON days
  FOR EACH ROW EXECUTE FUNCTION biz07_days_check();
