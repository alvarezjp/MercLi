import { createBrowserClient } from '@supabase/ssr'

// Ubicación en el proyecto: utils/supabase/client.ts
// Se usa dentro de Client Components ('use client'), por ejemplo login/registro.

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}