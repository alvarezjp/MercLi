import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Ubicación en el proyecto: supabase/functions/ingesta-diaria/index.ts
//
// ETAPA 11 — Enriquecimiento por lotes (ver diseño en PLAN.md).
//
// AJUSTE post-despliegue #5 (mismo día): se agrega escalamiento del
// cortacircuito. Un solo 429/403 activa una pausa corta (probablemente
// ráfaga pasajera). Pero si se activa una SEGUNDA pausa corta sin que haya
// habido una corrida exitosa entre medio (es decir, dos cortes seguidos),
// se escala a una pausa larga (24h) — señal de que probablemente sí es
// cuota diaria agotada y no tiene sentido seguir insistiendo cada rato.
// El contador se resetea a 0 apenas una corrida logra avanzar sin cortarse,
// para no escalar por dos fallas aisladas en días distintos.

const CONCURRENCIA = 10
const PRESUPUESTO_MS = 135_000 // margen de seguridad bajo el límite de 150s del plan gratuito
const TIMEOUT_DETALLE_MS = 8_000 // evita que una sola petición colgada bloquee toda la tanda
const MAX_TANDAS_FALLIDAS_SEGUIDAS = 2 // cortacircuito general si varias tandas seguidas fallan 100%
const PAUSA_CORTA_SEGUNDOS = 60 // pausa tras el 1er corte
const PAUSA_LARGA_HORAS = 24 // pausa tras 2 cortes seguidos sin éxito entre medio
const UMBRAL_CORTES_PARA_ESCALAR = 2

type CodigoPendiente = { codigo: string; nombre: string }

type ResultadoDetalle =
  | { ok: true; datos: any }
  | { ok: false; status?: number; error?: string }

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

// Devuelve true si todavía estamos dentro de una pausa activa (corta o
// larga — ambas usan el mismo campo pausado_hasta, solo cambia cuánto
// dura). Si no hay pausa o ya expiró, devuelve false.
async function pausaActiva(supabase: ReturnType<typeof createClient>): Promise<boolean> {
  const { data, error } = await supabase
    .from('estado_pausa_enriquecimiento')
    .select('pausado_hasta')
    .eq('id', true)
    .maybeSingle()

  if (error || !data?.pausado_hasta) return false

  return new Date(data.pausado_hasta as string).getTime() > Date.now()
}

// Registra un corte nuevo. Si con este ya se llega al umbral de cortes
// seguidos, escala a pausa larga y reinicia el contador (ya escaló, no
// tiene sentido seguir sumando). Si no, activa una pausa corta y sube
// el contador en 1.
async function registrarCorteYPausar(
  supabase: ReturnType<typeof createClient>
): Promise<{ tipo: 'corta' | 'larga'; cortesSeguidos: number }> {
  const { data } = await supabase
    .from('estado_pausa_enriquecimiento')
    .select('cortes_seguidos')
    .eq('id', true)
    .maybeSingle()

  const cortesNuevos = (data?.cortes_seguidos ?? 0) + 1

  if (cortesNuevos >= UMBRAL_CORTES_PARA_ESCALAR) {
    const hasta = new Date(Date.now() + PAUSA_LARGA_HORAS * 60 * 60 * 1000).toISOString()
    await supabase
      .from('estado_pausa_enriquecimiento')
      .update({ pausado_hasta: hasta, cortes_seguidos: 0 })
      .eq('id', true)
    return { tipo: 'larga', cortesSeguidos: cortesNuevos }
  }

  const hasta = new Date(Date.now() + PAUSA_CORTA_SEGUNDOS * 1000).toISOString()
  await supabase
    .from('estado_pausa_enriquecimiento')
    .update({ pausado_hasta: hasta, cortes_seguidos: cortesNuevos })
    .eq('id', true)
  return { tipo: 'corta', cortesSeguidos: cortesNuevos }
}

