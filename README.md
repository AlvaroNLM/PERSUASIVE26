# Experimento de interpretación de IA

Aplicación estática en inglés para un estudio entre sujetos XAI / NO-XAI. HTML, CSS y JavaScript vanilla, sin dependencias ni build. El backend es una Supabase Edge Function con acceso privado a PostgreSQL. No se ha desplegado todavía: es necesario configurar un proyecto propio.

## Flujo actual (experimento 1.1.0)

```text
Consent
   ↓
Fictional case (alex_v1, solo lectura)
   ↓
Pre-AI judgement (1–7)
   ↓
Random assignment (50/50, persistida y registrada una sola vez)
   ↓
┌─────────────────────┬─────────────────────┐
│ NO-XAI              │ XAI                 │
│ AI assessment       │ AI assessment       │
│                     │ + explanation       │
└─────────────────────┴─────────────────────┘
   ↓
Post-AI judgement (1–7)
   ↓
Questionnaire (13 ítems obligatorios)
   ↓
Complete
```

Se mantienen exactamente dos condiciones. El texto, caso, clasificación y estructura base son iguales; la única manipulación es la presencia de la explicación. La condición no se etiqueta en la interfaz del participante.

El consentimiento es la primera pantalla y se renderiza sin red ni backend configurado. El texto institucional en `consent()` de `js/app.js` está marcado **PROVISIONAL CONSENT**: se deben completar institución, contacto, conservación y aprobación del protocolo antes de reclutar. No se presentan las hipótesis ni las condiciones en la interfaz.

Alex tiene valores fijos: atención 3, distractibilidad 4, impulsividad 2, cambios 1, comunicación social 1 y conductas repetitivas 0. El caso es exclusivamente de lectura; no hay controles para editarlo. `case_version = "alex_v1"` identifica este estímulo y los seis valores se guardan para reproducibilidad.

Las escalas pre y post son idénticas: 1 = Much more consistent with ADHD-related characteristics; 4 = Unsure / equally consistent; 7 = Much more consistent with ASD-related characteristics. Ambas exigen enteros de 1 a 7. El post no muestra la respuesta previa. Al enviar el pre, la función SQL `lock_experiment_pre` fija el juicio y la condición atómicamente **antes** de que se renderice la IA. Una segunda llamada devuelve los valores originales. Un trigger impide cambiarlos. La restauración consulta al servidor para que una recarga o una pestaña antigua no desbloqueen el juicio previo.

La regla provisional suma los tres primeros factores (9) y los tres últimos (2). El grupo con mayor suma determina la clasificación; los empates devuelven `INCONCLUSIVE`. `classifyProfile(features)` y `explainClassification(features, classification)` comparten las reglas y rechazan clasificaciones incoherentes. La explicación ordena los tres factores del grupo ganador por contribución real, con peso unitario.

**PROVISIONAL EXPERIMENTAL CLASSIFIER — NOT CLINICALLY VALIDATED.** Este clasificador no tiene validez diagnóstica ADHD/ASD. Permanece aislado en `supabase/functions/_shared/classifier.js`, reexportado desde `js/classifier.js`, para sustituirlo posteriormente por un modelo/regla revisado de BALIDA-AA. El frontend y el backend utilizan el mismo módulo; `.nojekyll` conserva `_shared` en Pages. La versión del clasificador sigue siendo `1.0.0` porque la regla no ha cambiado; el protocolo nuevo usa `experiment_version = "1.1.0"`.

Los UUID v4 se crean después de aceptar, y los borradores se conservan en `localStorage`. La asignación se genera después del juicio inicial mediante `Math.random() < 0.5` y se persiste antes de la petición. Los reintentos conservan la sesión. Se guarda la explicación calculada en ambas condiciones para reproducibilidad, aunque solo se muestra en XAI.

## Research questions

- **RQ1.** Does providing an XAI explanation increase users' acceptance of an AI-generated ADHD/ASD-related assessment?
- **RQ2.** How does providing an XAI explanation affect users' trust in and perceived transparency of an AI-generated ADHD/ASD-related assessment?
- **RQ3.** Does providing an XAI explanation affect users' perceived autonomy and perceived manipulation when evaluating an AI-generated ADHD/ASD-related assessment?
- **RQ4.** Does providing an XAI explanation produce a greater shift in users' own judgement toward the AI-generated assessment?

