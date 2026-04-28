import { createClient } from "@supabase/supabase-js";

import { env, hasSupabase } from "@/lib/config";

export const isSupabaseConfigured = hasSupabase;

export function createServiceClient() {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export const createSupabaseAdmin = createServiceClient;