// Se llama cuando una corrida logra avanzar sin activar el cortacircuito —
// confirma que la API está respondiendo bien, así que resetea el contador
// de cortes seguidos a 0.
async function resetearCortesSeguidos(supabase: ReturnType<typeof createClient>) {
  await supabase.from('estado_pausa_enriquecimiento').update({ cortes_seguidos: 0 }).eq('id', true)
}

async function obtenerDetalleLicitacion(codigo: string, ticket: string): Promise<ResultadoDetalle> {
  const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${encodeURIComponent(
    codigo
  )}&ticket=${ticket}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_DETALLE_MS)

  try {
    const resp = await fetch(url, { signal: controller.signal })
    if (!resp.ok) {
      return { ok: false, status: resp.status }
    }

    const data = await resp.json()
    const detalle = data?.Listado?.[0]
    if (!detalle) return { ok: false, error: 'sin_listado_en_respuesta' }

    const items: any[] = detalle.Items?.Listado ?? []
    const productosTexto = items
      .map((item) => [item.NombreProducto, item.Descripcion].filter(Boolean).join(' — '))
      .filter(Boolean)
      .join(' | ') || null

    return {
      ok: true,
      datos: {
        codigo,
        organismo: detalle.Comprador?.NombreOrganismo ?? null,
        monto_estimado: typeof detalle.MontoEstimado === 'number' ? detalle.MontoEstimado : null,
        estado: detalle.Estado ?? null,
        descripcion: detalle.Descripcion ?? null,
        productos_texto: productosTexto,
        raw_json_detalle: detalle,
        actualizado_en: new Date().toISOString(),
      },
    }
  } catch (err) {
    const esTimeout = err instanceof DOMException && err.name === 'AbortError'
    return { ok: false, error: esTimeout ? 'timeout' : String((err as any)?.message ?? err) }
  } finally {
    clearTimeout(timeoutId)
  }
}

