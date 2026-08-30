import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import LogoutButton from '@/components/LogoutButton'
import ListaLicitaciones from '@/components/ListaLicitaciones'

// Ubicación en el proyecto: app/page.tsx (reemplaza la versión de la Etapa 1)

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

  const { data: licitaciones, error: errorLicitaciones } = await supabase.rpc(
    'buscar_licitaciones_por_keywords',
    { p_user_id: user.id }
  )

  return (
    <div style={{ maxWidth: 800, margin: '60px auto', fontFamily: 'sans-serif', padding: '0 16px' }}>
      <h1>Bienvenido</h1>

      {perfil.plan === 'trial' && (
        <p style={{ background: 'green', padding: 12, borderRadius: 8 }}>
          Estás en período de prueba. Te quedan <strong>{diasRestantes}</strong> día(s).
        </p>
      )}

      <p style={{ marginBottom: 24 }}>
        <a href="/keywords">Gestionar mis palabras clave →</a>
      </p>

      <h2>Licitaciones que coinciden con tus palabras clave</h2>

      {errorLicitaciones && (
        <p style={{ color: 'red' }}>
          No se pudieron cargar las licitaciones: {errorLicitaciones.message}
        </p>
      )}

      {!errorLicitaciones && (
        <ListaLicitaciones licitaciones={licitaciones ?? []} userId={user.id} />
      )}

      <div style={{ marginTop: 32 }}>
        <LogoutButton />
      </div>
    </div>
  )
}