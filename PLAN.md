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
- [x] Cliente HTTP hacia `api.mercadopublico.cl` (Edge Function) usando el ticket real
- [x] Guardar/actualizar licitaciones del día en la tabla `licitaciones` (upsert por `codigo`)
- [x] Configurar `pg_cron` para ejecutar esta función una vez al día
- [x] Manejo de errores/reintento si la API falla ese día

**Criterio de aceptación:** al día siguiente de desplegado, la tabla `licitaciones` tiene registros nuevos sin intervención manual.

### Etapa 3 — Búsqueda y filtrado por palabra clave
- [x] Tabla/UI para que el usuario agregue y elimine palabras clave
- [x] Query de filtrado (ILIKE o Full Text Search de Postgres sobre `nombre`/`raw_json`)
- [x] Lista de licitaciones en el frontend, filtrada por las keywords activas del usuario

**Criterio de aceptación:** usuario agrega una keyword y ve solo licitaciones que la contienen, sin recargar toda la base.

### Etapa 4 — Guía visual de estado (vista/postulada)
- [x] Tabla `licitacion_usuario_estado` conectada a la UI
- [x] Botones/acciones "marcar como vista" y "marcar como postulada"
- [x] Indicador visual (color/badge) por licitación según su estado
- [x] Vista de detalle en pestaña nueva con botón directo a Mercado Público, que marca automáticamente como "vista" al abrirse (agregado durante la implementación, no estaba en el plan original)

**Criterio de aceptación:** el estado persiste al recargar la página y al volver a loguearse.

### Etapa 5 — Notificaciones
- [x] Integración Resend para email
- [ ] Integración Twilio WhatsApp Sandbox para demo — PAUSADO, ver registro de avance: se migró el intento a Meta WhatsApp Cloud API por bloqueo de fondos en Twilio, pero se decidió posponer WhatsApp completamente para priorizar la demo con el cliente. Email cubre la funcionalidad central por ahora.
- [x] Lógica en el cron diario: comparar licitaciones nuevas del día contra keywords activas, y contra `notificaciones_enviadas` para no repetir
- [x] Enviar notificación por email cuando corresponda, y registrar en `notificaciones_enviadas` (WhatsApp pendiente, ver arriba)

**Criterio de aceptación:** al aparecer una licitación nueva que calza con una keyword, el usuario recibe correo y WhatsApp el mismo día, una sola vez.

### Etapa 6 — UX de trial y aviso previo
- [x] Aviso visual en la UI de "te quedan X días de prueba" (ya estaba implementado desde la Etapa 1, Paso 6)
- [x] Notificación automática (usando el mismo cron) 2 días antes de que expire el trial

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

### [2026-08-17] — Agente/sesión: Claude (Etapa 2 completada)
- Etapa en la que se trabajó: Etapa 2 — Ingesta diaria de licitaciones.
- Qué se completó: Tabla `licitaciones` con RLS + GRANT explícito, Edge Function `ingesta-diaria` (supabase/functions/ingesta-diaria/index.ts) que descarga el listado diario de la API de Mercado Público y hace upsert por código, desplegada con --no-verify-jwt. Cron diario configurado con pg_cron + pg_net (job "ingesta-diaria-licitaciones", 03:00 UTC). Tabla `logs_ingesta` que registra cada ejecución (éxito con/sin resultados, o fallo con mensaje de error).
- Qué quedó pendiente / a medias: Nada de la Etapa 2. Lista para empezar Etapa 3.
- Decisiones tomadas que no estaban en el plan original:
  1. Se agregó la tabla `logs_ingesta` (no estaba en el modelo de datos original de la sección 3 del plan) para poder diagnosticar fallas de la ingesta diaria sin depender solo de los logs de Supabase.
  2. Se confirmó que el sistema de llaves de Supabase está migrando de anon/service_role a publishable/secret (SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS); la Edge Function soporta ambos sistemas con fallback automático.
  3. Se confirmó vía prueba real que el endpoint de listado diario de la API de Mercado Público NO incluye organismo comprador ni monto estimado, y que el estado viene como código numérico (CodigoEstado), no como texto. Pendiente para Etapa 3/4: decidir si se traduce CodigoEstado a texto legible y si vale la pena llamar al endpoint de detalle por licitación para obtener organismo/monto (actualmente quedan null en la tabla).
  4. Lección repetida de la Etapa 1: `service_role` tampoco tiene GRANT automático en tablas creadas por SQL Editor en este proyecto — hay que otorgarlo explícitamente en cada tabla nueva que una Edge Function necesite escribir (GRANT INSERT/SELECT/UPDATE según corresponda a service_role), no solo a `authenticated`.
  5. El CLI de Supabase no soporta `npm install -g supabase` (deprecado) ni el subcomando `invoke` en la versión actual — se usa `npx supabase` instalado como devDependency, y se prueban las funciones con `curl` directo a la URL en vez de `supabase functions invoke`.
