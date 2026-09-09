'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

type Licitacion = {
  codigo: string
  nombre: string
  organismo: string | null
  monto_estimado: number | null
  estado: string | null
  fecha_cierre: string | null
  fecha_publicacion: string | null
  estado_usuario: 'nueva' | 'vista' | 'postulada'
}

const URL_BASE_MERCADO_PUBLICO =
  'http://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion='

// ── Badge de estado del usuario ───────────────────────────────────────────

function EstadoBadge({ estado }: { estado: Licitacion['estado_usuario'] }) {
  const map = {
    nueva: 'bg-[#00B4D8]/15 text-[#0096C7] border-[#00B4D8]/30',
    vista: 'bg-slate-100 text-slate-500 border-slate-200',
    postulada: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  }
  const labels = { nueva: 'Nueva', vista: 'Vista', postulada: 'Postulada' }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${map[estado]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        estado === 'nueva' ? 'bg-[#00B4D8]' :
        estado === 'postulada' ? 'bg-emerald-500' : 'bg-slate-400'
      }`} />
      {labels[estado]}
    </span>
  )
}

// ── Días para el cierre ───────────────────────────────────────────────────

function DiasParaCierre({ fecha }: { fecha: string | null }) {
  if (!fecha) return null
  const dias = Math.ceil((new Date(fecha).getTime() - Date.now()) / (1000 * 60 * 60 * 24))

  if (dias < 0) return <span className="text-xs text-slate-400">Cerrada</span>
  if (dias === 0) return <span className="text-xs font-semibold text-red-600">Cierra hoy</span>
  if (dias <= 3) return <span className="text-xs font-semibold text-amber-600">Cierra en {dias} día{dias !== 1 ? 's' : ''}</span>
  return <span className="text-xs text-slate-400">Cierra en {dias} días</span>
}

// ── Componente principal ──────────────────────────────────────────────────

export default function ListaLicitaciones({
  licitaciones,
  userId,
}: {
  licitaciones: Licitacion[]
  userId: string
}) {
  const router = useRouter()
  const supabase = createClient()

  const marcarEstado = async (codigo: string, estado: 'vista' | 'postulada') => {
    const { error } = await supabase.from('licitacion_usuario_estado').upsert(
      {
        user_id: userId,
        codigo_licitacion: codigo,
        estado,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: 'user_id,codigo_licitacion' }
    )

    if (error) {
      alert('No se pudo actualizar el estado: ' + error.message)
      return
    }

    router.refresh()
  }

  const verDetalle = async (lic: Licitacion) => {
    window.open(URL_BASE_MERCADO_PUBLICO + encodeURIComponent(lic.codigo), '_blank')
    if (lic.estado_usuario === 'nueva') {
      await marcarEstado(lic.codigo, 'vista')
    }
  }

  // ── Estado vacío ─────────────────────────────────────────────────────────
  if (licitaciones.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-8 py-14 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" x2="8" y1="13" y2="13"/>
            <line x1="16" x2="8" y1="17" y2="17"/>
            <line x1="10" x2="8" y1="9" y2="9"/>
          </svg>
        </div>
        <p className="text-base font-semibold text-[#0B1F3A] mb-1">No hay licitaciones aún</p>
        <p className="text-sm text-slate-500 max-w-xs">
          No hay resultados que coincidan con tus palabras clave.{' '}
          <a href="/keywords" className="text-[#00B4D8] font-medium hover:text-[#0096C7] transition-colors">
            Agregar o revisar palabras clave →
          </a>
        </p>
      </div>
    )
  }

  // ── Lista ─────────────────────────────────────────────────────────────────
  return (
    <ul className="space-y-3">
      {licitaciones.map((lic) => (
        <li
          key={lic.codigo}
          className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
            lic.estado_usuario === 'nueva'
              ? 'border-[#00B4D8]/40'
              : 'border-slate-200'
          }`}
        >
          {/* Franja de color para licitaciones nuevas */}
          {lic.estado_usuario === 'nueva' && (
            <div className="h-0.5 bg-gradient-to-r from-[#00B4D8] to-[#0096C7]" />
          )}

          <div className="px-5 py-4">
            {/* Fila superior: nombre + badge */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="text-sm font-semibold text-[#0B1F3A] leading-snug line-clamp-2 flex-1">
                {lic.nombre}
              </h3>
              <EstadoBadge estado={lic.estado_usuario} />
            </div>

            {/* Organismo */}
            {lic.organismo && (
              <p className="text-xs text-slate-500 mb-2.5 flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                {lic.organismo}
              </p>
            )}

            {/* Metadatos */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 mb-4">
              {lic.estado && (
                <span className="flex items-center gap-1">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  {lic.estado}
                </span>
              )}
              {lic.monto_estimado && (
                <span className="flex items-center gap-1">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" x2="12" y1="1" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                  </svg>
                  ${Number(lic.monto_estimado).toLocaleString('es-CL')}
                </span>
              )}
              {lic.fecha_publicacion && (
                <span>
                  Publicada {new Date(lic.fecha_publicacion).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}
                </span>
              )}
              <span className="text-slate-300">·</span>
              <span className="font-mono text-slate-400">{lic.codigo}</span>
              <DiasParaCierre fecha={lic.fecha_cierre} />
            </div>

            {/* Acciones */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => verDetalle(lic)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0B1F3A] hover:bg-[#0D3B6E] text-white text-xs font-semibold transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/>
                </svg>
                Ver en Mercado Público
              </button>

              <button
                onClick={() => marcarEstado(lic.codigo, 'vista')}
                disabled={lic.estado_usuario === 'vista' || lic.estado_usuario === 'postulada'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-default"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
                Vista
              </button>

              <button
                onClick={() => marcarEstado(lic.codigo, 'postulada')}
                disabled={lic.estado_usuario === 'postulada'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-default"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5"/>
                </svg>
                Postulada
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
