import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import LogoutButton from '@/components/LogoutButton'

export const dynamic = 'force-dynamic'

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

// ── helpers ────────────────────────────────────────────────────────────────

function pct(a: number, b: number) {
  return b > 0 ? Math.round((a / b) * 100) : 0
}

function fmtFecha(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function TrialBadge({ dias }: { dias: number | null }) {
  if (dias === null) return <span className="text-slate-400">—</span>
  if (dias < 0)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-0.5">
        Vencido hace {Math.abs(dias)} días
      </span>
    )
  if (dias <= 3)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-0.5">
        {dias} días
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-2.5 py-0.5">
      {dias} días
    </span>
  )
}

// ── página ─────────────────────────────────────────────────────────────────

export default async function AdminPage() {
  const supabase = await createClient()

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) redirect('/login')

  const { data: esAdmin, error: errorAdmin } = await supabase.rpc('es_admin_actual')
  if (errorAdmin || !esAdmin) redirect('/')

  const [{ data: lic, error: errorLic }, { data: statsUsuarios, error: errorUsuarios }] =
    await Promise.all([
      supabase.rpc('admin_stats_licitaciones').single<StatsLicitaciones>(),
      supabase.rpc('admin_stats_usuarios'),
    ])

  if (errorLic) throw new Error('Error al cargar estadísticas de licitaciones: ' + errorLic.message)
  if (errorUsuarios) throw new Error('Error al cargar estadísticas de usuarios: ' + errorUsuarios.message)

  const stats = lic ?? { total: 0, completas: 0, hoy: 0, hoy_completas: 0 }
  const usuarios = (statsUsuarios ?? []) as StatsUsuario[]

  const completasPct = pct(stats.completas, stats.total)
  const completasHoyPct = pct(stats.hoy_completas, stats.hoy)

  return (
    <div className="min-h-screen bg-[#F0F4F8] flex">
      {/* ── Sidebar ── */}
      <aside className="hidden lg:flex flex-col w-60 bg-[#0B1F3A] min-h-screen px-5 py-8 shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-10">
          <div className="w-8 h-8 rounded-lg bg-[#00B4D8] flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h18M3 9h18M3 15h18M3 21h18" />
            </svg>
          </div>
          <span className="text-white font-semibold text-base">LicitaAlerta</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1">
          <SidebarItem icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
          } label="Dashboard" active />
          <SidebarItem icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          } label="Usuarios" />
          <SidebarItem icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
          } label="Licitaciones" />
        </nav>

        {/* Admin badge */}
        <div className="mt-auto pt-6 border-t border-white/10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-full bg-[#0D3B6E] flex items-center justify-center text-[#00B4D8] text-xs font-bold">
              A
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-medium truncate">{userData.user.email}</p>
              <p className="text-slate-500 text-xs">Administrador</p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </aside>

      {/* ── Contenido principal ── */}
      <main className="flex-1 px-6 py-8 lg:px-10 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#0B1F3A]">Panel de administrador</h1>
            <p className="text-slate-500 text-sm mt-0.5">Resumen general del sistema</p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 bg-[#0B1F3A] text-[#00B4D8] text-xs font-semibold px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00B4D8] animate-pulse" />
            En vivo
          </span>
        </div>

        {/* ── Stat cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total licitaciones"
            value={stats.total.toLocaleString('es-CL')}
            sub={`${stats.completas.toLocaleString('es-CL')} completas (${completasPct}%)`}
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
            }
            accent="#00B4D8"
          />
          <StatCard
            label="Cargadas hoy"
            value={stats.hoy.toLocaleString('es-CL')}
            sub={`${stats.hoy_completas} completas (${completasHoyPct}%)`}
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
            }
            accent="#0096C7"
          />
          <StatCard
            label="Usuarios totales"
            value={usuarios.length.toString()}
            sub={`${usuarios.filter(u => u.correo_enviado_hoy).length} notificados hoy`}
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            }
            accent="#0B1F3A"
          />
          <StatCard
            label="Trials vencidos"
            value={usuarios.filter(u => u.dias_restantes !== null && u.dias_restantes < 0).length.toString()}
            sub="usuarios sin acceso activo"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
            }
            accent="#ef4444"
          />
        </div>

        {/* ── Tabla de usuarios ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#0B1F3A]">
              Usuarios registrados
              <span className="ml-2 text-xs font-normal text-slate-400">({usuarios.length})</span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Registrado</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Trial restante</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Notificado hoy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usuarios.map((u) => (
                  <tr key={u.user_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3.5 font-medium text-[#0B1F3A]">{u.email}</td>
                    <td className="px-6 py-3.5 text-slate-500">{fmtFecha(u.trial_inicio)}</td>
                    <td className="px-6 py-3.5">
                      <TrialBadge dias={u.dias_restantes} />
                    </td>
                    <td className="px-6 py-3.5">
                      {u.correo_enviado_hoy ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 text-xs font-medium">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                          Enviado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-slate-400 text-xs font-medium">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
                          Pendiente
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {usuarios.length === 0 && (
              <div className="px-6 py-12 text-center text-slate-400 text-sm">
                No hay usuarios registrados aún.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

// ── Sub-componentes ─────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string
  value: string
  sub: string
  icon: React.ReactNode
  accent: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-xs font-medium text-slate-500 leading-snug">{label}</p>
        <span
          className="p-1.5 rounded-lg shrink-0"
          style={{ background: accent + '18', color: accent }}
        >
          {icon}
        </span>
      </div>
      <p className="text-2xl font-bold text-[#0B1F3A]">{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
    </div>
  )
}

function SidebarItem({
  icon,
  label,
  active = false,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
}) {
  return (
    <button
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-[#00B4D8]/15 text-[#00B4D8]'
          : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
