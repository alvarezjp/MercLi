import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import LogoutButton from '@/components/LogoutButton'
import ListaLicitaciones from '@/components/ListaLicitaciones'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string }>
}) {
  const { orden } = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil, error } = await supabase
    .from('perfiles')
    .select('plan, trial_fin, activo')
    .eq('id', user.id)
    .single()

  // ── Error de perfil ──────────────────────────────────────────────────────
  if (error || !perfil) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-8 py-10 max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
            </svg>
          </div>
          <h2 className="text-lg font-bold text-[#0B1F3A] mb-2">No pudimos cargar tu perfil</h2>
          <p className="text-slate-500 text-sm">Intenta recargar la página. Si el problema persiste, contáctanos.</p>
        </div>
      </div>
    )
  }

  // ── Trial vencido ────────────────────────────────────────────────────────
  const trialVencido = perfil.plan === 'trial' && new Date(perfil.trial_fin) < new Date()

  if (trialVencido || !perfil.activo) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-8 py-10 max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <h2 className="text-lg font-bold text-[#0B1F3A] mb-2">Tu período de prueba terminó</h2>
          <p className="text-slate-500 text-sm mb-6">
            Tu prueba gratuita finalizó el{' '}
            <strong className="text-slate-700">
              {new Date(perfil.trial_fin).toLocaleDateString('es-CL', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </strong>.
            Contáctanos para seguir usando la plataforma.
          </p>
          <LogoutButton />
        </div>
      </div>
    )
  }

  // ── Datos ────────────────────────────────────────────────────────────────
  const diasRestantes = Math.ceil(
    (new Date(perfil.trial_fin).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  const { data: licitacionesData, error: errorLicitaciones } = await supabase.rpc(
    'buscar_licitaciones_por_keywords',
    { p_user_id: user.id }
  )

  const licitaciones = [...(licitacionesData ?? [])]
  if (orden === 'recientes') {
    licitaciones.sort(
      (a, b) => new Date(b.fecha_publicacion).getTime() - new Date(a.fecha_publicacion).getTime()
    )
  }

  const nuevas = licitaciones.filter((l) => l.estado_usuario === 'nueva').length

  return (
    <div className="min-h-screen bg-[#F0F4F8] flex flex-col">
      {/* ── Topbar ── */}
      <header className="bg-[#0B1F3A] px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#00B4D8] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h18M3 9h18M3 15h18M3 21h18" />
            </svg>
          </div>
          <span className="text-white font-semibold text-sm">LicitaAlerta</span>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/keywords"
            className="hidden sm:flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            Palabras clave
          </a>
          <div className="hidden sm:block w-px h-4 bg-white/10" />
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 px-4 py-8 max-w-4xl mx-auto w-full">
        {/* ── Banner trial ── */}
        {perfil.plan === 'trial' && (
          <div className={`flex items-center gap-3 rounded-xl px-4 py-3 mb-6 border text-sm ${
            diasRestantes <= 3
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-[#0B1F3A]/5 border-[#0B1F3A]/10 text-slate-700'
          }`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            {diasRestantes <= 3
              ? <>⚠️ Tu trial vence en <strong>{diasRestantes}</strong> día{diasRestantes !== 1 ? 's' : ''}. Contáctanos para continuar.</>
              : <>Estás en período de prueba. Te quedan <strong>{diasRestantes}</strong> días.</>
            }
          </div>
        )}

        {/* ── Encabezado + controles ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#0B1F3A]">Licitaciones</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Resultados que coinciden con tus palabras clave
              {nuevas > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 bg-[#00B4D8]/15 text-[#0096C7] text-xs font-semibold px-2 py-0.5 rounded-full">
                  {nuevas} nueva{nuevas !== 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>

          {/* Orden */}
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 self-start sm:self-auto">
            <a
              href="/"
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                orden !== 'recientes'
                  ? 'bg-[#0B1F3A] text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Relevancia
            </a>
            <a
              href="/?orden=recientes"
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                orden === 'recientes'
                  ? 'bg-[#0B1F3A] text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Más recientes
            </a>
          </div>
        </div>

        {/* ── Error licitaciones ── */}
        {errorLicitaciones && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 mb-6">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
            </svg>
            <p className="text-sm text-red-600">No se pudieron cargar las licitaciones: {errorLicitaciones.message}</p>
          </div>
        )}

        {/* ── Lista ── */}
        {!errorLicitaciones && (
          <ListaLicitaciones licitaciones={licitaciones} userId={user.id} />
        )}
      </main>
    </div>
  )
}
