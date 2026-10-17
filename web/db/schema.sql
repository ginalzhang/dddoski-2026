-- Shorts Gatekeeper: Postgres schema with spec invariants as constraints.
-- NOTE: the running app uses the in-memory store in lib/server/store.ts (optional JSON persistence).
-- A Postgres adapter is NOT implemented; this file documents the target schema.

create table links (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('fun','edu')),
  video_id      text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  url           text not null,
  title         text not null check (length(trim(title)) > 0),
  topic         text not null default 'math',
  difficulty    smallint not null default 1 check (difficulty between 1 and 3),
  question      text not null check (length(trim(question)) > 0),
  options       jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  correct_index smallint not null,
  explanation   text not null check (length(trim(explanation)) > 0),
  active        boolean not null default true,
  embeddable    boolean,
  duration_s    integer check (duration_s is null or duration_s > 0),
  order_hint    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint links_correct_in_range check (correct_index >= 0 and correct_index < jsonb_array_length(options)),
  unique (kind, video_id)
);
-- Distinct non-empty options (CHECK cannot contain subqueries, so use a trigger).
create function links_options_valid() returns trigger language plpgsql as $$
begin
  if exists (select 1 from jsonb_array_elements(new.options) e where jsonb_typeof(e) <> 'string' or length(trim(e #>> '{}')) = 0) then
    raise exception 'options must be non-empty strings';
  end if;
  if (select count(distinct lower(trim(e #>> '{}'))) from jsonb_array_elements(new.options) e) <> jsonb_array_length(new.options) then
    raise exception 'options must be distinct';
  end if;
  return new;
end $$;
create trigger links_options_valid before insert or update on links for each row execute function links_options_valid();
create index links_selection on links (kind, active, topic);

create table sessions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid,
  created_at             timestamptz not null default now(),
  consecutive_fun_fails  integer not null default 0 check (consecutive_fun_fails >= 0),
  study_required         integer not null default 0 check (study_required >= 0),
  study_completed        integer not null default 0 check (study_completed >= 0),
  study_link_id          uuid references links(id),
  study_attempt          smallint not null default 1 check (study_attempt in (1,2)),
  credits                integer not null default 0 check (credits >= 0),   -- decrement with UPDATE ... WHERE credits > 0
  credits_earned_today   integer not null default 0 check (credits_earned_today >= 0),
  credits_day            date,
  credits_enabled        boolean not null default true,
  topics                 text[] not null default array['math'],
  resume_after_video_id  text,
  pending_quiz_id        uuid,
  constraint study_completed_le_required check (study_completed <= study_required)
);

create table quizzes (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  link_id       uuid references links(id),           -- nullable: generated fun quizzes
  video_id      text not null,
  kind          text not null check (kind in ('fun','edu')),
  question      text not null,                       -- snapshot
  options       jsonb not null check (jsonb_array_length(options) between 2 and 4), -- snapshot (shuffled)
  correct_index smallint not null,                   -- snapshot; never selected by client-facing queries
  explanation   text not null default '',
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  answered_at   timestamptz,
  answer_index  smallint,
  correct       boolean,
  attempt       smallint not null default 1 check (attempt in (1,2)),
  constraint quiz_correct_in_range check (correct_index >= 0 and correct_index < jsonb_array_length(options)),
  constraint quiz_answer_consistent check ((answered_at is null) = (correct is null))
);
-- At most one unanswered quiz per session.
create unique index quizzes_one_unanswered on quizzes (session_id) where answered_at is null;
-- Idempotent grading: UPDATE quizzes SET ... WHERE id = $1 AND answered_at IS NULL RETURNING *; on 0 rows, return stored result.
alter table sessions add constraint sessions_pending_quiz_fk foreign key (pending_quiz_id) references quizzes(id) deferrable initially deferred;

-- Client-facing view without correct_index.
create view public_quizzes as select id, session_id, kind, question, options, expires_at, attempt from quizzes where answered_at is null;

create table link_views (
  session_id       uuid not null references sessions(id) on delete cascade,
  link_id          uuid not null references links(id) on delete cascade,
  last_seen_at     timestamptz not null default now(),
  times_seen       integer not null default 1 check (times_seen >= 1),
  credit_earned_at timestamptz,
  primary key (session_id, link_id)
);

create table passes (
  session_id uuid not null references sessions(id) on delete cascade,
  video_id   text not null,
  expires_at timestamptz not null,
  primary key (session_id, video_id)
);

create table spend (
  day       date primary key,
  apify_usd numeric(10,4) not null default 0 check (apify_usd >= 0),
  llm_usd   numeric(10,4) not null default 0 check (llm_usd >= 0),
  quizzes   integer not null default 0 check (quizzes >= 0)
);

-- Fun feed only (generated mode).
create table feeds (
  id           uuid primary key default gen_random_uuid(),
  source_kind  text not null check (source_kind in ('channel','keyword','hashtag','manual')),
  source_value text not null,
  fetched_at   timestamptz not null default now(),
  items        jsonb not null default '[]'
);

create table videos (
  video_id          text primary key,
  title             text,
  channel           text,
  duration_s        integer,
  embeddable        boolean,
  transcript_text   text,
  transcript_lang   text,
  transcript_auto   boolean,
  transcript_status text not null default 'none',
  fetched_at        timestamptz not null default now()
);
