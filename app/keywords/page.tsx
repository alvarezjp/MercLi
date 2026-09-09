'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

type Keyword = {
  id: string
  palabra_clave: string
  activo: boolean
}

export default function KeywordsPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [nueva, setNueva] = useState('')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [eliminando, setEliminando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  const cargarKeywords = async () => {
    setCargando(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      setError('No hay sesión activa.')
      setCargando(false)
      return
    }

    const { data, error } = await supabase
      .from('keywords_usuario')
      .select('id, palabra_clave, activo')
      .eq('user_id', user.id)
      .eq('activo', true)
      .order('creado_en', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setKeywords(data ?? [])
    }
    setCargando(false)
  }

  useEffect(() => {
    cargarKeywords()
  }, [])

  const agregarKeyword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const texto = nueva.trim()
    if (!texto) return

    setGuardando(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setGuardando(false); return }

    const { error } = await supabase
      .from('keywords_usuario')
      .insert({ user_id: user.id, palabra_clave: texto })

    setGuardando(false)

    if (error) {
      setError(error.message)
      return
    }

    setNueva('')
    cargarKeywords()
  }

  const eliminarKeyword = async (id: string) => {
    setError(null)
    setEliminando(id)

    const { error } = await supabase.from('keywords_usuario').delete().eq('id', id)

    setEliminando(null)

    if (error) {
      setError(error.message)
      return
    }

    setKeywords((prev) => prev.filter((k) => k.id !== id))
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] flex flex-col">
      {/* Top nav */}
      <header className="bg-[#0B1F3A] px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#00B4D8] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h18M3 9h18M3 15h18M3 21h18" />
            </svg>
          </div>
          <span className="text-white font-semibold text-sm">LicitaAlerta</span>
        </div>

        <a
          href="/"
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Volver al inicio
        </a>
      </header>

      {/* Contenido */}
      <main className="flex-1 flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-lg">
          {/* Encabezado */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[#0B1F3A]">Mis palabras clave</h1>
            <p className="text-slate-500 text-sm mt-1">
              Las licitaciones cuyo nombre contenga alguna de estas palabras aparecerán en tu panel.
            </p>
          </div>

          {/* Tarjeta principal */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Formulario agregar */}
            <div className="px-6 py-5 border-b border-slate-100">
              <form onSubmit={agregarKeyword} className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-3 flex items-center text-slate-400 pointer-events-none">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={nueva}
                    onChange={(e) => setNueva(e.target.value)}
                    placeholder="Ej: informática, aseo, construcción"
                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00B4D8] focus:border-transparent transition"
                  />
                </div>
                <button
                  type="submit"
                  disabled={guardando || !nueva.trim()}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#0B1F3A] hover:bg-[#0D3B6E] text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {guardando ? (
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  )}
                  Agregar
                </button>
              </form>
            </div>

            {/* Error */}
            {error && (
              <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
                </svg>
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Lista */}
            <div className="px-6 py-4">
              {cargando ? (
                <div className="flex flex-col gap-2 py-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />
                  ))}
                </div>
              ) : keywords.length === 0 ? (
                <div className="py-10 flex flex-col items-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700">Sin palabras clave aún</p>
                    <p className="text-xs text-slate-400 mt-0.5">Agrega la primera usando el campo de arriba.</p>
                  </div>
                </div>
              ) : (
                <ul className="space-y-2">
                  {keywords.map((k) => (
                    <li
                      key={k.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-[#00B4D8] shrink-0" />
                        <span className="text-sm font-medium text-[#0B1F3A] truncate">
                          {k.palabra_clave}
                        </span>
                      </div>
                      <button
                        onClick={() => eliminarKeyword(k.id)}
                        disabled={eliminando === k.id}
                        aria-label={`Eliminar ${k.palabra_clave}`}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40 shrink-0"
                      >
                        {eliminando === k.id ? (
                          <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                          </svg>
                        )}
                        Eliminar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer con contador */}
            {!cargando && keywords.length > 0 && (
              <div className="px-6 py-3 border-t border-slate-100 bg-slate-50">
                <p className="text-xs text-slate-400">
                  {keywords.length} {keywords.length === 1 ? 'palabra clave activa' : 'palabras clave activas'}
                </p>
              </div>
            )}
          </div>

          {/* Tip */}
          <div className="mt-4 flex items-start gap-2.5 bg-[#0B1F3A]/5 border border-[#0B1F3A]/10 rounded-xl px-4 py-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#00B4D8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
              <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
            </svg>
            <p className="text-xs text-slate-500 leading-relaxed">
              Las palabras clave se comparan contra el nombre de la licitación y sus elementos internos. Usa términos generales para mejores resultados — por ejemplo <strong className="text-slate-600">aseo</strong> en lugar de <strong className="text-slate-600">servicio de aseo y limpieza</strong>.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
