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
- [x] Paso 1: revisar volumen de datos acumulados (hecho — se detectó y corrigió un problema real de cobertura de enriquecimiento, ver Etapa 8)
- [ ] Paso 2: ajustes responsive/mobile — PAUSADO, se interrumpió para atender la Etapa 8 (más urgente: calidad de los datos/búsqueda)
- [ ] Paso 3: checklist de demo — PAUSADO, mismo motivo

### Etapa 8 — Búsqueda avanzada y enriquecimiento profundo
- [x] Ampliar el enriquecimiento para capturar Descripción e Items/productos de cada licitación (no solo organismo/monto/estado)
- [x] Migrar el filtrado de ILIKE a Full Text Search de Postgres (soporta búsqueda multi-palabra y busca en nombre + descripción + productos)
- [x] Ranking de relevancia (ts_rank) + selector de orden (relevancia / más recientes) en el frontend
- [x] Mostrar fecha de publicación en la ficha de cada licitación
- [ ] Pendiente futuro: programar un enriquecimiento más agresivo/completo en horario de bajo tráfico (a definir cuándo)

### Etapa 9 — Enriquecimiento garantizado por llamada + aceleración de backlog
- [x] Cron dividido en dos corridas diarias en vez de una: 00:00 y 12:00 hora Chile (03:00 y 15:00 UTC en horario de verano)
- [x] Función SQL `codigos_sin_organismo(p_codigos text[])` — consulta puntual de qué códigos, entre una lista dada, aún no tienen organismo asignado
- [x] Edge Function `ingesta-diaria` rediseñada en dos pasos de enriquecimiento con objetivos distintos:
  - Paso B (GARANTIZADO, sin tope numérico): enriquece el 100% de los códigos que trajo el listado de ESA corrida específica, subiendo el resultado a la base por tandas (no espera al final), para no perder progreso si la función se corta por timeout
  - Paso C (BEST EFFORT, basado en tiempo real, no en cantidad): si sobra presupuesto de ejecución después del Paso B (medido en milisegundos, con margen de seguridad bajo el límite de 150s del plan gratuito), usa el resto para avanzar el backlog histórico viejo — nunca compite por cupo con el Paso B
  - `CONCURRENCIA` subida de 8 a 12 para compensar el volumen más alto por corrida (~625 códigos/corrida en vez de 400)
- [ ] Pendiente: desplegar en producción y validar con datos reales (correr el SQL de la función nueva, redeploy de la Edge Function con `--no-verify-jwt`, probar con curl, y revisar `logs_ingesta` durante al menos 2-3 días para confirmar que no aparecen timeouts con `CONCURRENCIA=12`)

**Criterio de aceptación:** revisando `logs_ingesta` en cualquier corrida, la cantidad enriquecida "de hoy" (Paso B) es igual a la cantidad insertada por el listado de esa misma corrida — es decir, ninguna licitación que entra en una llamada queda pendiente para la siguiente, sin depender de un número de tope adivinado.

**Riesgo conocido, no resuelto todavía:** si algún día entran muchas más licitaciones de lo habitual (ej. cierre de mes fiscal, actualmente ~1.249/día es lo normal), el Paso B podría no alcanzar a terminar dentro del límite de 150s del plan gratuito. Como sube por tandas, no se pierde lo ya procesado, pero esa corrida específica quedaría con el Paso B incompleto hasta que la retome la siguiente corrida programada. No hay forma de detectarlo automáticamente todavía más que revisando `logs_ingesta` manualmente.


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

