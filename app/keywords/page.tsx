'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

// Ubicación en el proyecto: app/keywords/page.tsx

type Keyword = {
  id: string
  palabra_clave: string
  activo: boolean
}

export default function KeywordsPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [nueva, setNueva] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  const cargarKeywords = async () => {
    setCargando(true)
    setError(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()

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
      // Si el trial venció, la política RLS bloquea el select y esto captura
      // ese caso también (aparece como error de permisos).
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

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return

    const { error } = await supabase
      .from('keywords_usuario')
      .insert({ user_id: user.id, palabra_clave: texto })

    if (error) {
      setError(error.message)
      return
    }

    setNueva('')
    cargarKeywords()
  }

  const eliminarKeyword = async (id: string) => {
    setError(null)
    const { error } = await supabase.from('keywords_usuario').delete().eq('id', id)

    if (error) {
      setError(error.message)
      return
    }

    setKeywords((prev) => prev.filter((k) => k.id !== id))
  }

  return (
    <div style={{ maxWidth: 480, margin: '60px auto', fontFamily: 'sans-serif' }}>
      <h1>Mis palabras clave</h1>
      <p>Agrega palabras clave para filtrar las licitaciones que te interesan.</p>

      <form onSubmit={agregarKeyword} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          placeholder="Ej: informática, aseo, construcción"
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit">Agregar</button>
      </form>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {cargando ? (
        <p>Cargando...</p>
      ) : keywords.length === 0 ? (
        <p>Todavía no tienes palabras clave. Agrega la primera arriba.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {keywords.map((k) => (
            <li
              key={k.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <span>{k.palabra_clave}</span>
              <button onClick={() => eliminarKeyword(k.id)}>Eliminar</button>
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: 32 }}>
        <a href="/">← Volver</a>
      </p>
    </div>
  )
}