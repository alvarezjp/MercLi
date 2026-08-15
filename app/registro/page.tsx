'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'

// Ubicación en el proyecto: app/registro/page.tsx
// Al registrarse, se dispara automáticamente el trigger de Postgres del Paso 3
// (crear_perfil_nuevo_usuario), que crea la fila en `perfiles` con el trial de 7 días.

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

  if (enviado) {
    return (
      <div style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'sans-serif' }}>
        <h1>Revisa tu correo</h1>
        <p>
          Te enviamos un enlace de confirmación a <strong>{email}</strong>. Haz clic en él para
          activar tu cuenta y tu período de prueba de 7 días.
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>Crear cuenta</h1>
      <form onSubmit={handleRegistro} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="email"
          placeholder="Correo"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Contraseña (mínimo 6 caracteres)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={cargando}>
          {cargando ? 'Creando cuenta...' : 'Crear cuenta'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        ¿Ya tienes cuenta? <a href="/login">Inicia sesión</a>
      </p>
    </div>
  )
}