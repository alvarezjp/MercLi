import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Ubicación en el proyecto: supabase/functions/avisar-trial-por-vencer/index.ts
//
// Busca usuarios en trial cuyo trial_fin cae dentro de los próximos 2 días,
// que todavía no recibieron el aviso, y les manda un correo. Marca
// aviso_trial_enviado = true para no volver a mandarlo.

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

async function enviarEmail(apiKey: string, from: string, to: string, html: string, asunto: string) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject: asunto, html }),
  })

  if (!resp.ok) {
    const detalle = await resp.text()
    throw new Error(`Resend respondió ${resp.status}: ${detalle}`)
  }
}

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = obtenerServiceRoleKey()
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const resendFrom = Deno.env.get('RESEND_FROM_EMAIL') ?? 'onboarding@resend.dev'
  const appUrl = Deno.env.get('APP_URL') ?? 'https://tu-app.vercel.app'

  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Faltan credenciales (Supabase o Resend)' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const enDosDias = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()

  const { data: usuarios, error } = await supabase
    .from('perfiles')
    .select('id, email, trial_fin')
    .eq('plan', 'trial')
    .eq('activo', true)
    .eq('aviso_trial_enviado', false)
    .gt('trial_fin', new Date().toISOString()) // que no haya vencido ya
    .lte('trial_fin', enDosDias) // que venza dentro de los próximos 2 días

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let enviados = 0
  const errores: string[] = []

  for (const usuario of usuarios ?? []) {
    if (!usuario.email) continue

    try {
      const fechaFin = new Date(usuario.trial_fin).toLocaleDateString('es-CL', {
        day: 'numeric',
        month: 'long',
      })

      const html = `
        <div style="font-family: sans-serif;">
          <h2>Tu prueba gratuita está por terminar</h2>
          <p>Tu período de prueba finaliza el <strong>${fechaFin}</strong>.</p>
          <p>Si quieres seguir usando la plataforma sin interrupciones, contáctanos para activar tu plan.</p>
          <p><a href="${appUrl}">Ir a la plataforma →</a></p>
        </div>`

      await enviarEmail(
        resendApiKey,
        resendFrom,
        usuario.email,
        html,
        'Tu prueba gratuita está por terminar'
      )

      await supabase.from('perfiles').update({ aviso_trial_enviado: true }).eq('id', usuario.id)

      enviados++
    } catch (err) {
      errores.push(`${usuario.email}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return new Response(
    JSON.stringify({ ok: errores.length === 0, enviados, errores }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})