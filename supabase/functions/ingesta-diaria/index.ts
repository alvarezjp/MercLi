import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Ubicación en el proyecto: supabase/functions/ingesta-diaria/index.ts
//
// Hace tres cosas cada vez que corre:
// 1. Descarga el listado diario de licitaciones y las guarda/actualiza.
// 2. Paso B — GARANTIZADO: enriquece TODOS los códigos que trajo el listado
//    de ESTA corrida y que todavía no tienen organismo. Sin tope artificial:
//    lo que entra en esta llamada, sale completo de esta llamada. Se sube
//    incrementalmente (tanda por tanda) para no perder progreso si la
//    función se corta por tiempo.
// 3. Paso C — BEST EFFORT: si sobra tiempo de ejecución después del Paso B,
//    usa el resto del presupuesto para avanzar el backlog histórico viejo.
//    Nunca compite por cupo con el Paso B; si no sobra tiempo, simplemente
//    no corre esta vez y no pasa nada.

const CONCURRENCIA = 12
// Margen de seguridad bajo el límite del plan gratuito de Supabase (150s
// wall-clock). Dejamos colchón para el resto de la función (fetch del
// listado, upserts, logs).
const LIMITE_TIEMPO_MS = 120_000
const TIEMPO_MINIMO_PARA_INTENTAR_BACKLOG_MS = 20_000
const TANDA_BACKLOG = 100

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

  const items: any[] = detalle.Items?.Listado ?? []
  const productosTexto = items
    .map((item) => [item.NombreProducto, item.Descripcion].filter(Boolean).join(' — '))
    .filter(Boolean)
    .join(' | ') || null

  return {
    codigo,
    organismo: detalle.Comprador?.NombreOrganismo ?? null,
    monto_estimado: typeof detalle.MontoEstimado === 'number' ? detalle.MontoEstimado : null,
    estado: detalle.Estado ?? null,
    descripcion: detalle.Descripcion ?? null,
    productos_texto: productosTexto,
    raw_json_detalle: detalle,
    actualizado_en: new Date().toISOString(),
  }
}

// Enriquece una lista de {codigo, nombre} en tandas de `concurrencia`,
// subiendo cada tanda a la base apenas termina (no espera al final) para no
// perder progreso si la función se corta por timeout a mitad de camino.
async function enriquecerYGuardarProgresivo(
  pendientes: { codigo: string; nombre: string }[],
  ticket: string,
  supabase: ReturnType<typeof createClient>,
  concurrencia: number
): Promise<number> {
  let total = 0
  for (let i = 0; i < pendientes.length; i += concurrencia) {
    const tanda = pendientes.slice(i, i + concurrencia)
    const detalles = await Promise.all(
      tanda.map(async (fila) => {
        const detalle = await obtenerDetalleLicitacion(fila.codigo, ticket)
        if (!detalle) return null
        return { ...detalle, nombre: fila.nombre }
      })
    )
    const filasValidas = detalles.filter((d) => d !== null)
    if (filasValidas.length > 0) {
      const { error } = await supabase
        .from('licitaciones')
        .upsert(filasValidas, { onConflict: 'codigo' })
      if (error) throw error
      total += filasValidas.length
    }
  }
  return total
}

Deno.serve(async (_req) => {
  const inicioEjecucion = Date.now()
  const tiempoRestanteMs = () => LIMITE_TIEMPO_MS - (Date.now() - inicioEjecucion)

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

    // --- Paso A: listado diario ---
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
          .map((fila) => [fila.codigo, fila])
      ).values()
    )

    let cantidadInsertadas = 0

    if (filasBase.length > 0) {
      const { error } = await supabase
        .from('licitaciones')
        .upsert(filasBase, { onConflict: 'codigo' })

      if (error) throw error
      cantidadInsertadas = filasBase.length
    }

    // --- Paso B (GARANTIZADO): enriquecer TODO lo que trajo esta llamada ---
    let cantidadEnriquecidasHoy = 0

    if (filasBase.length > 0) {
      const codigosDeEstaLlamada = filasBase.map((f) => f.codigo)

      const { data: pendientesDeHoy, error: errorPendHoy } = await supabase.rpc(
        'codigos_sin_organismo',
        { p_codigos: codigosDeEstaLlamada }
      )
      if (errorPendHoy) throw errorPendHoy

      if (pendientesDeHoy && pendientesDeHoy.length > 0) {
        cantidadEnriquecidasHoy = await enriquecerYGuardarProgresivo(
          pendientesDeHoy,
          ticket,
          supabase,
          CONCURRENCIA
        )
      }
    }

    // --- Paso C (BEST EFFORT): si sobra tiempo, avanzar backlog histórico ---
    let cantidadEnriquecidasBacklog = 0

    while (tiempoRestanteMs() > TIEMPO_MINIMO_PARA_INTENTAR_BACKLOG_MS) {
      const { data: pendientesBacklog, error: errorBacklog } = await supabase.rpc(
        'codigos_pendientes_relevantes',
        { p_limite: TANDA_BACKLOG }
      )
      if (errorBacklog) throw errorBacklog
      if (!pendientesBacklog || pendientesBacklog.length === 0) break // backlog agotado

      const enriquecidas = await enriquecerYGuardarProgresivo(
        pendientesBacklog,
        ticket,
        supabase,
        CONCURRENCIA
      )
      cantidadEnriquecidasBacklog += enriquecidas

      // Si una tanda completa no encontró nada válido, evitamos loop infinito.
      if (enriquecidas === 0) break
    }

    const { error: logError } = await supabase.from('logs_ingesta').insert({
      ok: true,
      fecha_consultada: fecha,
      cantidad_insertadas: cantidadInsertadas,
      cantidad_enriquecidas: cantidadEnriquecidasHoy + cantidadEnriquecidasBacklog,
      mensaje_error: null,
    })
    if (logError) console.error('Error al insertar en logs_ingesta:', logError)

    return new Response(
      JSON.stringify({
        ok: true,
        fecha,
        insertadas: cantidadInsertadas,
        enriquecidas_hoy: cantidadEnriquecidasHoy,
        enriquecidas_backlog: cantidadEnriquecidasBacklog,
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