Acceptance/persuasion (A1–A4) es el **primary self-reported outcome**. Trust (T1–T2), transparency (TR1–TR2), responsible persuasion (RP1–RP3), usefulness (U1) y manipulation check (MC1) se conservan como ítems numéricos separados. Las agrupaciones de constructos se documentan aquí, sin rotular hipótesis de persuasión en la interfaz.

El pre/post permite medir cambio de juicio. Como la IA apunta al extremo 1, `pre_ai_judgement - post_ai_judgement` positivo representa un desplazamiento hacia su evaluación; cero representa ausencia de cambio. Debe preespecificarse el análisis, incluida la agregación de escalas, antes del estudio. **No se mide diagnóstico clínico ni comportamiento clínico.** El clasificador y el consentimiento son provisionales.

## Diagnóstico y corrección de la pantalla vacía

Se reprodujo en Chrome el problema exacto al abrir `index.html` mediante `file://`: CORS bloqueaba el módulo `js/app.js` desde el origen `null`. Como sus imports estáticos se evalúan antes del `try/catch`, la aplicación nunca inicializaba `main`. Por HTTP, tanto en `/` como en `/PERSUASIVE26/`, la versión anterior sí renderizaba la landing. No se ha confirmado la URL concreta que originó el reporte del usuario.

Además, el consentimiento anterior dependía de `api({action:'config'})` y la URL vacía impedía verlo. Ahora:

- `index.html` carga `js/bootstrap.js`, un script clásico que espera al DOM e importa la aplicación de forma controlada.
- `app.initialize()` renderiza el consentimiento inmediatamente, sin peticiones.
- Los fallos de módulos/configuración tienen diagnóstico visible, `console.error` y reintento. `file://` explica cómo abrir un servidor; no intenta eludir la seguridad de módulos del navegador.
- La configuración de privacidad se consulta al pulsar **I agree to participate**. Si falta backend, el consentimiento permanece y el error aparece allí. Si hay hash, se exige consentimiento adicional antes de iniciar.
- Los estados antiguos, incompletos o corruptos muestran una recuperación explícita. El botón elimina solo el borrador local y vuelve al consentimiento; no borra respuestas del servidor ni `experiment_completed`.

Esto corrige la inicialización real; el contenido experimental continúa renderizado por JavaScript, sin duplicarlo como contenido estático en HTML.

## 1. Crear Supabase

