-- Schema of a database built with `drizzle-kit push --force` (SETUP.md /
-- DEVELOPMENT.md) from backend/src/db/schema.ts as of 1d1eeb9~1, i.e. the
-- 0003-era schema WITHOUT the Drizzle migration journal. Captured with
-- pg_dump 16 --schema-only. Used by tests/system/upgrade-path.test.ts to
-- reproduce a push-built production database.
CREATE TABLE public.activities (
    id integer NOT NULL,
    day_id integer NOT NULL,
    name character varying(255) NOT NULL,
    lat numeric(10,7),
    lng numeric(10,7),
    notes text,
    is_optional boolean DEFAULT false NOT NULL,
    is_generic boolean DEFAULT false NOT NULL,
    maps_url text,
    order_index integer DEFAULT 0 NOT NULL,
    "time" text
);

CREATE SEQUENCE public.activities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.activities_id_seq OWNED BY public.activities.id;

CREATE TABLE public.days (
    id integer NOT NULL,
    destination_id integer NOT NULL,
    date date NOT NULL,
    label character varying(255),
    color_hex character varying(7),
    order_index integer DEFAULT 0 NOT NULL
);

CREATE SEQUENCE public.days_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.days_id_seq OWNED BY public.days.id;

CREATE TABLE public.destinations (
    id integer NOT NULL,
    trip_id integer NOT NULL,
    city_name character varying(255) NOT NULL,
    country character varying(100) NOT NULL,
    start_date date,
    end_date date,
    lat numeric(10,7),
    lng numeric(10,7),
    zoom_level integer DEFAULT 12,
    order_index integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.destinations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.destinations_id_seq OWNED BY public.destinations.id;

CREATE TABLE public.email_otp_codes (
    id integer NOT NULL,
    user_id integer NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.email_otp_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.email_otp_codes_id_seq OWNED BY public.email_otp_codes.id;

CREATE TABLE public.hotels (
    id integer NOT NULL,
    destination_id integer NOT NULL,
    name character varying(255) NOT NULL,
    lat numeric(10,7),
    lng numeric(10,7),
    check_in_date date,
    check_out_date date,
    url text
);

CREATE SEQUENCE public.hotels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.hotels_id_seq OWNED BY public.hotels.id;

CREATE TABLE public.trips (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    start_date date,
    end_date date,
    cover_image_url text,
    is_public boolean DEFAULT false NOT NULL,
    public_slug uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.trips_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.trips_id_seq OWNED BY public.trips.id;

CREATE TABLE public.users (
    id integer NOT NULL,
    keycloak_id character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    avatar_url text,
    preferences jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

ALTER TABLE ONLY public.activities ALTER COLUMN id SET DEFAULT nextval('public.activities_id_seq'::regclass);

ALTER TABLE ONLY public.days ALTER COLUMN id SET DEFAULT nextval('public.days_id_seq'::regclass);

ALTER TABLE ONLY public.destinations ALTER COLUMN id SET DEFAULT nextval('public.destinations_id_seq'::regclass);

ALTER TABLE ONLY public.email_otp_codes ALTER COLUMN id SET DEFAULT nextval('public.email_otp_codes_id_seq'::regclass);

ALTER TABLE ONLY public.hotels ALTER COLUMN id SET DEFAULT nextval('public.hotels_id_seq'::regclass);

ALTER TABLE ONLY public.trips ALTER COLUMN id SET DEFAULT nextval('public.trips_id_seq'::regclass);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.days
    ADD CONSTRAINT days_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.destinations
    ADD CONSTRAINT destinations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_otp_codes
    ADD CONSTRAINT email_otp_codes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hotels
    ADD CONSTRAINT hotels_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX trips_public_slug_idx ON public.trips USING btree (public_slug);

CREATE UNIQUE INDEX users_keycloak_id_idx ON public.users USING btree (keycloak_id);

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_day_id_days_id_fk FOREIGN KEY (day_id) REFERENCES public.days(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.days
    ADD CONSTRAINT days_destination_id_destinations_id_fk FOREIGN KEY (destination_id) REFERENCES public.destinations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.destinations
    ADD CONSTRAINT destinations_trip_id_trips_id_fk FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_otp_codes
    ADD CONSTRAINT email_otp_codes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.hotels
    ADD CONSTRAINT hotels_destination_id_destinations_id_fk FOREIGN KEY (destination_id) REFERENCES public.destinations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
