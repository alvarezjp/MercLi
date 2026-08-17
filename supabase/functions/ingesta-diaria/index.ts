import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Ubicación en el proyecto: supabase/functions/ingesta-diaria/index.ts
//
// Por ahora la ejecutamos manualmente (Paso 3). En el Paso 4 la conectamos
// a un cron diario con pg_cron + pg_net.
//
// Variables de entorno que usa:
// - SUPABASE_URL: la inyecta Supabase automáticamente en toda Edge Function.
// - La llave con privilegios de servidor (bypasea RLS): Supabase la expone de
//   dos formas según la versión del proyecto. Los proyectos nuevos usan
//   SUPABASE_SECRET_KEYS (un JSON con varias llaves con nombre); los proyectos
//   más antiguos usan SUPABASE_SERVICE_ROLE_KEY (un string plano). Probamos
//   ambos para que funcione sin importar cuál tenga tu proyecto.
// - MERCADOPUBLICO_TICKET: hay que configurarla como secret (se hace en el Paso 3).

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

    // La API de Mercado Público espera la fecha en formato DDMMYYYY,
    // calculada en horario de Chile (no en UTC, para evitar desfases
    // cerca de la medianoche).
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

    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?fecha=${fecha}&ticket=${ticket}`
    const resp = await fetch(url)

    if (!resp.ok) {
      throw new Error(`La API de Mercado Público respondió con status ${resp.status}`)
    }

    const data = await resp.json()
    const listado: any[] = data?.Listado ?? []

    const filas = listado
      .map((item) => ({
        codigo: item.CodigoExterno,
        nombre: item.Nombre,
        organismo: item.Organismo?.NombreOrganismo ?? item.NombreOrganismo ?? null,
        fecha_publicacion: `${anio}-${mes}-${dia}`,
        fecha_cierre: item.FechaCierre ?? null,
        estado: item.Estado ?? item.CodigoEstado ?? null,
        // La API de listado diario no trae el monto estimado; se puede sumar
        // en una iteración futura llamando al endpoint de detalle por código.
        monto_estimado: null,
        raw_json: item,
        actualizado_en: new Date().toISOString(),
      }))
      .filter((fila) => fila.codigo && fila.nombre)

    if (filas.length === 0) {
      const { error: logError } = await supabase.from('logs_ingesta').insert({
        ok: true,
        fecha_consultada: fecha,
        cantidad_insertadas: 0,
        mensaje_error: null,
      })
      if (logError) console.error('Error al insertar en logs_ingesta:', logError)

      return new Response(
        JSON.stringify({ ok: true, mensaje: 'No hubo licitaciones para hoy', fecha, insertadas: 0 }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { error } = await supabase.from('licitaciones').upsert(filas, { onConflict: 'codigo' })

    if (error) throw error

    const { error: logError } = await supabase.from('logs_ingesta').insert({
      ok: true,
      fecha_consultada: fecha,
      cantidad_insertadas: filas.length,
      mensaje_error: null,
    })
    if (logError) console.error('Error al insertar en logs_ingesta:', logError)

    return new Response(
      JSON.stringify({ ok: true, fecha, insertadas: filas.length }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const mensajeError = err instanceof Error ? err.message : String(err)

    // Intentamos registrar el fallo. Si supabase nunca llegó a inicializarse
    // (por ejemplo, faltaban las credenciales), no hay dónde loguearlo — en
    // ese caso el error solo queda en la respuesta HTTP y en los logs de
    // Supabase (Dashboard > Edge Functions > Logs).
    if (supabase) {
      await supabase.from('logs_ingesta').insert({
        ok: false,
        fecha_consultada: fecha,
        cantidad_insertadas: 0,
        mensaje_error: mensajeError,
      })
    }

    return new Response(
      JSON.stringify({ ok: false, error: mensajeError }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})