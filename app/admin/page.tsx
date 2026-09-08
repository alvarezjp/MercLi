import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

// Ubicación en el proyecto: app/admin/page.tsx
// Server Component: verifica sesión + rol admin en el servidor, antes de
// renderizar cualquier dato. No hay acciones ni edición, solo lectura.

export const dynamic = 'force-dynamic' // nunca cachear: siempre datos frescos

type StatsLicitaciones = {
  total: number
  completas: number
  hoy: number
  hoy_completas: number
}

type StatsUsuario = {
  user_id: string
  email: string
  trial_inicio: string | null
  trial_fin: string | null
  dias_restantes: number | null
  correo_enviado_hoy: boolean
}

export default async function AdminPage() {
  const supabase = await createClient()

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    redirect('/login') // ⚠️ ajusta si tu ruta de login se llama distinto
  }

  const { data: esAdmin, error: errorAdmin } = await supabase.rpc('es_admin_actual')
  if (errorAdmin || !esAdmin) {
    redirect('/')
  }

  const [{ data: lic, error: errorLic }, { data: statsUsuarios, error: errorUsuarios }] =
    await Promise.all([
      supabase.rpc('admin_stats_licitaciones').single<StatsLicitaciones>(),
      supabase.rpc('admin_stats_usuarios'),
    ])

  if (errorLic) throw new Error('Error al cargar estadísticas de licitaciones: ' + errorLic.message)
  if (errorUsuarios) throw new Error('Error al cargar estadísticas de usuarios: ' + errorUsuarios.message)

  const stats = lic ?? { total: 0, completas: 0, hoy: 0, hoy_completas: 0 }
  const usuarios = (statsUsuarios ?? []) as StatsUsuario[]

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1>Panel de administrador</h1>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
          marginTop: 24,
        }}
      >
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Licitaciones totales</h2>
          <p>Total: <strong>{stats.total}</strong></p>
          <p>
            Completas: <strong>{stats.completas}</strong>{' '}
            ({stats.total > 0 ? Math.round((stats.completas / stats.total) * 100) : 0}%)
          </p>
        </div>

        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Cargadas hoy</h2>
          <p>Hoy: <strong>{stats.hoy}</strong></p>
          <p>Completas hoy: <strong>{stats.hoy_completas}</strong></p>
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>Usuarios registrados ({usuarios.length})</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: 8 }}>Email</th>
              <th style={{ padding: 8 }}>Registrado</th>
              <th style={{ padding: 8 }}>Días de trial restantes</th>
              <th style={{ padding: 8 }}>Correo enviado hoy</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => {
              const vencido = u.dias_restantes !== null && u.dias_restantes < 0
              return (
                <tr key={u.user_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: 8 }}>{u.email}</td>
                  <td style={{ padding: 8 }}>
                    {u.trial_inicio ? new Date(u.trial_inicio).toLocaleDateString('es-CL') : '—'}
                  </td>
                  <td
                    style={{
                      padding: 8,
                      color: vencido ? '#c62828' : undefined,
                      fontWeight: vencido ? 600 : undefined,
                    }}
                  >
                    {u.dias_restantes === null
                      ? '—'
                      : vencido
                      ? `Vencido hace ${Math.abs(u.dias_restantes)} días`
                      : `${u.dias_restantes} días`}
                  </td>
                  <td style={{ padding: 8 }}>{u.correo_enviado_hoy ? '✅ Sí' : '❌ No'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </main>
  )
}