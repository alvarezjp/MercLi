'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'

// Al registrarse se dispara el trigger de Postgres (crear_perfil_nuevo_usuario)
// que crea la fila en `perfiles` con el trial de 7 días.

export default function RegistroPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)
  const [cargando, setCargando] = useState(false)

  const handleRegistro = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setCargando(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setCargando(false)

    if (error) {
      setError(error.message)
      return
    }

    setEnviado(true)
  }

  // ── Pantalla de confirmación ──────────────────────────────────────────────
  if (enviado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-8 py-10 max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-full bg-[#00B4D8]/15 flex items-center justify-center mx-auto mb-5">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#00B4D8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="20" height="16" x="2" y="4" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
          </div>
          <h2 className="text-xl font-bold text-[#0B1F3A] mb-2">Revisa tu correo</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            Enviamos un enlace de confirmación a{' '}
            <strong className="text-slate-700">{email}</strong>. Haz clic en él para activar tu
            cuenta e iniciar tu prueba gratuita de 7 días.
          </p>
          <div className="mt-6 pt-6 border-t border-slate-100">
            <a
              href="/login"
              className="text-sm text-[#00B4D8] font-medium hover:text-[#0096C7] transition-colors"
            >
              ← Volver al inicio de sesión
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Formulario de registro ────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex">
      {/* Panel izquierdo — branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-[#0B1F3A] px-14 py-12 relative overflow-hidden">
        {/* Círculos decorativos */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-[#0D3B6E] opacity-40" />
        <div className="absolute bottom-0 right-0 w-80 h-80 rounded-full bg-[#00B4D8] opacity-10 translate-x-1/3 translate-y-1/3" />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#00B4D8] flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h18M3 9h18M3 15h18M3 21h18" />
            </svg>
          </div>
          <span className="text-white font-semibold text-lg tracking-wide">LicitaAlerta</span>
        </div>

        {/* Copy central */}
        <div className="relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 bg-white/10 text-[#90E0EF] text-xs font-medium px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00B4D8] inline-block" />
            Prueba gratuita por 7 días
          </div>
          <h1 className="text-4xl font-bold text-white leading-tight">
            Empieza a detectar<br />
            oportunidades<br />
            <span className="text-[#00B4D8]">hoy mismo.</span>
          </h1>
          <p className="text-slate-400 text-base leading-relaxed max-w-sm">
            Crea tu cuenta en segundos y configura tus palabras clave. LicitaAlerta se encarga del resto.
          </p>

          {/* Beneficios */}
          <ul className="space-y-3 pt-1">
            {[
              'Alertas diarias por correo',
              'Filtro por palabras clave',
              'Datos directo de Mercado Público',
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-slate-300 text-sm">
                <span className="w-5 h-5 rounded-full bg-[#00B4D8]/20 flex items-center justify-center shrink-0">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#00B4D8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-slate-500 text-xs">
          © {new Date().getFullYear()} LicitaAlerta — Datos de Mercado Público Chile
        </p>
      </div>

      {/* Panel derecho — formulario */}
      <div className="flex flex-1 flex-col justify-center items-center bg-[#F0F4F8] px-6 py-12">
        <div className="w-full max-w-md">
          {/* Header móvil */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-[#0B1F3A] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3h18M3 9h18M3 15h18M3 21h18" />
              </svg>
            </div>
            <span className="text-[#0B1F3A] font-semibold text-base">LicitaAlerta</span>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-8 py-10">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-[#0B1F3A]">Crear cuenta</h2>
              <p className="text-slate-500 text-sm mt-1">
                Gratis por 7 días, sin tarjeta de crédito.
              </p>
            </div>

            <form onSubmit={handleRegistro} className="space-y-5">
              {/* Email */}
              <div className="space-y-1.5">
                <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                  Correo electrónico
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-slate-400 pointer-events-none">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2"/>
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                    </svg>
                  </span>
                  <input
                    id="email"
                    type="email"
                    placeholder="tucorreo@empresa.cl"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00B4D8] focus:border-transparent transition"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                  Contraseña
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-slate-400 pointer-events-none">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </span>
                  <input
                    id="password"
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00B4D8] focus:border-transparent transition"
                  />
                </div>
                <p className="text-xs text-slate-400">Usa al menos 6 caracteres.</p>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" x2="12" y1="8" y2="12"/>
                    <line x1="12" x2="12.01" y1="16" y2="16"/>
                  </svg>
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={cargando}
                className="w-full py-2.5 rounded-lg bg-[#00B4D8] hover:bg-[#0096C7] text-white text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
              >
                {cargando ? (
                  <>
                    <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Creando cuenta...
                  </>
                ) : (
                  'Crear cuenta gratis'
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              ¿Ya tienes cuenta?{' '}
              <a href="/login" className="text-[#00B4D8] font-medium hover:text-[#0096C7] transition-colors">
                Iniciar sesión
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
