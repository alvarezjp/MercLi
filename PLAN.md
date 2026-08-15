# Plan de trabajo — Plataforma de seguimiento de licitaciones (Mercado Público Chile)

> **Instrucción para cualquier agente de IA (o Claude) que lea este documento:**
> Este es el documento maestro del proyecto. Antes de escribir una sola línea de código:
> 1. Lee completo este archivo, especialmente la sección **"Registro de avance"** al final — ahí está el estado real del proyecto, no asumas nada por el nombre de las etapas.
> 2. No cambies las decisiones de la sección 1 y 2 sin que el humano lo pida explícitamente. Ya fueron evaluadas y decididas.
> 3. Trabaja **una etapa a la vez**, en orden, salvo que el registro de avance diga lo contrario.
> 4. Antes de terminar tu sesión (por límite de tokens, o porque terminaste la etapa), **actualiza el Registro de avance** siguiendo el formato indicado, aunque el trabajo haya quedado a medias. Esto es obligatorio, no opcional.
> 5. Si encuentras un bloqueo (falta una credencial, una decisión de negocio, etc.), anótalo en el registro en vez de improvisar una solución que no se pidió.

---

## 1. Objetivo del proyecto

MVP de una plataforma personal (1 usuario inicialmente, pensada para escalar a multiusuario después) que permite:

1. Ver licitaciones públicas del Mercado Público de Chile filtradas por palabras clave definidas por el usuario.
2. Marcar visualmente cada licitación como "nueva / vista / postulada" (estado persistente por usuario).
3. Recibir notificaciones por correo y WhatsApp cuando aparecen licitaciones nuevas que calzan con las palabras clave.
4. Soportar un modo de **prueba gratuita con expiración** (trial de N días) para mostrar el producto a un cliente antes de vender el acceso completo.

No se está construyendo aún: multiusuario con roles, panel de administración, ni IA de matching semántico. Eso es fase futura (ver sección 6).

---

## 2. Decisiones técnicas (ya tomadas — no reabrir sin motivo)

| Componente | Decisión |
|---|---|
| Frontend | Next.js (React) desplegado en Vercel |
| Backend | Supabase Edge Functions (TypeScript/Deno) + API routes de Next.js donde sea más simple |
| Base de datos | PostgreSQL vía Supabase (incluye Auth y RLS) |
| Autenticación | Supabase Auth (email/password) |
| Control de trial | **No** vía expiración de sesión. Vía tabla `perfiles` + Row Level Security (RLS) que corta el acceso a los datos cuando `trial_fin < now()` |
| Cron / ingestión diaria | Supabase Cron Jobs (`pg_cron`) llamando a una Edge Function |
| Fuente de datos | API pública de Mercado Público (`api.mercadopublico.cl`) — requiere ticket gratuito personal, límite 10.000 requests/día. **No tiene endpoint de búsqueda por keyword**, por lo que hay que descargar licitaciones diarias y filtrar en nuestra propia base de datos |
| Email | Resend (capa gratuita) |
| WhatsApp | Twilio WhatsApp Sandbox para demo → migrar a Meta WhatsApp Cloud API para uso real con el cliente |
| Repositorio | Git (GitHub recomendado, para que cualquier agente con acceso al repo tenga el historial completo) |

**Por qué esta arquitectura (para que el agente no la cuestione sin razón):** RLS permite controlar acceso por trial/plan sin tocar la capa de autenticación, y es el mismo mecanismo que se reusará después para diferenciar plan gratuito vs. pago. Guardar las licitaciones en nuestra propia tabla es obligatorio porque la API no soporta búsqueda por palabra clave nativamente.

---

## 3. Modelo de datos (referencia rápida)

