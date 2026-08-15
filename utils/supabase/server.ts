import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Ubicación en el proyecto: utils/supabase/server.ts
// Se usa en Server Components, Route Handlers (app/api/...) y Server Actions.

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Se puede ignorar si el middleware ya está refrescando la sesión
            // en cada request (ver middleware.ts).
          }
        },
      },
    }
  )
}