Crea un proyecto en el plan gratuito en [Supabase](https://supabase.com/dashboard). Guarda la contraseña de la base de datos fuera del repositorio. Anota el identificador del proyecto. Las cuotas y disponibilidad del plan dependen del proveedor.

## 2. Crear las tablas

Para una base **nueva**, en SQL Editor ejecuta una vez `supabase/schema.sql`. Crea respuestas, sesiones, contadores de peticiones y reservas opcionales de hashes. Todas las tablas tienen RLS y carecen de acceso para `anon` y `authenticated`; únicamente el backend escribe mediante `service_role`. No añadas políticas públicas de inserción.

Si ya ejecutaste el esquema 1.0.0, **no repitas schema.sql**: ejecuta una sola vez `supabase/migrations/202609060001_pre_post.sql` en SQL Editor. La migración conserva registros anteriores y deja sus nuevos campos en `NULL` (no inventa juicios históricos). Las respuestas 1.1.0 deben tener pre, post y `case_version`. Añade las columnas y funciones de bloqueo a sesiones. No ejecutes la migración sobre una instalación nueva creada con el schema actualizado, que ya la incorpora.

Despliega en este orden, fuera de una recogida activa: **SQL/migración → Edge Function → frontend**. Las sesiones 1.0.0 no pueden continuar en 1.1.0 y deben reiniciarse de forma explícita en la interfaz. No mezcles versiones en el análisis.

`created_at` se genera en PostgreSQL al aceptar el consentimiento e iniciar la sesión. `submitted_at` se genera en PostgreSQL al insertar la respuesta. Son `timestamptz`; PostgreSQL conserva instantes absolutos y la visualización depende de la zona horaria del cliente. `duration_seconds` se calcula en servidor desde el inicio, incluyendo pausas, recargas y tiempo con la pestaña cerrada. Se guardan `experiment_version`, `classifier_version`, `case_version`, `pre_ai_judgement`, `post_ai_judgement` y `test_mode`. En sesiones, la condición es NULL hasta fijar el pre y `pre_recorded_at` registra ese momento en servidor; en respuestas completas la condición es obligatoria.

## 3. Desplegar la Edge Function

Con Node y la CLI de Supabase disponibles:

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase functions deploy submit-response --no-verify-jwt
```

El endpoint admite participantes sin cuenta, por lo que la verificación JWT de plataforma está desactivada explícitamente en `supabase/config.toml`. La función verifica un token aleatorio de sesión en las operaciones posteriores. Su URL será `https://TU_PROJECT_REF.supabase.co/functions/v1/submit-response`.

Documentación oficial: [despliegue](https://supabase.com/docs/guides/functions/deploy), [configuración de funciones](https://supabase.com/docs/guides/functions/function-configuration).

## 4. Definir secretos

Copia `.env.example` a `.env` y ajusta los valores. `.env` está excluido de Git. Ejecuta:

```bash
npx supabase secrets set --env-file .env
```

Supabase alojado proporciona `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` al entorno de la función. No copies esa clave a JavaScript, HTML, capturas, archivos versionados ni GitHub Pages. El frontend no necesita ninguna clave Supabase. No añadas secretos de despliegue a `js/config.js`.

Variables del backend:

| Variable | Valor inicial / significado |
| --- | --- |
| `ALLOWED_ORIGINS` | Orígenes exactos separados por comas |
| `STORE_IP_HASH` | `false` |
| `IP_HASH_SALT` | Secreto de al menos 32 caracteres si se activa el hash |
| `TRUSTED_IP_HEADER` | Cabecera sobrescrita por el proxy de confianza; vacía por defecto |
| `BLOCK_DUPLICATE_IP_HASH` | `false`; activar solo de manera explícita |
| `TEST_MODE` | `false`; debe coincidir con el frontend |
| `RATE_LIMIT_PER_MINUTE` | `120` peticiones por minuto para toda la aplicación |

## 5. Configurar CORS

En desarrollo, por ejemplo:

```text
ALLOWED_ORIGINS=https://TU_USUARIO.github.io,http://localhost:8000,http://127.0.0.1:8000
```

En producción elimina localhost. Para una URL Pages `https://TU_USUARIO.github.io/PERSUASIVE26/`, el origen es `https://TU_USUARIO.github.io`, sin ruta ni barra final. Los orígenes no pueden restringir CORS a un repositorio dentro del mismo dominio. Si necesitas ese aislamiento, utiliza un dominio propio. No se aceptan comodines ni solicitudes sin `Origin`.

CORS limita navegadores, no autentica clientes externos. El límite global es atómico y compartido en PostgreSQL; devuelve 429 cuando se supera y no necesita IP ni fingerprinting. Es una protección básica de capacidad, no una garantía contra automatización o fraude. Los contadores antiguos se eliminan automáticamente.

## 6. Configurar el frontend

Edita `js/config.js`:

```js
export const FUNCTION_URL = 'https://TU_PROJECT_REF.supabase.co/functions/v1/submit-response';
export const TEST_MODE = false;
export { EXPERIMENT_VERSION, CASE_VERSION } from '../supabase/functions/_shared/protocol.js';
```

El frontend estático no lee `.env`. Si falta la URL o no responde el backend, muestra un error y permite reintentar; nunca presenta un envío fallido como guardado.

## 7. Activar GitHub Pages

Sube los archivos a tu repositorio. En Settings → Pages elige Deploy from a branch, tu rama principal y `/ (root)`. Mantén `.nojekyll`. Abre `https://TU_USUARIO.github.io/PERSUASIVE26/`. Todos los recursos e imports son relativos y funcionan bajo la ruta del repositorio, sin compilación. Usa HTTPS.

Antes de reclutar, revisa el consentimiento conforme a tu protocolo e incorpora los datos institucionales, contacto del equipo, política de conservación y aprobación ética que correspondan. No se han inventado esos datos. Comprueba también las políticas de logs de los proveedores de alojamiento.

## 8. Probar localmente

```bash
python3 -m http.server 8000
```

Abre `http://localhost:8000`. Evita `file://`, que no sirve módulos ES correctamente. Puedes apuntar al endpoint alojado con localhost autorizado, preferiblemente en un proyecto de pruebas separado. Para un backend local, con Docker y la CLI:

```bash
npx supabase start
# Ejecuta schema.sql en el SQL Editor de Studio local.
npx supabase functions serve submit-response --env-file .env --no-verify-jwt
```

Configura entonces `FUNCTION_URL` como `http://127.0.0.1:54321/functions/v1/submit-response`.

### Modo de prueba y debug

Activa `TEST_MODE = true` en `js/config.js` y el secreto `TEST_MODE=true` en el backend de pruebas. Antes de iniciar una nueva sesión abre:

- `/?condition=XAI`
- `/?condition=NO_XAI`
- `/?debug=1` para ver participant_id, condition, classification y explanationFactors; permite reiniciar el estado local de prueba.

Bajo Pages antepón la ruta del repositorio. Una condición forzada no reemplaza una sesión existente: reiníciala desde debug para probar otra. No hay un archivo debug independiente. La vista debug solo se construye cuando `TEST_MODE=true`; en producción el parámetro se ignora y nunca muestra esos datos. Como todo frontend público, el código se puede inspeccionar: esto es un control de interfaz, no un secreto. No publiques una copia de desarrollo como estudio de producción.

Los registros de prueba llevan `test_mode=true`. Usa un proyecto separado para pilotos o exclúyelos del análisis. Antes de producción, devuelve ambos ajustes a `false` y comprueba desde un navegador limpio que los parámetros se ignoran.

### Verificaciones reproducibles

Pruebas sin dependencias (9 casos, 3 integraciones omitidas explícitamente):

```bash
node --experimental-default-type=module tests/experiment.test.mjs
```

Para ejecutar **la misma suite completa** con navegador real y PostgreSQL de pruebas, instala herramientas solo en una carpeta temporal. No son dependencias del frontend ni necesitan build:

```bash
npm install --prefix /tmp/persuasive26-tools playwright@1.63.0 typescript@5.9.3 @electric-sql/pglite@0.5.8
TEST_TOOLS_DIR=/tmp/persuasive26-tools/node_modules \
CHROME_PATH=/opt/google/chrome/chrome \
node --experimental-default-type=module tests/experiment.test.mjs
```

Ajusta `CHROME_PATH` a tu Chrome/Chromium. El puerto local 8000 debe estar libre. `tests/helpers.mjs` sirve los archivos actuales por HTTP, configura únicamente las respuestas de `config.js` para pruebas y ejecuta el handler real de la Edge Function, transpiliado en memoria. El transporte PostgREST se sustituye por un adaptador mínimo que ejecuta SQL real en **PGlite (PostgreSQL en WebAssembly)**. No se conecta ni escribe a Supabase alojado, y no modifica la configuración de producción en disco.

**Resultado comprobado: 12/12 tests correctos.** Incluyen los 15.625 perfiles, explicación consistente, entrada pre/post inválida, sesión persistente, bloqueo del pre y condición, ratings inválidos, RLS/permisos, envíos concurrentes, reintento tras perder una respuesta ya guardada, migración de registros antiguos y ambos recorridos completos en Chrome.

La prueba de navegador verifica y captura todas las pantallas, las 13 preguntas visibles, selección con teclado, botones obligatorios, recargas en caso/pre/assessment/cuestionario, `main` no vacío, URL sin configurar, error de red, import ausente, `file://`, estado corrupto/antiguo, subruta Pages, `TEST_MODE` y parámetros ignorados en producción. Revisa ausencia de desbordamiento horizontal a 1365×768 y 320 px. El 200 % se comprueba con CSS `zoom:2` y con el viewport CSS equivalente 682×384; no se automatiza el menú de zoom del navegador.

Las capturas se generan en `tests/artifacts/` y se revisaron visualmente: consentimiento, caso, pre, NO_XAI, XAI con explicación, post, cuestionario completo y finalización. Todas las preguntas A1–A4, T1–T2, TR1–TR2, RP1–RP3, U1 y MC1 son legibles y seleccionables. Los recorridos normales no producen errores de consola; los fallos provocados deliberadamente generan diagnósticos esperados.

La comprobación integrada local no sustituye un piloto en el dominio público con Supabase alojado. Antes de reclutar, completa el consentimiento institucional, despliega, repite ambos recorridos en el entorno real y revisa allí CORS, timestamps, exportación CSV y la política de logs. No se ha realizado una evaluación manual con lector de pantalla ni una auditoría formal de accesibilidad.

## 9. Exportar CSV

En Supabase Table Editor abre `experiment_responses`, filtra `test_mode=false` y `experiment_version=1.1.0` y utiliza Export → CSV. También puedes ejecutar en SQL Editor:

```sql
select * from public.experiment_responses
where test_mode = false and experiment_version = '1.1.0'
order by submitted_at;
```

Descarga el resultado como CSV. Los ítems son enteros de 1 a 7; `explanation_factors` contiene JSON. `user_agent`, `screen_width`, `screen_height` y `language` se dejan `NULL` deliberadamente: el esquema admite estos campos opcionales pero el estudio no los recopila.

## Activar o desactivar el hash sin cambiar código

Por defecto `STORE_IP_HASH=false`: la función no lee ninguna cabecera IP. Para activarlo, verifica primero qué cabecera de un solo valor sobrescribe tu gateway con la IP real. No uses una cabecera controlable por el cliente ni el primer elemento de una cadena `X-Forwarded-For` sin una política de confianza comprobada. Esta implementación falla de forma explícita ante cabeceras vacías o con múltiples valores.

Genera un salt con `openssl rand -hex 32`, guárdalo en `.env` como `IP_HASH_SALT` y configura la cabecera verificada en `TRUSTED_IP_HEADER`. Después:

```bash
npx supabase secrets set --env-file .env
npx supabase secrets set STORE_IP_HASH=true
```

No requiere modificar código. La pantalla de consentimiento consulta el ajuste al pulsar el botón de aceptación, sin bloquear su renderizado inicial; si se activa el hash, exige aceptación adicional antes de crear la sesión. Cambia esta política entre periodos de recogida, sin participantes activos, para que el consentimiento coincida con la política aplicada al envío.

La función calcula SHA-256(IP + SALT) y almacena únicamente `ip_hash`; nunca devuelve la IP al frontend ni escribe `raw_ip`. No se registran cuerpos ni cabeceras en logs del código. Los proveedores pueden procesar IP en su infraestructura; esta aplicación no puede prometer que sus logs no las conserven. El hash sigue siendo un dato seudónimo; IP compartidas y cambios de red limitan su utilidad. Distintas representaciones IPv6 podrían producir hashes diferentes.

Para detectar repeticiones sin bloquear:

```sql
select ip_hash, count(*) from public.experiment_responses
where ip_hash is not null and test_mode = false
group by ip_hash having count(*) > 1;
```

El bloqueo solo se activa con `BLOCK_DUPLICATE_IP_HASH=true`. Las reservas atómicas impiden carreras concurrentes; una reserva se conserva si falla el guardado, permitiendo reintentar la misma sesión. Activar el bloqueo después de recoger respuestas no reserva hashes históricos: planifícalo antes de la recogida o realiza una migración revisada. No es una garantía antifraude.

Para desactivar:

```bash
npx supabase secrets set STORE_IP_HASH=false BLOCK_DUPLICATE_IP_HASH=false
```

Esto no borra hashes históricos. Gestiona su eliminación y la de sesiones incompletas según tu protocolo de conservación. `experiment_completed=true` evita repeticiones accidentales en este navegador; borrar el almacenamiento u otro dispositivo evita ese control. El modo privado puede impedir la persistencia. Evita varias pestañas simultáneas al iniciar: localStorage no ofrece una transacción entre pestañas, aunque el backend fija de forma inmutable el primer juicio y asignación registrados para cada sesión.