```
perfiles
  id (uuid, FK a auth.users, PK)
  plan (text, default 'trial')
  trial_inicio (timestamptz)
  trial_fin (timestamptz)
  activo (boolean)

licitaciones
  codigo (text, PK)
  nombre (text)
  organismo (text)
  fecha_publicacion (date)
  fecha_cierre (date)
  estado (text)
  monto_estimado (numeric, nullable)
  raw_json (jsonb)  -- respuesta cruda de la API, por si se necesita después

keywords_usuario
  id (uuid, PK)
  user_id (uuid, FK a auth.users)
  palabra_clave (text)
  activo (boolean)

licitacion_usuario_estado
  id (uuid, PK)
  user_id (uuid, FK a auth.users)
  codigo_licitacion (text, FK a licitaciones)
  estado (text)  -- 'nueva' | 'vista' | 'postulada'
  actualizado_en (timestamptz)

notificaciones_enviadas
  id (uuid, PK)
  user_id (uuid, FK a auth.users)
  codigo_licitacion (text)
  canal (text) -- 'email' | 'whatsapp'
  enviado_en (timestamptz)
```

`notificaciones_enviadas` existe para no notificar dos veces la misma licitación al mismo usuario — se agregó a este modelo aunque no se mencionó explícitamente antes, porque la Etapa 5 lo necesita.

---

## 4. Etapas del proyecto

Cada etapa tiene: objetivo, tareas, y **criterio de aceptación** (cómo saber que está realmente terminada, no solo "código escrito").

### Etapa 0 — Setup de infraestructura
- [x] Crear proyecto en Supabase, guardar URL y anon key
- [x] Crear proyecto Next.js, conectar a Vercel
- [x] Configurar variables de entorno (`.env.local` + Vercel envs): Supabase URL/key, ticket de Mercado Público, credenciales Resend, credenciales Twilio
- [x] Crear repositorio Git con `.gitignore` correcto (nunca subir `.env`)
- [x] Solicitar el **ticket real** de la API de Mercado Público (formulario oficial, con RUT y correo reales — el de prueba tiene datos limitados)

**Criterio de aceptación:** proyecto corre localmente (`npm run dev`) y hace un fetch de prueba exitoso a Supabase y a la API de Mercado Público.

### Etapa 1 — Autenticación y control de trial
- [x] Configurar Supabase Auth (email/password)
- [x] Crear tabla `perfiles` + trigger que la llena automáticamente al registrarse un usuario (`trial_fin = now() + 7 days` por defecto)
- [x] Crear políticas RLS en las tablas de datos que exijan `trial_fin > now()`
- [x] Pantalla de login/registro en el frontend
- [x] Pantalla de "prueba vencida" cuando RLS bloquea el acceso

**Criterio de aceptación:** un usuario nuevo se registra, ve un `trial_fin` correcto, y si se le fuerza manualmente una fecha pasada en la base de datos, deja de ver datos y le aparece la pantalla de trial vencido — sin tocar su sesión de Auth.

### Etapa 2 — Ingesta diaria de licitaciones
- [ ] Cliente HTTP hacia `api.mercadopublico.cl` (Edge Function) usando el ticket real
- [ ] Guardar/actualizar licitaciones del día en la tabla `licitaciones` (upsert por `codigo`)
- [ ] Configurar `pg_cron` para ejecutar esta función una vez al día
- [ ] Manejo de errores/reintento si la API falla ese día

**Criterio de aceptación:** al día siguiente de desplegado, la tabla `licitaciones` tiene registros nuevos sin intervención manual.

### Etapa 3 — Búsqueda y filtrado por palabra clave
- [ ] Tabla/UI para que el usuario agregue y elimine palabras clave
- [ ] Query de filtrado (ILIKE o Full Text Search de Postgres sobre `nombre`/`raw_json`)
- [ ] Lista de licitaciones en el frontend, filtrada por las keywords activas del usuario

**Criterio de aceptación:** usuario agrega una keyword y ve solo licitaciones que la contienen, sin recargar toda la base.

### Etapa 4 — Guía visual de estado (vista/postulada)
- [ ] Tabla `licitacion_usuario_estado` conectada a la UI
- [ ] Botones/acciones "marcar como vista" y "marcar como postulada"
- [ ] Indicador visual (color/badge) por licitación según su estado

**Criterio de aceptación:** el estado persiste al recargar la página y al volver a loguearse.

### Etapa 5 — Notificaciones
- [ ] Integración Resend para email
- [ ] Integración Twilio WhatsApp Sandbox para demo
- [ ] Lógica en el cron diario: comparar licitaciones nuevas del día contra keywords activas, y contra `notificaciones_enviadas` para no repetir
- [ ] Enviar notificación por email y WhatsApp cuando corresponda, y registrar en `notificaciones_enviadas`