- Bloqueos o cosas que el humano debe resolver: Ninguno.
- Próximo paso sugerido: comenzar Etapa 3 (búsqueda y filtrado por palabra clave). Considerar primero si se resuelve el punto 3 (organismo/estado legible) antes o durante esa etapa, ya que afecta directamente lo que el usuario va a ver en pantalla.
### [2026-08-21] — Agente/sesión: Claude (Etapa 2 — enriquecimiento de organismo/monto/estado)
- Etapa en la que se trabajó: Etapa 2 (extensión posterior al cierre inicial).
- Qué se completó: Se agregó un "Paso B" a la Edge Function ingesta-diaria que enriquece hasta 150 licitaciones por ejecución (las que tengan organismo = null, ya sean nuevas del día o backlog de días anteriores) llamando al endpoint de detalle de la API (?codigo=...&ticket=...) en tandas de 5 simultáneas. Se agregaron las columnas licitaciones.raw_json_detalle (jsonb) y logs_ingesta.cantidad_enriquecidas (integer).
- Qué quedó pendiente / a medias: El backlog inicial de ~1.249 licitaciones se enriquece a razón de 150 por ejecución diaria — tomará varios días en ponerse al día por completo. No es necesario intervenir, se resuelve solo con el cron diario ya configurado.
- Decisiones tomadas que no estaban en el plan original:
  1. Se confirmaron los nombres de campo exactos del endpoint de detalle contra la documentación oficial (PDF "Diccionario de Datos - Licitaciones"): Comprador.NombreOrganismo, MontoEstimado, Estado (texto). El endpoint de listado diario NO trae estos campos, solo CodigoExterno, Nombre, FechaCierre y CodigoEstado (numérico).
  2. Se descubrieron y corrigieron 3 bugs reales durante las pruebas: (a) GRANT faltante para service_role en la tabla licitaciones — mismo patrón que perfiles y logs_ingesta, ahora la regla es otorgar GRANT a service_role en toda tabla nueva desde el primer bloque SQL; (b) el listado diario de la API puede traer códigos de licitación duplicados, lo que rompía el upsert (error "ON CONFLICT DO UPDATE command cannot affect row a second time") — se deduplcia por código antes de guardar; (c) Postgres exige que las columnas NOT NULL (nombre) tengan valor en la fila candidata de un upsert aunque la operación termine siendo un UPDATE — se soluciona reenviando el valor existente de esa columna en vez de omitirlo.
  3. Se mejoró el manejo de errores de la función: ahora extrae correctamente el mensaje de errores que no son instancias de Error de JavaScript (como los errores de Postgres/Supabase), que antes se perdían como "[object Object]".
