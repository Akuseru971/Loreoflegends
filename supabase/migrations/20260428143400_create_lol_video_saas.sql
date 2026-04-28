create extension if not exists "pgcrypto";

create type video_status as enum (
  'draft',
  'idea_generated',
  'script_generated',
  'voice_generated',
  'audio_processed',
  'images_selected',
  'rendering',
  'completed',
  'failed'
);

create type line_speaker as enum ('Lamb', 'Wolf');

create table videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  champion_or_theme text not null,
  duration_seconds integer not null check (duration_seconds between 15 and 180),
  style text not null,
  lamb_voice_id text not null,
  wolf_voice_id text not null,
  status video_status not null default 'draft',
  idea text,
  script text,
  final_audio_url text,
  final_video_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table video_lines (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  line_index integer not null,
  speaker line_speaker not null,
  text text not null,
  audio_url text,
  duration_ms integer,
  start_ms integer,
  end_ms integer,
  created_at timestamptz not null default now(),
  unique(video_id, line_index)
);

create table video_scenes (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  scene_index integer not null,
  summary text not null,
  search_queries text[] not null default '{}',
  line_indexes integer[] not null default '{}',
  start_ms integer,
  end_ms integer,
  selected_asset_id uuid,
  created_at timestamptz not null default now(),
  unique(video_id, scene_index)
);

create table selected_assets (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  scene_id uuid references video_scenes(id) on delete set null,
  source_url text not null,
  storage_path text,
  width integer,
  height integer,
  score numeric not null default 0,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table video_scenes
  add constraint video_scenes_selected_asset_fk
  foreign key (selected_asset_id) references selected_assets(id) on delete set null;

create table renders (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  status text not null default 'queued',
  output_url text,
  logs text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table settings (
  id uuid primary key default gen_random_uuid(),
  pause_min_ms integer not null default 150,
  pause_max_ms integer not null default 250,
  image_min_seconds numeric not null default 3,
  image_max_seconds numeric not null default 4,
  subtitle_style jsonb not null default '{"fontSize": 62, "fontColor": "white", "outlineColor": "black", "outlineWidth": 4, "safeMargin": 130}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into settings (pause_min_ms, pause_max_ms, image_min_seconds, image_max_seconds)
values (150, 250, 3, 4);

create index videos_status_idx on videos(status);
create index video_lines_video_id_idx on video_lines(video_id);
create index video_scenes_video_id_idx on video_scenes(video_id);
create index selected_assets_video_id_idx on selected_assets(video_id);
create index renders_video_id_idx on renders(video_id);

alter table videos enable row level security;
alter table video_lines enable row level security;
alter table video_scenes enable row level security;
alter table selected_assets enable row level security;
alter table renders enable row level security;
alter table settings enable row level security;

-- This SaaS scaffold expects trusted server-side access through SUPABASE_SERVICE_ROLE_KEY.
-- Add authenticated user ownership policies before exposing multi-tenant user accounts.