**Criterio de aceptación:** al aparecer una licitación nueva que calza con una keyword, el usuario recibe correo y WhatsApp el mismo día, una sola vez.

### Etapa 6 — UX de trial y aviso previo
- [ ] Aviso visual en la UI de "te quedan X días de prueba"
- [ ] Notificación automática (usando el mismo cron) 2 días antes de que expire el trial

**Criterio de aceptación:** un usuario con `trial_fin` en 2 días recibe un correo de aviso.

### Etapa 7 — Pulido y demo
- [ ] Cargar datos reales de al menos 1-2 semanas para que la demo no se vea vacía
- [ ] Revisar responsive/mobile básico
- [ ] Checklist de demo: login → trial visible → agregar keyword → ver licitaciones → marcar estado → simular notificación

**Criterio de aceptación:** se puede hacer la demo completa al cliente sin errores visibles.

---

## 5. Fuera de alcance del MVP (fase futura, no tocar ahora)

- Multiusuario con roles y permisos por organización
- Matching semántico / IA para sugerir licitaciones aunque no calce la keyword exacta
- Panel de administración
- Migración de Twilio Sandbox a Meta WhatsApp Cloud API en producción

---

## 6. Registro de avance

> Cada agente (o Claude en cada sesión) debe agregar una entrada nueva **al final de esta lista** antes de terminar. No borrar entradas anteriores.

**Formato de entrada:**
```
### [Fecha] — Agente/sesión: [nombre o modelo]
- Etapa en la que se trabajó:
- Qué se completó:
- Qué quedó pendiente / a medias:
- Decisiones tomadas que no estaban en el plan original:
- Bloqueos o cosas que el humano debe resolver:
- Próximo paso sugerido:
```

### [2026-08-12] — Agente/sesión: Claude (Etapa 0 completada)
- Etapa en la que se trabajó: Etapa 0 — Setup de infraestructura.
- Qué se completó: Proyecto Next.js + Supabase creado y conectado, deploy en Vercel funcionando, variables de entorno configuradas, endpoint /api/test-connection y página /test verificaron conexión exitosa tanto a Supabase como a la API de Mercado Público.
- Qué quedó pendiente / a medias: Nada de la Etapa 0. Lista para empezar Etapa 1.
- Decisiones tomadas que no estaban en el plan original: Ninguna.
- Bloqueos o cosas que el humano debe resolver: Ninguno.
- Próximo paso sugerido: comenzar Etapa 1 (autenticación y control de trial vía RLS).

### [2026-08-15] — Agente/sesión: Claude (Etapa 1 completada)
- Etapa en la que se trabajó: Etapa 1 — Autenticación y control de trial.
- Qué se completó: Tabla perfiles con trigger automático al registrarse, función trial_vigente() como patrón reutilizable para RLS futuro, páginas de login/registro/logout, callback de confirmación de correo, y pantalla condicional de "trial vencido" vs "bienvenido con días restantes" en app/page.tsx.
- Qué quedó pendiente / a medias: Nada de la Etapa 1. Lista para empezar Etapa 2.
- Decisiones tomadas que no estaban en el plan original:
  1. Se renombró middleware.ts a proxy.ts (Next.js 16 deprecó la convención "middleware" en favor de "proxy"; misma lógica, solo cambia el nombre del archivo y de la función exportada).
  2. Se otorgó explícitamente `GRANT SELECT, UPDATE ON perfiles TO authenticated` — al crear la tabla por SQL Editor (no por Table Editor visual), Supabase no otorga este permiso base automáticamente, y sin él las políticas RLS nunca llegan a evaluarse (error 42501 "permission denied").
  3. Se desactivó temporalmente "Confirm email" en Supabase Auth porque el servicio de correo gratuito por defecto tiene un límite muy bajo de envíos por hora. Se reactivará en la Etapa 5 al configurar Resend como proveedor de correo propio.
- Bloqueos o cosas que el humano debe resolver: Ninguno. Nota para más adelante: recordar reactivar "Confirm email" en Etapa 5.
- Próximo paso sugerido: comenzar Etapa 2 (ingesta diaria de licitaciones desde la API de Mercado Público).