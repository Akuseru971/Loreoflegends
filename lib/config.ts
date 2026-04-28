import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const envSchema = z.object({
  NEXT_PUBLIC_APP_URL: optionalUrl.default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl.default(""),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  SUPABASE_STORAGE_BUCKET: z.string().optional().default("lol-short-assets"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().optional().default("gpt-4.1-mini"),
  ELEVENLABS_API_KEY: z.string().optional().default(""),
  IMAGE_SEARCH_API_KEY: z.string().optional().default(""),
  IMAGE_SEARCH_ENDPOINT: optionalUrl.default(""),
  WORKER_SHARED_SECRET: z.string().optional().default("dev-worker-secret"),
  FFMPEG_PATH: z.string().optional().default("ffmpeg"),
  FFPROBE_PATH: z.string().optional().default("ffprobe"),
  RENDER_TMP_DIR: z.string().optional().default("/tmp/loreoflegends"),
});

export const env = envSchema.parse(process.env);

export const config = {
  appUrl: env.NEXT_PUBLIC_APP_URL,
  supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  storageBucket: env.SUPABASE_STORAGE_BUCKET,
  openaiApiKey: env.OPENAI_API_KEY,
  openaiModel: env.OPENAI_MODEL,
  elevenLabsApiKey: env.ELEVENLABS_API_KEY,
  imageSearchApiKey: env.IMAGE_SEARCH_API_KEY,
  imageSearchEndpoint: env.IMAGE_SEARCH_ENDPOINT,
  workerSharedSecret: env.WORKER_SHARED_SECRET,
  ffmpegPath: env.FFMPEG_PATH,
  ffprobePath: env.FFPROBE_PATH,
  renderTmpDir: env.RENDER_TMP_DIR,
};

export const appConfig = config;
export const getConfig = () => config;

export const hasSupabase = Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
export const hasOpenAI = Boolean(config.openaiApiKey);
export const hasElevenLabs = Boolean(config.elevenLabsApiKey);
export const hasImageSearch = Boolean(config.imageSearchApiKey && config.imageSearchEndpoint);
