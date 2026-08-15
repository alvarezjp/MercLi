import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import LogoutButton from '@/components/LogoutButton'

// Ubicación en el proyecto: app/page.tsx (reemplaza la página default de Next.js)
// Server Component: corre en el servidor, así que puede leer la sesión y el
// perfil antes de renderizar nada — el usuario nunca ve un "flash" del
// dashboard antes de que lo redirijan.

export default async function HomePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: perfil, error } = await supabase
    .from('perfiles')
    .select('plan, trial_fin, activo')
    .eq('id', user.id)
    .single()

  if (error || !perfil) {
    console.error('Error al cargar perfil:', error)
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'sans-serif' }}>
        <h1>No pudimos cargar tu perfil</h1>
        <p>Intenta recargar la página. Si el problema persiste, contáctanos.</p>
      </div>
    )
  }

  const trialVencido = perfil.plan === 'trial' && new Date(perfil.trial_fin) < new Date()

  if (trialVencido || !perfil.activo) {
    return (
      <div
        style={{
          maxWidth: 480,
          margin: '80px auto',
          fontFamily: 'sans-serif',
          textAlign: 'center',
        }}
      >
        <h1>Tu período de prueba terminó</h1>
        <p>
          Tu prueba gratuita finalizó el{' '}
          {new Date(perfil.trial_fin).toLocaleDateString('es-CL', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
          . Contáctanos para seguir usando la plataforma.
        </p>
        <LogoutButton />
      </div>
    )
  }

  const diasRestantes = Math.ceil(
    (new Date(perfil.trial_fin).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  return (
    <div style={{ maxWidth: 600, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>Bienvenido</h1>
      {perfil.plan === 'trial' && (
        <p style={{ background: 'green', padding: 12, borderRadius: 8 }}>
          Estás en período de prueba. Te quedan <strong>{diasRestantes}</strong> día(s).
        </p>
      )}
      <p>Aquí vamos a construir el listado de licitaciones en las próximas etapas.</p>
      <LogoutButton />
    </div>
  )
}