// Procesa el lote hasta agotar el presupuesto de tiempo, hasta terminarlo,
// o hasta que el cortacircuito detecte un problema (rate limit u otra
// falla masiva) y decida detenerse y activar una pausa (corta o, si ya
// venía de otro corte reciente, escalada a larga).
async function procesarLote(
  supabase: ReturnType<typeof createClient>,
  lote: { id: string; codigos_pendientes: CodigoPendiente[] },
  ticket: string,
  inicioMs: number
): Promise<{
  pendientesRestantes: CodigoPendiente[]
  enriquecidas: number
  cortadoPorCircuito: boolean
  tipoPausa?: 'corta' | 'larga'
}> {
  let pendientes = [...lote.codigos_pendientes]
  let enriquecidas = 0
  let numeroTanda = 0
  let tandasFallidasSeguidas = 0
  let cortadoPorCircuito = false
  let tipoPausa: 'corta' | 'larga' | undefined

  while (pendientes.length > 0 && Date.now() - inicioMs < PRESUPUESTO_MS) {
    numeroTanda++
    const inicioTanda = Date.now()

    const tanda = pendientes.slice(0, CONCURRENCIA)
    const resto = pendientes.slice(CONCURRENCIA)

    const resultados = await Promise.all(
      tanda.map((item) => obtenerDetalleLicitacion(item.codigo, ticket))
    )

    const duracionTandaMs = Date.now() - inicioTanda

    const filasOk: any[] = []
    const fallidos: CodigoPendiente[] = []
    const statusVistos = new Set<number | string>()

    resultados.forEach((resultado, i) => {
      if (resultado.ok) {
        filasOk.push({ ...resultado.datos, nombre: tanda[i].nombre })
      } else {
        fallidos.push(tanda[i])
        statusVistos.add(resultado.status ?? resultado.error ?? 'desconocido')
      }
    })

    console.log(
      `Tanda ${numeroTanda}: ${filasOk.length}/${tanda.length} ok en ${duracionTandaMs}ms` +
      (statusVistos.size > 0 ? ` — fallos: ${[...statusVistos].join(', ')}` : '')
    )

    if (filasOk.length > 0) {
      const { error } = await supabase.from('licitaciones').upsert(filasOk, { onConflict: 'codigo' })
      if (error) throw error
      enriquecidas += filasOk.length
    }

    // Cortacircuito 1: cualquier 429/403 activa pausa (corta, o larga si
    // ya es el 2do corte seguido) y detiene esta invocación.
    const huboRateLimit = [...statusVistos].some((s) => s === 429 || s === 403)
    if (huboRateLimit) {
      const resultadoPausa = await registrarCorteYPausar(supabase)
      tipoPausa = resultadoPausa.tipo
      console.error(
        `CORTACIRCUITO: se detectó status 429/403 (rate limit). Corte seguido #${resultadoPausa.cortesSeguidos}. ` +
        `Pausa activada: ${resultadoPausa.tipo === 'larga' ? `${PAUSA_LARGA_HORAS}h (escalada)` : `${PAUSA_CORTA_SEGUNDOS}s`}. ` +
        `Deteniendo en tanda ${numeroTanda}.`
      )
      pendientes = [...resto, ...fallidos]
      cortadoPorCircuito = true
      break
    }

    // Cortacircuito 2: varias tandas seguidas fallando al 100% (sin ser
    // 429/403 puntual) — mismo tratamiento de pausa con escalamiento.
    if (filasOk.length === 0 && tanda.length > 0) {
      tandasFallidasSeguidas++
    } else {
      tandasFallidasSeguidas = 0
    }

    if (tandasFallidasSeguidas >= MAX_TANDAS_FALLIDAS_SEGUIDAS) {
      const resultadoPausa = await registrarCorteYPausar(supabase)
      tipoPausa = resultadoPausa.tipo
      console.error(
        `CORTACIRCUITO: ${tandasFallidasSeguidas} tandas seguidas fallaron al 100% ` +
        `(fallos vistos: ${[...statusVistos].join(', ')}). Corte seguido #${resultadoPausa.cortesSeguidos}. ` +
        `Pausa activada: ${resultadoPausa.tipo === 'larga' ? `${PAUSA_LARGA_HORAS}h (escalada)` : `${PAUSA_CORTA_SEGUNDOS}s`}.`
      )
      pendientes = [...resto, ...fallidos]
      cortadoPorCircuito = true
      break
    }

    pendientes = [...resto, ...fallidos]

    const { error: errorLote } = await supabase
      .from('lotes_enriquecimiento')
      .update({ codigos_pendientes: pendientes })
      .eq('id', lote.id)
    if (errorLote) throw errorLote
  }

  // Si terminamos el bucle SIN cortarnos (se acabó el lote o el
  // presupuesto de tiempo normalmente), la API está respondiendo bien —
  // reseteamos el contador de cortes seguidos.
  if (!cortadoPorCircuito) {
    await resetearCortesSeguidos(supabase)
  }

  return { pendientesRestantes: pendientes, enriquecidas, cortadoPorCircuito, tipoPausa }
}

async function dispararNotificaciones(supabaseUrl: string, loteId: string, supabase: any) {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/enviar-notificaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    await supabase
      .from('lotes_enriquecimiento')
      .update({ notificacion_enviada: resp.ok })
      .eq('id', loteId)
    if (!resp.ok) {
      console.error('enviar-notificaciones respondió con error:', resp.status)
    }
  } catch (err) {
    console.error('No se pudo llamar a enviar-notificaciones:', err)
  }
}

