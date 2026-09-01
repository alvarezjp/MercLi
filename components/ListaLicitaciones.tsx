'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

// Ubicación en el proyecto: components/ListaLicitaciones.tsx

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

const COLORES_ESTADO: Record<string, { fondo: string; texto: string; etiqueta: string }> = {
  nueva: { fondo: '#e3f2fd', texto: '#1565c0', etiqueta: 'Nueva' },
  vista: { fondo: '#f5f5f5', texto: '#616161', etiqueta: 'Vista' },
  postulada: { fondo: '#e8f5e9', texto: '#2e7d32', etiqueta: 'Postulada' },
}

const URL_BASE_MERCADO_PUBLICO =
  'http://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion='

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

    // Vuelve a pedirle los datos al Server Component (app/page.tsx),
    // así el badge se actualiza con el estado real desde la base de datos.
    router.refresh()
  }

  const verDetalle = async (lic: Licitacion) => {
    // Abrir la pestaña ANTES del await es importante: los navegadores bloquean
    // popups que se abren después de una operación asíncrona porque ya no lo
    // consideran resultado directo del clic del usuario.
    window.open(URL_BASE_MERCADO_PUBLICO + encodeURIComponent(lic.codigo), '_blank')

    if (lic.estado_usuario === 'nueva') {
      await marcarEstado(lic.codigo, 'vista')
    }
  }

  if (licitaciones.length === 0) {
    return (
      <p>
        No hay licitaciones que coincidan todavía. Agrega o revisa tus{' '}
        <a href="/keywords">palabras clave</a>.
      </p>
    )
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {licitaciones.map((lic) => {
        const colores = COLORES_ESTADO[lic.estado_usuario] ?? COLORES_ESTADO.nueva

        return (
          <li
            key={lic.codigo}
            style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 12 }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
              }}
            >
              <h3 style={{ margin: '0 0 8px' }}>{lic.nombre}</h3>
              <span
                style={{
                  background: colores.fondo,
                  color: colores.texto,
                  padding: '2px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {colores.etiqueta}
              </span>
            </div>

            <p style={{ margin: '4px 0', color: '#555' }}>
              {lic.organismo ?? 'Organismo no disponible todavía'}
            </p>

            <p style={{ margin: '4px 0' }}>
              Estado licitación: <strong>{lic.estado ?? 'Sin información'}</strong>
              {lic.monto_estimado && (
                <> · Monto estimado: ${Number(lic.monto_estimado).toLocaleString('es-CL')}</>
              )}
            </p>

            <p style={{ margin: '4px 0', fontSize: 14, color: '#888' }}>
              Código: {lic.codigo}
              {lic.fecha_publicacion && (
                <> · Publicada: {new Date(lic.fecha_publicacion).toLocaleDateString('es-CL')}</>
              )}
              {lic.fecha_cierre && (
                <> · Cierra: {new Date(lic.fecha_cierre).toLocaleDateString('es-CL')}</>
              )}
            </p>

            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button onClick={() => verDetalle(lic)}>Ver detalle en Mercado Público</button>
              <button
                onClick={() => marcarEstado(lic.codigo, 'vista')}
                disabled={lic.estado_usuario === 'vista'}
              >
                Marcar como vista
              </button>
              <button
                onClick={() => marcarEstado(lic.codigo, 'postulada')}
                disabled={lic.estado_usuario === 'postulada'}
              >
                Marcar como postulada
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}