- Bloqueos o cosas que el humano debe resolver: Ninguno.
- Próximo paso sugerido: comenzar Etapa 3 (búsqueda y filtrado por palabra clave). Ya no hay pendiente de organismo/estado — se puede filtrar y mostrar con datos completos desde el principio.
### [2026-08-21] — Agente/sesión: Claude (Etapa 3 completada)
- Etapa en la que se trabajó: Etapa 3 — Búsqueda y filtrado por palabra clave.
- Qué se completó: Tabla keywords_usuario con RLS (exige trial_vigente para select/insert, no para update/delete) y GRANT a authenticated desde el inicio. Página app/keywords/page.tsx para agregar/eliminar keywords (eliminar hace delete real, no soft-delete, aunque la columna `activo` queda disponible para uso futuro). Función SQL public.buscar_licitaciones_por_keywords(p_user_id uuid) que hace el join entre licitaciones y keywords_usuario con ILIKE, SIN security definer (para heredar RLS automáticamente). app/page.tsx actualizado: reemplaza el placeholder de la Etapa 1 con la lista real de licitaciones vía supabase.rpc(...), mostrando nombre, organismo, estado y monto.
- Qué quedó pendiente / a medias:
  1. PENDIENTE TÉCNICO IMPORTANTE — Migrar de ILIKE a Full Text Search de Postgres. Ahora mismo el filtrado usa `l.nombre ilike '%' || k.palabra_clave || '%'`, que es simple pero tiene limitaciones conocidas: no maneja variaciones de tilde/acento de forma inteligente (ej. "informatica" no calza con "informática" salvo coincidencia exacta de caracteres), no ordena por relevancia, y con muchas keywords o una tabla `licitaciones` grande puede volverse lento porque ILIKE con comodín al inicio (`%palabra%`) no puede usar un índice B-tree normal.
     Cuando se aborde esto, el cambio sugerido es:
     a) Agregar una columna generada `nombre_busqueda tsvector` a `licitaciones` (generada a partir de `nombre`, con `to_tsvector('spanish', nombre)` para que maneje acentos/plurales correctamente en español).
     b) Crear un índice GIN sobre esa columna: `create index licitaciones_busqueda_idx on licitaciones using gin(nombre_busqueda);`.
     c) Reemplazar la condición del JOIN en `buscar_licitaciones_por_keywords` por `l.nombre_busqueda @@ plainto_tsquery('spanish', k.palabra_clave)`.
     d) Esta misma función se reutiliza en la Etapa 5 para las notificaciones — el cambio se hace en un solo lugar y beneficia a ambas partes automáticamente.
     No es urgente para el volumen actual del MVP (1 usuario, ~1.249 licitaciones/día), pero si se agregan más usuarios o el filtrado se siente lento, esta es la primera optimización a aplicar.
  2. No se agregó todavía ningún link de navegación permanente entre "/" y "/keywords" más allá del texto plano ya incluido — suficiente para el MVP, se puede mejorar con un header/nav real en una iteración de pulido visual (podría ser parte de la Etapa 7).
- Decisiones tomadas que no estaban en el plan original: Ninguna decisión nueva de arquitectura; se aplicó la lección de GRANT explícito desde el inicio, sin incidentes esta vez.
- Bloqueos o cosas que el humano debe resolver: Ninguno.
- Próximo paso sugerido: comenzar Etapa 4 (guía visual de estado: nueva/vista/postulada).
### [2026-08-21] — Agente/sesión: Claude (Etapa 4 completada)
- Etapa en la que se trabajó: Etapa 4 — Guía visual de estado (vista/postulada), incluyendo una extensión pedida durante la implementación.
- Qué se completó:
  1. Tabla licitacion_usuario_estado con primary key compuesta (user_id, codigo_licitacion) — decisión que se aparta del modelo de datos original de la sección 3 del plan (que tenía un `id` propio): se usó PK compuesta para que el upsert por (user_id, codigo) sea directo sin necesitar un select previo. Solo existen los valores 'vista' y 'postulada' en la tabla; 'nueva' es la ausencia de fila (se resuelve con COALESCE en la consulta), para no escribir una fila por cada licitación que el usuario nunca ha tocado.
  2. Función buscar_licitaciones_por_keywords recreada (drop + create, no se puede cambiar el tipo de retorno con OR REPLACE) para incluir estado_usuario vía LEFT JOIN con licitacion_usuario_estado.
  3. Componente components/ListaLicitaciones.tsx (Client Component) con badges de color por estado y botones para marcar vista/postulada, usando router.refresh() para mantener sincronizado con la base de datos real en vez de estado local optimista.
  4. Botón "Ver detalle en Mercado Público": abre la ficha real de la licitación en pestaña nueva y marca automáticamente como "vista" (solo si el estado actual es 'nueva', nunca retrocede desde 'postulada'). URL confirmada con prueba real del usuario: http://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion={codigo} — Mercado Público cifra este parámetro del lado del cliente (por eso la URL pública que ve un usuario muestra un token `qs=` distinto), pero acepta el código de licitación en texto plano como parámetro de entrada. No hay forma confirmada de generar el token cifrado nosotros mismos, así que se depende de este comportamiento del sitio de Mercado Público en vez de un link 100% "oficial" documentado.