Deno.serve(async (req) => {
  const inicioMs = Date.now()
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

    const url = new URL(req.url)
    const accion = url.searchParams.get('accion') ?? 'ingestar'

    let cantidadInsertadas = 0
    let lote: { id: string; codigos_pendientes: CodigoPendiente[] } | null = null

    if (accion === 'continuar') {
      const { data: lotesSinAvisar } = await supabase
        .from('lotes_enriquecimiento')
        .select('id')
        .eq('completado', true)
        .eq('notificacion_enviada', false)

      for (const l of lotesSinAvisar ?? []) {
        await dispararNotificaciones(supabaseUrl, l.id as string, supabase)
      }

      const { data: loteAbierto, error: errorLote } = await supabase
        .from('lotes_enriquecimiento')
        .select('id, codigos_pendientes')
        .eq('completado', false)
        .order('creado_en', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (errorLote) throw errorLote

      if (!loteAbierto) {
        return new Response(
          JSON.stringify({ ok: true, mensaje: 'No hay lotes de enriquecimiento pendientes.' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }

      lote = loteAbierto as any
    } else {
      const partesFecha = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santiago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
      }).formatToParts(new Date())

      const dia = partesFecha.find((p) => p.type === 'day')!.value
      const mes = partesFecha.find((p) => p.type === 'month')!.value
      const anio = partesFecha.find((p) => p.type === 'year')!.value
      const horaChile = parseInt(partesFecha.find((p) => p.type === 'hour')!.value, 10)
      fecha = `${dia}${mes}${anio}`
      const corrida = horaChile < 12 ? 'manana' : 'tarde'

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

      if (filasBase.length > 0) {
        const { error } = await supabase.from('licitaciones').upsert(filasBase, { onConflict: 'codigo' })
        if (error) throw error
        cantidadInsertadas = filasBase.length
      }

      const codigosDeHoy = filasBase.map((f) => f.codigo)
      let pendientesIniciales: CodigoPendiente[] = []

      if (codigosDeHoy.length > 0) {
        const { data: pendientesData, error: errorPendientes } = await supabase
          .from('licitaciones')
          .select('codigo, nombre')
          .in('codigo', codigosDeHoy)
          .is('organismo', null)

        if (errorPendientes) throw errorPendientes
        pendientesIniciales = (pendientesData ?? []) as CodigoPendiente[]
      }

      const { data: nuevoLote, error: errorNuevoLote } = await supabase
        .from('lotes_enriquecimiento')
        .insert({
          fecha: `${anio}-${mes}-${dia}`,
          corrida,
          codigos_pendientes: pendientesIniciales,
          total_codigos: pendientesIniciales.length,
        })
        .select('id, codigos_pendientes')
        .single()

      if (errorNuevoLote) throw errorNuevoLote
      lote = nuevoLote as any
    }

    let cantidadEnriquecidas = 0
    let loteCompletado = false
    let cortadoPorCircuito = false
    let tipoPausa: 'corta' | 'larga' | undefined

    if (lote) {
      const enPausa = await pausaActiva(supabase)

      if (enPausa) {
        console.log('Pausa activa por corte(s) reciente(s) — se omite el enriquecimiento esta vez.')
        cortadoPorCircuito = true
      } else {
        const resultado = await procesarLote(supabase, lote, ticket, inicioMs)
        cantidadEnriquecidas = resultado.enriquecidas
        loteCompletado = resultado.pendientesRestantes.length === 0
        cortadoPorCircuito = resultado.cortadoPorCircuito
        tipoPausa = resultado.tipoPausa

        if (loteCompletado) {
          await supabase
            .from('lotes_enriquecimiento')
            .update({ completado: true, completado_en: new Date().toISOString() })
            .eq('id', lote.id)

          await dispararNotificaciones(supabaseUrl, lote.id, supabase)
        }
      }
    }

    const { error: logError } = await supabase.from('logs_ingesta').insert({
      ok: true,
      fecha_consultada: fecha,
      cantidad_insertadas: cantidadInsertadas,
      cantidad_enriquecidas: cantidadEnriquecidas,
      mensaje_error: cortadoPorCircuito
        ? `CORTACIRCUITO${tipoPausa ? ` (${tipoPausa})` : ''}: revisar logs de la función`
        : null,
    })
    if (logError) console.error('Error al insertar en logs_ingesta:', logError)

    return new Response(
      JSON.stringify({
        ok: true,
        accion,
        fecha,
        insertadas: cantidadInsertadas,
        enriquecidas: cantidadEnriquecidas,
        loteId: lote?.id ?? null,
        loteCompletado,
        cortadoPorCircuito,
        tipoPausa: tipoPausa ?? null,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const mensajeError =
      err instanceof Error ? err.message : (err as any)?.message ?? JSON.stringify(err)

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