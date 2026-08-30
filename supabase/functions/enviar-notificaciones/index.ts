import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Ubicación en el proyecto: supabase/functions/enviar-notificaciones/index.ts
//
// Agrupa las coincidencias pendientes por usuario y manda UN correo y UN
// WhatsApp por usuario (no uno por licitación), para no saturar al usuario
// con mensajes separados si hay varias coincidencias el mismo día.

function obtenerServiceRoleKey(): string | undefined {
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretKeysRaw) {
    try {
      const secretKeys = JSON.parse(secretKeysRaw)
      if (secretKeys?.default) return secretKeys.default
    } catch {
      // seguimos al fallback
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
}

type Pendiente = {
  user_id: string
  email: string | null
  telefono_whatsapp: string | null
  codigo: string
  nombre: string
  organismo: string | null
  estado: string | null
  monto_estimado: number | null
  ya_notificado_email: boolean
  ya_notificado_whatsapp: boolean
}

function formatearMonto(monto: number | null) {
  if (!monto) return null
  return `$${Number(monto).toLocaleString('es-CL')}`
}

function construirHtmlEmail(licitaciones: Pendiente[], appUrl: string) {
  const items = licitaciones
    .map((l) => {
      const monto = formatearMonto(l.monto_estimado)
      return `
        <li style="margin-bottom: 16px;">
          <strong>${l.nombre}</strong><br/>
          ${l.organismo ?? 'Organismo no disponible'}<br/>
          Estado: ${l.estado ?? 'Sin información'}${monto ? ` · Monto estimado: ${monto}` : ''}<br/>
          Código: ${l.codigo}
        </li>`
    })
    .join('')

  return `
    <div style="font-family: sans-serif;">
      <h2>Nuevas licitaciones que podrían interesarte</h2>
      <p>Encontramos ${licitaciones.length} licitación(es) nueva(s) que calzan con tus palabras clave:</p>
      <ul>${items}</ul>
      <p><a href="${appUrl}">Ver todas en la plataforma →</a></p>
    </div>`
}

function construirTextoWhatsapp(licitaciones: Pendiente[], appUrl: string) {
  const primeras = licitaciones.slice(0, 3)
  const nombres = primeras.map((l) => `• ${l.nombre}`).join('\n')
  const restantes = licitaciones.length - primeras.length

  return (
    `Tienes ${licitaciones.length} licitación(es) nueva(s) que calzan con tus palabras clave:\n\n` +
    nombres +
    (restantes > 0 ? `\n...y ${restantes} más.` : '') +
    `\n\nVer todas: ${appUrl}`
  )
}

async function enviarEmail(apiKey: string, from: string, to: string, html: string) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Nuevas licitaciones que podrían interesarte',
      html,
    }),
  })

  if (!resp.ok) {
    const detalle = await resp.text()
    throw new Error(`Resend respondió ${resp.status}: ${detalle}`)
  }
}

async function enviarWhatsapp(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  texto: string
) {
  const credenciales = btoa(`${accountSid}:${authToken}`)
  const body = new URLSearchParams({
    From: from,
    To: `whatsapp:${to}`,
    Body: texto,
  })

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credenciales}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    }
  )

  if (!resp.ok) {
    const detalle = await resp.text()
    throw new Error(`Twilio respondió ${resp.status}: ${detalle}`)
  }
}

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = obtenerServiceRoleKey()
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const resendFrom = Deno.env.get('RESEND_FROM_EMAIL') ?? 'onboarding@resend.dev'
  const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const twilioFrom = Deno.env.get('TWILIO_WHATSAPP_FROM')
  const appUrl = Deno.env.get('APP_URL') ?? 'https://tu-app.vercel.app'

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Faltan credenciales de Supabase' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: pendientes, error } = await supabase.rpc('buscar_notificaciones_pendientes')

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const filas = (pendientes ?? []) as Pendiente[]

  // Agrupamos por usuario, separando qué le falta por email y qué por whatsapp
  const porUsuario = new Map<
    string,
    { email: string | null; telefono: string | null; faltanEmail: Pendiente[]; faltanWhatsapp: Pendiente[] }
  >()

  for (const fila of filas) {
    if (!porUsuario.has(fila.user_id)) {
      porUsuario.set(fila.user_id, {
        email: fila.email,
        telefono: fila.telefono_whatsapp,
        faltanEmail: [],
        faltanWhatsapp: [],
      })
    }
    const grupo = porUsuario.get(fila.user_id)!
    if (!fila.ya_notificado_email) grupo.faltanEmail.push(fila)
    if (!fila.ya_notificado_whatsapp) grupo.faltanWhatsapp.push(fila)
  }

  let emailsEnviados = 0
  let whatsappsEnviados = 0
  const errores: string[] = []

  for (const [userId, grupo] of porUsuario) {
    // --- Email ---
    if (grupo.faltanEmail.length > 0 && grupo.email && resendApiKey) {
      try {
        const html = construirHtmlEmail(grupo.faltanEmail, appUrl)
        await enviarEmail(resendApiKey, resendFrom, grupo.email, html)

        const registros = grupo.faltanEmail.map((l) => ({
          user_id: userId,
          codigo_licitacion: l.codigo,
          canal: 'email',
        }))
        await supabase
          .from('notificaciones_enviadas')
          .upsert(registros, { onConflict: 'user_id,codigo_licitacion,canal', ignoreDuplicates: true })

        emailsEnviados += grupo.faltanEmail.length
      } catch (err) {
        errores.push(`Email a ${grupo.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // --- WhatsApp ---
    if (
      grupo.faltanWhatsapp.length > 0 &&
      grupo.telefono &&
      twilioSid &&
      twilioToken &&
      twilioFrom
    ) {
      try {
        const texto = construirTextoWhatsapp(grupo.faltanWhatsapp, appUrl)
        await enviarWhatsapp(twilioSid, twilioToken, twilioFrom, grupo.telefono, texto)

        const registros = grupo.faltanWhatsapp.map((l) => ({
          user_id: userId,
          codigo_licitacion: l.codigo,
          canal: 'whatsapp',
        }))
        await supabase
          .from('notificaciones_enviadas')
          .upsert(registros, { onConflict: 'user_id,codigo_licitacion,canal', ignoreDuplicates: true })

        whatsappsEnviados += grupo.faltanWhatsapp.length
      } catch (err) {
        errores.push(
          `WhatsApp a ${grupo.telefono}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: errores.length === 0,
      usuariosProcesados: porUsuario.size,
      emailsEnviados,
      whatsappsEnviados,
      errores,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})