- Qué quedó pendiente / a medias: Ninguno.
- Decisiones tomadas que no estaban en el plan original:
  1. Se agregó la función completa de "ver detalle + redirección a Mercado Público" — no estaba en el plan original de la sección 4 (Etapa 4), surgió como requerimiento durante la implementación.
  2. RIESGO A VIGILAR: la URL de redirección a Mercado Público (http://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=...) no está documentada oficialmente por ChileCompra — se descubrió por inspección manual del sitio y se confirmó con una prueba real. Si Mercado Público cambia su sitio en el futuro, este botón podría dejar de funcionar sin aviso. No hay forma de detectarlo automáticamente; si un usuario reporta que el botón ya no lleva a la ficha correcta, este es el primer lugar a revisar.
- Bloqueos o cosas que el humano debe resolver: Ninguno.
- Próximo paso sugerido: comenzar Etapa 5 (notificaciones por email y WhatsApp). Recordar que buscar_licitaciones_por_keywords (con su lógica de ILIKE, pendiente de migrar a Full Text Search) se reutiliza directamente para detectar coincidencias nuevas que notificar.
### [2026-08-30] — Agente/sesión: Claude (Etapa 5 — email completo, WhatsApp pausado)
- Etapa en la que se trabajó: Etapa 5 — Notificaciones.
- Qué se completó:
  1. Tabla notificaciones_enviadas con restricción unique (user_id, codigo_licitacion, canal) — permite upsert con ignoreDuplicates para evitar notificaciones duplicadas incluso si la función corre dos veces.
  2. Columna perfiles.telefono_whatsapp (agregada para uso futuro de WhatsApp, actualmente sin UI para que el usuario la configure — se setea manualmente por SQL).
  3. Función SQL buscar_notificaciones_pendientes() que cruza perfiles activos × keywords activas × licitaciones × qué ya se notificó por cada canal, sin necesitar security definer (la llama la Edge Function con service_role, que ya bypasea RLS por sí solo).
  4. Edge Function supabase/functions/enviar-notificaciones/index.ts: agrupa coincidencias por usuario (un correo por usuario, no uno por licitación), envía por Resend, registra en notificaciones_enviadas con upsert idempotente. Probado con éxito: 13 correos enviados correctamente en la primera prueba real.
  5. Cron diario "notificaciones-diarias" a las 03:30 UTC (30 min después de "ingesta-diaria-licitaciones" a las 03:00 UTC, para darle margen a que la ingesta termine antes de buscar coincidencias nuevas).
  6. Secret APP_URL configurado con la URL real de Vercel, usada en el link de los correos.
- Qué quedó pendiente / a medias:
  1. WHATSAPP PAUSADO POR DECISIÓN DE NEGOCIO, no por bloqueo técnico sin salida. Historial completo para quien retome esto:
     - Se intentó con Twilio WhatsApp Sandbox: las credenciales tuvieron 2 rondas de errores (Account SID/Auth Token mal copiados), y luego se descubrió que Twilio exige usar Content Templates (no texto libre) para mensajes "business-initiated" como los nuestros — esto no es negociable, es política de WhatsApp a través de Twilio.
     - Al intentar crear la plantilla en Twilio, la cuenta trial bloqueó el Content Template Builder pidiendo agregar fondos (~$20 USD mínimo) para desbloquearlo.
     - Se evaluó migrar a Meta WhatsApp Cloud API directamente (el camino de producción que ya estaba planeado desde el inicio) — permite crear y probar plantillas gratis con hasta 5 números de prueba, sin bloqueo de fondos. Se llegó a crear la cuenta de desarrollador y la App en Meta for Developers (Paso 1 de la guía de migración), pero se decidió PAUSAR ahí mismo para priorizar tener una demo lista pronto — el email ya demuestra la funcionalidad central de notificaciones automáticas.
  2. El código de enviar-notificaciones/index.ts YA fue modificado para usar ContentSid/ContentVariables de Twilio (no texto libre) — si se retoma WhatsApp vía Meta en vez de Twilio, ese bloque de código de envío hay que reescribirlo para usar la Graph API de Meta (POST a graph.facebook.com/v20.0/{phone-number-id}/messages con components de tipo template), no el formato de Twilio. Son APIs distintas, no es un simple cambio de credenciales.
  3. La columna perfiles.telefono_whatsapp no tiene UI — cuando se retome WhatsApp, hay que agregar un campo en alguna pantalla de configuración de perfil para que el usuario lo ingrese él mismo, en vez de configurarlo manualmente por SQL.
- Decisiones tomadas que no estaban en el plan original:
  1. Notificación agrupada por usuario (un correo con todas las coincidencias del día), no una notificación por licitación — decisión de UX no especificada en el plan original.
  2. Se identificó que WhatsApp para negocio (mensajes iniciados por nosotros, no respuestas del usuario) requiere plantillas pre-aprobadas por política de WhatsApp — esto aplica sin importar el proveedor (Twilio o Meta directamente), no es una limitación específica de Twilio.
- Bloqueos o cosas que el humano debe resolver: Ninguno urgente. Cuando se quiera retomar WhatsApp: decidir entre completar la migración a Meta (Pasos 2-8 de la guía, ya iniciada) o volver a Twilio agregando fondos.
- Próximo paso sugerido: comenzar Etapa 6 (UX de trial y aviso previo) o Etapa 7 (pulido y demo), dado que el flujo de notificaciones central (email) ya está funcionando de punta a punta.
### [2026-08-30] — Agente/sesión: Claude (Etapa 6 completada)
- Etapa en la que se trabajó: Etapa 6 — UX de trial y aviso previo.
- Qué se completó: Columna perfiles.aviso_trial_enviado (booleano, no timestamp, porque este aviso se manda una sola vez por usuario). Edge Function supabase/functions/avisar-trial-por-vencer/index.ts que busca usuarios en trial con trial_fin dentro de los próximos 2 días y aviso_trial_enviado = false, les manda un correo vía Resend, y marca el booleano. Cron "aviso-trial-diario" a las 12:00 UTC (horario independiente de los otros dos jobs, sin dependencia entre ellos). El aviso visual en pantalla ya existía desde la Etapa 1.
- Qué quedó pendiente / a medias: Ninguno.
- Decisiones tomadas que no estaban en el plan original: Ninguna relevante.
- Bloqueos o cosas que el humano debe resolver: Ninguno.
- Próximo paso sugerido: Etapa 7 (pulido y demo) — es la última etapa del MVP original. Antes de la demo, revisar especialmente: (1) cargar datos de al menos 1-2 semanas para que no se vea vacío, (2) decidir si se resuelve el pendiente de Full Text Search de la Etapa 3, (3) decidir si se retoma WhatsApp (Meta, Paso 1 ya iniciado) antes o después de mostrarle al cliente.