### [2026-08-30] — Agente/sesión: Claude (Etapa 8 — búsqueda avanzada y enriquecimiento profundo)
- Etapa en la que se trabajó: Etapa 8 (nueva, insertada antes de terminar la Etapa 7 por prioridad del usuario — calidad de búsqueda y cobertura de datos eran más urgentes que el pulido visual).
- Qué se completó:
  1. Se confirmó vía diccionario oficial de la API (Documentación API Mercado Publico - Licitaciones.pdf) que el endpoint de detalle SÍ trae Descripcion (campo #8) e Items/Listado con NombreProducto y Descripcion por producto (campos #84-97) — no se necesitó ninguna fuente de datos no oficial. Se descartó explícitamente una alternativa de terceros ("Compras Transparentes API" de Zoohash SPA) por no ser oficial de ChileCompra y tener documentación sin actualizar desde ~2015 — riesgo de depender de una fuente no confiable o abandonada para la funcionalidad central del producto.
  2. Columnas nuevas en licitaciones: descripcion (text), productos_texto (text, concatenación de nombre+descripción de cada item separados por " | "), busqueda_vector (tsvector generado automáticamente con to_tsvector('spanish', nombre || descripcion || productos_texto), con índice GIN).
  3. Edge Function ingesta-diaria actualizada: obtenerDetalleLicitacion ahora también extrae Descripcion e Items.Listado.
  4. CAMBIO DE DISEÑO IMPORTANTE en el enriquecimiento (Paso B): se descartó la primera versión (codigos_pendientes_relevantes filtrando por coincidencia con keywords activas) porque dejaba sin enriquecer licitaciones viejas que no calzaban con keywords existentes al momento de la ingesta — si el usuario agregaba una keyword nueva después, esas licitaciones seguirían sin descripción/productos para siempre. Se cambió a un enfoque sin filtro de keywords, priorizando por fecha_publicacion desc, para que cualquier búsqueda futura tenga datos completos. Se subió MAX_ENRIQUECER de 150 a 400 y CONCURRENCIA de 5 a 8 para compensar el volumen mayor a cubrir.
  5. Funciones SQL buscar_licitaciones_por_keywords y buscar_notificaciones_pendientes migradas de `ilike '%...%'` a `busqueda_vector @@ plainto_tsquery('spanish', k.palabra_clave)` — resuelve búsqueda multi-palabra (ej. "mantención endoscopio") con manejo de plurales/conjugaciones en español. buscar_licitaciones_por_keywords ahora también devuelve fecha_publicacion y relevancia (ts_rank).
  6. Frontend: selector "Ordenar por: Relevancia / Más recientes" en app/page.tsx (ordena en JavaScript sobre los datos ya traídos, sin segunda consulta — volumen por usuario es chico). Fecha de publicación agregada a las tarjetas en components/ListaLicitaciones.tsx.
- Qué quedó pendiente / a medias:
  1. BACKLOG DE ENRIQUECIMIENTO: con ~1.249 licitaciones nuevas/día y 400 enriquecidas por ejecución, el sistema se pone al día con lo nuevo casi todos los días, pero el backlog histórico (~7.187 licitaciones al 30-08-2026, con la nueva lógica reiniciando el criterio de priorización) tomará aproximadamente 2-3 semanas en cubrirse por completo a este ritmo. Mientras tanto, búsquedas por descripción/productos en licitaciones antiguas pueden no encontrar coincidencias reales todavía.
  2. PENDIENTE EXPLÍCITO DEL USUARIO: programar un enriquecimiento más agresivo (posiblemente sin límite de 400, o corriendo más de una vez al día) en un horario de bajo tráfico, para acelerar la cobertura completa. El horario específico queda por definir — el usuario pidió explícitamente dejarlo para más adelante.
  3. La Etapa 7 (pulido y demo) quedó a medio camino — falta responsive/mobile y el checklist de demo.
- Decisiones tomadas que no estaban en el plan original: Ver puntos 1 y 4 de arriba (descartar API de terceros, y el cambio de criterio de priorización del enriquecimiento de "por keyword" a "por recencia").
- Bloqueos o cosas que el humano debe resolver: Ninguno urgente. Decidir cuándo y con qué frecuencia/límite correr el enriquecimiento agresivo pendiente (punto 2 de arriba).
- Próximo paso sugerido: retomar la Etapa 7 (Pasos 2 y 3: responsive y checklist de demo) para dejar el MVP listo para mostrar, o resolver primero el enriquecimiento agresivo si la cobertura de datos es más urgente que el pulido visual para la fecha en que se planea la demo.

### [2026-09-03] — Agente/sesión: Claude (Etapa 9 — diseño completo, despliegue pendiente)
- Etapa en la que se trabajó: Etapa 9 (nueva) — enriquecimiento garantizado por llamada + aceleración de backlog. Retoma el pendiente explícito de la Etapa 8 ("programar un enriquecimiento más agresivo en horario de bajo tráfico"), pero con un diseño distinto al que se había anticipado ahí.
- Qué se completó (a nivel de diseño y código, NO desplegado todavía):
  1. Cron duplicado: se agregó el job `ingesta-mediodia-licitaciones` (15:00 UTC) además del `ingesta-diaria-licitaciones` existente (03:00 UTC) — ambos corresponden a 00:00 y 12:00 hora Chile durante horario de verano (vigente desde el 6-sep-2026 por Decreto 98).
  2. Se descartó el enfoque de "solo tope numérico más alto" (subir MAX_ENRIQUECER a 500-600) porque no garantiza cobertura completa de lo que trae cada llamada — con ~1.249 licitaciones nuevas/día repartidas en 2 corridas (~625/corrida), cualquier tope fijo por debajo de eso deja licitaciones de esa misma llamada sin enriquecer.
  3. Se rediseñó la Edge Function `ingesta-diaria` en dos pasos con objetivos distintos: Paso B (garantizado, sin tope, específico a los códigos de esa corrida) y Paso C (backlog histórico, best-effort, limitado por tiempo real de ejecución en vez de por cantidad).
  4. Nueva función SQL `codigos_sin_organismo(p_codigos text[])`, complementaria a `codigos_pendientes_relevantes` (que se mantiene para el Paso C).
- Qué quedó pendiente / a medias:
  1. NADA DE ESTO ESTÁ DESPLEGADO TODAVÍA. Falta: correr el SQL de `codigos_sin_organismo` en el SQL Editor, reemplazar el contenido de `supabase/functions/ingesta-diaria/index.ts`, redesplegar con `npx supabase functions deploy ingesta-diaria --no-verify-jwt`, y probar manualmente con curl antes de dejar que lo tome el cron automático.
  2. `CONCURRENCIA=12` no está probado en producción — subido desde 8 de forma preventiva por el mayor volumen por corrida, pero hay que confirmar en `logs_ingesta` que no genera timeouts.
  3. No se validó todavía si el nombre del proyecto/comando de deploy usado aquí coincide exactamente con el de sesiones anteriores — se le pidió al usuario confirmarlo y no se ha recibido respuesta.
- Decisiones tomadas que no estaban en el plan original:
  1. Cambio de filosofía del enriquecimiento: de "tope fijo por corrida, sin distinguir origen" (Etapa 8) a "garantía completa de lo nuevo de esta llamada + backlog como mejor esfuerzo con el tiempo sobrante" (Etapa 9). Esto es una decisión explícita del usuario, motivada porque necesita que toda licitación mostrada al usuario final tenga datos completos para que la búsqueda por palabra clave funcione sin huecos.
  2. Se documentó formalmente (en el código, como comentario) el riesgo de que un día con volumen anormalmente alto de licitaciones nuevas podría dejar el Paso B incompleto dentro del límite de 150s del plan gratuito — no se resolvió, solo se dejó visible para monitoreo manual.
- Bloqueos o cosas que el humano debe resolver:
  1. Ejecutar el SQL nuevo y desplegar la Edge Function actualizada (ver arriba) — sin esto, el código nuevo no está corriendo, solo existe como diseño.
  2. Confirmar el comando/nombre de proyecto exacto para el deploy si difiere del usado en la Etapa 2.
- Próximo paso sugerido: desplegar lo diseñado en esta etapa y dejarlo corriendo al menos 2-3 días revisando `logs_ingesta` antes de dar la Etapa 9 por cerrada. Si en ese monitoreo `CONCURRENCIA=12` genera timeouts, bajarlo de vuelta a 8-10. Recién después de confirmar que el Paso B cubre el 100% de "lo de cada llamada" de forma sostenida, retomar el punto pendiente de la Etapa 7 (responsive/mobile y checklist de demo).