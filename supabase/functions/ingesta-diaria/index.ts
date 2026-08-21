import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Ubicación en el proyecto: supabase/functions/ingesta-diaria/index.ts
//
// Hace dos cosas cada vez que corre:
// 1. Descarga el listado diario de licitaciones y las guarda/actualiza (como antes).
// 2. Enriquece hasta MAX_ENRIQUECER licitaciones que todavía no tienen organismo
//    asignado, llamando al endpoint de detalle por código. Esto incluye tanto
//    las licitaciones nuevas de hoy como cualquier backlog de días anteriores.
//    Se hace en tandas para no exceder el tiempo límite de la función ni golpear
//    la API con demasiadas peticiones simultáneas.

const MAX_ENRIQUECER = 150
const CONCURRENCIA = 5

function obtenerServiceRoleKey(): string | undefined {
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretKeysRaw) {
    try {
      const secretKeys = JSON.parse(secretKeysRaw)
      if (secretKeys?.default) return secretKeys.default
    } catch {
      // Si no se pudo parsear, seguimos al fallback de abajo
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
}

// Ejecuta una lista de funciones async respetando un límite de concurrencia,
// para no lanzar cientos de peticiones HTTP al mismo tiempo.
async function ejecutarConConcurrencia<T>(
  tareas: (() => Promise<T>)[],
  limite: number
): Promise<T[]> {
  const resultados: T[] = []
  for (let i = 0; i < tareas.length; i += limite) {
    const tanda = tareas.slice(i, i + limite)
    const resultadosTanda = await Promise.all(tanda.map((tarea) => tarea()))
    resultados.push(...resultadosTanda)
  }
  return resultados
}

async function obtenerDetalleLicitacion(codigo: string, ticket: string) {
  const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${encodeURIComponent(
    codigo
  )}&ticket=${ticket}`
  const resp = await fetch(url)
  if (!resp.ok) return null

  const data = await resp.json()
  const detalle = data?.Listado?.[0]
  if (!detalle) return null

  return {
    codigo,
    organismo: detalle.Comprador?.NombreOrganismo ?? null,
    monto_estimado: typeof detalle.MontoEstimado === 'number' ? detalle.MontoEstimado : null,
    estado: detalle.Estado ?? null,
    raw_json_detalle: detalle,
    actualizado_en: new Date().toISOString(),
  }
}

Deno.serve(async (_req) => {
  let supabase: ReturnType<typeof createClient> | null = null
  let fecha: string | null = null

  try {
    const ticket = Deno.env.get('MERCADOPUBLICO_TICKET')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = obtenerServiceRoleKey()

    if (!ticket) throw new Error('Falta el secret MERCADOPUBLICO_TICKET')
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'Faltan las variables SUPABASE_URL / llave de servicio (SUPABASE_SECRET_KEYS o SUPABASE_SERVICE_ROLE_KEY)'
      )
    }

    supabase = createClient(supabaseUrl, serviceRoleKey)

    // --- Paso A: listado diario (igual que antes) ---
    const partesFecha = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())

    const dia = partesFecha.find((p) => p.type === 'day')!.value
    const mes = partesFecha.find((p) => p.type === 'month')!.value
    const anio = partesFecha.find((p) => p.type === 'year')!.value
    fecha = `${dia}${mes}${anio}`

    const urlListado = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?fecha=${fecha}&ticket=${ticket}`
    const respListado = await fetch(urlListado)

    if (!respListado.ok) {
      throw new Error(`La API de Mercado Público respondió con status ${respListado.status}`)
    }

    const dataListado = await respListado.json()
    const listado: any[] = dataListado?.Listado ?? []

    const filasBase = Array.from(
      new Map(
        listado
          .map((item) => ({
            codigo: item.CodigoExterno,
            nombre: item.Nombre,
            fecha_publicacion: `${anio}-${mes}-${dia}`,
            fecha_cierre: item.FechaCierre ?? null,
            raw_json: item,
            actualizado_en: new Date().toISOString(),
          }))
          .filter((fila) => fila.codigo && fila.nombre)
          .map((fila) => [fila.codigo, fila]) // si hay códigos repetidos, se queda con el último
      ).values()
    )

    let cantidadInsertadas = 0

    if (filasBase.length > 0) {
      // Ojo: a propósito NO incluimos 'estado', 'organismo' ni 'monto_estimado'
      // aquí. Así, si la licitación ya existía y ya estaba enriquecida, este
      // upsert no pisa esos valores — solo actualiza lo que trae el listado diario.
      const { error } = await supabase
        .from('licitaciones')
        .upsert(filasBase, { onConflict: 'codigo' })

      if (error) throw error
      cantidadInsertadas = filasBase.length
    }

    // --- Paso B: enriquecer licitaciones sin organismo asignado (nuevas o backlog) ---
    const { data: pendientes, error: errorPendientes } = await supabase
      .from('licitaciones')
      .select('codigo, nombre')
      .is('organismo', null)
      .limit(MAX_ENRIQUECER)

    if (errorPendientes) throw errorPendientes

    let cantidadEnriquecidas = 0

    if (pendientes && pendientes.length > 0) {
      const tareas = pendientes.map(
        (fila: { codigo: string; nombre: string }) => async () => {
          const detalle = await obtenerDetalleLicitacion(fila.codigo, ticket)
          if (!detalle) return null
          // Reenviamos 'nombre' sin modificarlo: Postgres lo exige por la
          // restricción NOT NULL al construir la fila candidata de ON CONFLICT,
          // aunque en la práctica esta operación siempre termina en UPDATE.
          return { ...detalle, nombre: fila.nombre }
        }
      )
      const detalles = await ejecutarConConcurrencia(tareas, CONCURRENCIA)
      const filasEnriquecidas = detalles.filter((d) => d !== null)

      if (filasEnriquecidas.length > 0) {
        const { error: errorEnriquecer } = await supabase
          .from('licitaciones')
          .upsert(filasEnriquecidas, { onConflict: 'codigo' })

        if (errorEnriquecer) throw errorEnriquecer
        cantidadEnriquecidas = filasEnriquecidas.length
      }
    }

    const { error: logError } = await supabase.from('logs_ingesta').insert({
      ok: true,
      fecha_consultada: fecha,
      cantidad_insertadas: cantidadInsertadas,
      cantidad_enriquecidas: cantidadEnriquecidas,
      mensaje_error: null,
    })
    if (logError) console.error('Error al insertar en logs_ingesta:', logError)

    return new Response(
      JSON.stringify({
        ok: true,
        fecha,
        insertadas: cantidadInsertadas,
        enriquecidas: cantidadEnriquecidas,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const mensajeError =
      err instanceof Error
        ? err.message
        : (err as any)?.message ?? JSON.stringify(err)

    console.error('Error en ingesta-diaria:', err)

    if (supabase) {
      const { error: logError } = await supabase.from('logs_ingesta').insert({
        ok: false,
        fecha_consultada: fecha,
        cantidad_insertadas: 0,
        cantidad_enriquecidas: 0,
        mensaje_error: mensajeError,
      })
      if (logError) console.error('Error al insertar en logs_ingesta:', logError)
    }

    return new Response(JSON.stringify({ ok: false, error: mensajeError }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})