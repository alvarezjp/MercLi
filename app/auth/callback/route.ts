import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Ubicación en el proyecto: app/auth/callback/route.ts
// Supabase redirige aquí cuando el usuario hace clic en el enlace de confirmación
// que le llega por correo (emailRedirectTo en la página de registro).

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirmacion_fallida`)
}