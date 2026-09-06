# Experimento de interpretación de IA · 2.0.0

Aplicación académica de HCI/XAI en HTML, CSS y JavaScript vanilla, sin frameworks, dependencias de ejecución ni compilación.

```text
GitHub Pages → navegador: experimento + clasificador + XAI
                         ↓ solo al pulsar Submit responses
              Google Apps Script Web App → Google Sheets
```

Todo el recorrido, incluidas recargas y asignación, funciona localmente sin servicios externos. Google Apps Script recibe exclusivamente el envío final, lo valida y añade una fila a una hoja privada. No ejecuta el modelo.

## Objetivo y research questions

El estudio compara dos condiciones entre sujetos: una evaluación de IA sin explicación (`NO_XAI`) y exactamente la misma evaluación con explicación (`XAI`). La asignación es aleatoria 50/50, una sola vez después del juicio inicial. No se revelan al participante las etiquetas de las condiciones ni las hipótesis. El caso, resultado, texto base y estructura son idénticos; la única manipulación es la presencia de la explicación.

- **RQ1.** Does providing an XAI explanation increase users' acceptance of an AI-generated ADHD/ASD-related assessment?
- **RQ2.** How does providing an XAI explanation affect users' trust in and perceived transparency of an AI-generated ADHD/ASD-related assessment?
- **RQ3.** Does providing an XAI explanation affect users' perceived autonomy and perceived manipulation when evaluating an AI-generated ADHD/ASD-related assessment?
- **RQ4.** Does providing an XAI explanation produce a greater shift in users' own judgement toward the AI-generated assessment?

**Primary self-reported outcome: Acceptance / persuasion (A1–A4).** El judgement outcome compara `pre_ai_judgement` con `post_ai_judgement`. En este estímulo, 1 apunta hacia ADHD y 7 hacia ASD: **`post - pre < 0` indica movimiento hacia la valoración de la IA**. Siempre se guardan los dos valores brutos; la diferencia no los sustituye. Preespecifica la agregación de ítems y el análisis antes de recoger datos. No se mide diagnóstico clínico ni comportamiento clínico.

## Flujo y estímulo

```text
Information and consent
          ↓
Fictional case: Alex (solo lectura)
          ↓
Pre-AI judgement (1–7)
          ↓
Random assignment (50/50)
          ↓
┌────────────────────────┬────────────────────────┐
│ NO_XAI                 │ XAI                    │
│ AI-assisted assessment │ AI-assisted assessment │
│                        │ + explicación          │
└────────────────────────┴────────────────────────┘
          ↓
Post-AI judgement (1–7)
          ↓
Questionnaire (13 ítems obligatorios)
          ↓
Submit responses → envío final → Completion
```

El consentimiento aparece inmediatamente, incluso con `APPS_SCRIPT_URL` vacía. Requiere marcar la casilla y pulsar **I agree to participate**. El contenido institucional en `js/app.js` está marcado **PROVISIONAL CONSENT**: revisa institución, contacto, conservación de datos y aprobación ética antes del estudio real.

Alex es ficticio; el participante únicamente lee el perfil. `case_version = 'alex_v1'`:

| Característica | Frecuencia | Valor |
| --- | --- | --- |
| Difficulty sustaining attention during long tasks | Often | 3 |
| Easily distracted by external stimuli | Very often | 4 |
| Impulsive responding | Sometimes | 2 |
| Difficulty dealing with unexpected changes | Rarely | 1 |
| Difficulty interpreting social cues | Rarely | 1 |
| Repetitive behaviours or interests | Never | 0 |

Las escalas pre y post son exactamente iguales:

- 1 = Much more consistent with ADHD-related characteristics
- 4 = Unsure / equally consistent
- 7 = Much more consistent with ASD-related characteristics

Ambas requieren un entero de 1 a 7. El pre queda bloqueado localmente antes de mostrar la IA; no hay navegación para modificarlo después. El post no muestra la respuesta anterior. El bloqueo y la condición sobreviven a recargas; las pestañas abiertas se actualizan al cambiar el almacenamiento local. Como cualquier frontend público, esto evita cambios accidentales por la interfaz, pero no impide manipular datos deliberadamente con herramientas de desarrollo.

## Clasificador y explicación

**PROVISIONAL EXPERIMENTAL CLASSIFIER**

**NOT CLINICALLY VALIDATED**

El clasificador incluido es provisional y **NO está clínicamente validado** para diagnóstico diferencial ADHD/ASD. No se solicita información clínica del participante.

`js/classifier.js` implementa:

```js
const result = classifyProfile(features);
const factors = explainClassification(features, result);
```

La regla suma atención, distractibilidad e impulsividad (9), y compara con cambios, comunicación social y conductas repetitivas (2). Devuelve `ADHD_RELATED`, `ASD_RELATED` o `INCONCLUSIVE` en caso de empate. La explicación proviene de esos mismos factores y contribuciones unitarias, ordenados por su peso en el resultado. El modelo y la explicación se ejecutan completamente en el navegador, sin llamadas de red.

La interfaz muestra en ambas condiciones:

> Based on the information provided, the system considers this profile more consistent with ADHD-related characteristics than ASD-related characteristics.

Y el aviso de prototipo sin validez diagnóstica. Solo XAI añade **Why did the system reach this conclusion?** y los factores calculados.

El estímulo vive en `js/case.js`, separado del modelo. Para sustituir la regla por un árbol, regresión logística u otro modelo interpretable de BALIDA-AA, cambia `classifier.js`, conserva sus exports y la forma de los factores `{feature, value, contribution, text}`, y actualiza `CLASSIFIER_VERSION`. El receptor no reproduce ni vuelve a entrenar el modelo. El contrato del estímulo actual exige un resultado `ADHD_RELATED`: la interfaz se detiene si un modelo nuevo lo contradice, para no mostrar un texto incoherente. Un cambio de resultado o diseño requiere revisar el protocolo y su versión.

## Cuestionario

Los 13 ítems originales se conservan en `js/questionnaire.js` y se renderizan como grupos de radios con labels y legends. Escala 1–7: **Strongly disagree → Strongly agree**. Submit permanece deshabilitado hasta completar todos.

| Constructo documentado para el equipo investigador | Ítems |
| --- | --- |
| Acceptance / persuasion | A1, A2, A3, A4 |
| Trust | T1, T2 |
| Transparency | TR1, TR2 |
| Responsible persuasion | RP1, RP2, RP3 |
| Usefulness | U1 |
| Manipulation check | MC1 |

## Datos guardados

Cada envío válido añade una fila a `experiment_responses`. Las **35 columnas**, en orden, son:

```text
server_received_at, submission_id, participant_id, session_id,
created_at, submitted_at_client, condition,
experiment_version, case_version, classifier_version,
pre_ai_judgement, post_ai_judgement, classification, duration_seconds,
feature_attention, feature_distractibility, feature_impulsivity,
feature_changes, feature_social_communication, feature_repetitive_behaviours,
a1, a2, a3, a4, t1, t2, tr1, tr2, rp1, rp2, rp3, u1, mc1,
explanation_factors_json, test_mode
```

`participant_id`, `session_id` y `submission_id` son UUID v4 generados con `crypto.randomUUID()`. Se guardan, junto con condición, paso, pre/post, respuestas y versiones, en una única entrada de `localStorage`. Se conserva la clave estable `hci_experiment_v1` para detectar estados anteriores; el contenido se identifica mediante `experiment_version = '2.0.0'`. Un estado corrupto o incompatible ofrece limpiar el borrador y volver al consentimiento; no deja la pantalla vacía ni elimina la protección local de finalización.

`created_at` y `submitted_at_client` se generan en el navegador como ISO UTC; `server_received_at` lo genera Apps Script al recibir la petición. Los dos primeros y `duration_seconds` dependen del reloj del dispositivo, no son timestamps de servidor. La duración incluye pausas y pestañas cerradas y termina en el primer intento configurado de envío. Se conservan los mismos tiempos y el mismo payload en cada reintento. `test_mode` permite excluir pilotos.

Apps Script valida campos permitidos, UUID, condiciones, versiones, timestamps, duración, estímulo fijo, enteros pre/post y Likert 1–7, y estructura de factores. Rechaza datos inválidos sin añadir fila. No evalúa la validez clínica ni puede probar que los datos del navegador no hayan sido manipulados.

La detección de `submission_id` y `appendRow` se ejecutan bajo un único `LockService.getScriptLock()`, con `flush()` antes de liberar el bloqueo. El primer envío válido prevalece; repetir su ID no añade ni sobrescribe una fila. Mantén un único proyecto de Apps Script escritor de esta hoja y no borres las filas originales mientras necesites esa deduplicación. [Lock Service de Google](https://developers.google.com/apps-script/reference/lock).

## Envío y confirmación: limitación importante

`js/submission.js` envía JSON en un POST con `Content-Type: text/plain;charset=UTF-8`, `mode: 'no-cors'` y sin credenciales. El tipo de contenido evita una petición de preflight; `doPost(e)` lee `e.postData.contents`. Se siguen las redirecciones de Content Service. [Web Apps](https://developers.google.com/apps-script/guides/web), [Content Service y redirecciones](https://developers.google.com/apps-script/guides/content).

**El navegador no puede inspeccionar la respuesta del servidor y, por tanto, no puede confirmar directamente que la fila se haya escrito correctamente.** Que `fetch` resuelva tampoco garantiza una escritura: podría haber un error de validación, permisos, configuración o cuotas. Es una respuesta opaca. [Modo `no-cors`](https://developer.mozilla.org/en-US/docs/Web/API/Request/mode).

Por eso la pantalla final dice **Your submission has been sent**, explica que el guardado no está confirmado y ofrece **Retry the same submission**. Nunca afirma que la fila está guardada. La marca local `experiment_completed=true` evita comenzar de nuevo accidentalmente, pero no prueba recepción. Se conserva el payload final para repetirlo con el mismo `submission_id`. Si hay un fallo de red detectable, el cuestionario permanece y permite reintentar; sus respuestas quedan bloqueadas para que los reintentos sean idénticos. Comprueba las filas directamente en Sheets durante el piloto y la recogida.

No hay peticiones de inicio, consulta de configuración, bloqueo remoto ni guardado parcial. Si la URL está vacía, únicamente al pulsar Submit aparece **The study data endpoint is not configured.**

## Privacidad y límites

La aplicación no recoge nombres, email, teléfono, geolocalización, diagnóstico real, información de salud del participante, fingerprint ni dirección IP. No utiliza cookies de seguimiento. La hoja debe permanecer privada; el acceso público será al receptor Web App, no a los resultados.

Google y GitHub pueden procesar metadatos técnicos de conexión en su infraestructura. El protocolo y el consentimiento deben contemplar a esos proveedores y establecer la conservación de resultados y borradores locales. Los IDs aleatorios no garantizan por sí solos anonimato absoluto. No se escriben payloads ni identificadores en los logs del script; solo códigos genéricos de error.

El endpoint es público: validación y deduplicación básica no son autenticación ni protección completa contra spam o fraude. No hay claves ocultas en el frontend. Apps Script tiene cuotas y límites de concurrencia; pueden detener ejecuciones y deben comprobarse con una prueba de carga acorde al reclutamiento. Las restricciones de una organización también pueden impedir acceso anónimo. [Cuotas oficiales](https://developers.google.com/apps-script/guides/services/quotas).

## Probar en localhost

Desde la raíz del repositorio:

```bash
python3 -m http.server 8000
```

Abre **http://localhost:8000/**. No abras `index.html` como `file://`: Chrome bloquea los módulos en ese contexto; el inicializador muestra instrucciones de recuperación. Los errores de imports también se muestran en pantalla y en consola.

Con `APPS_SCRIPT_URL = ''` puedes recorrer consentimiento, Alex, pre, assessment, post y las 13 preguntas sin configurar ningún servicio. Solo fallará el envío final con el mensaje descrito.

## Configurar Google Sheets y Apps Script

1. Crea un Google Sheet privado para el estudio. Para pilotos, usa preferiblemente otro archivo.
2. Desde esa hoja abre **Extensions → Apps Script**.
3. Sustituye el contenido de `Code.gs` por `apps-script/Code.gs` de este repositorio.
4. En **Project Settings**, activa la visualización del manifiesto `appsscript.json` y copia `apps-script/appsscript.json`. Usa V8 y zona UTC. El único permiso solicitado es trabajar con hojas de cálculo.
5. Guarda el proyecto. Selecciona **setup** en el selector de funciones y pulsa **Run**. Autoriza la cuenta propietaria. Esta ejecución crea la pestaña `experiment_responses`, sus 35 encabezados y guarda el ID de la hoja en las propiedades del script. Puedes repetirla sin borrar filas. No ejecutes `doPost` desde ese selector: necesita una petición POST.
6. Elige **Deploy → New deployment → Select type → Web app**.
7. Selecciona **Execute as: Me** para escribir con los permisos del propietario.
8. Para participantes sin cuenta Google, selecciona acceso **Anyone**, incluido acceso anónimo. Las opciones dependen de la política de la cuenta. Si tu organización no permite ese acceso, resuélvelo con su administrador o usa una cuenta institucional autorizada que lo permita; no cambies a un flujo que obligue a identificar participantes sin revisar el protocolo.
9. Despliega y copia la **Web app URL terminada en `/exec`**, no la URL del editor ni `/dev`.
10. Pega esa URL en `js/config.js`:

```js
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec';
export const TEST_MODE = false;
export const EXPERIMENT_VERSION = '2.0.0';
export const CASE_VERSION = 'alex_v1';
```

11. Ejecuta un recorrido de prueba desde localhost y pulsa Submit. La pantalla final no constituye confirmación de almacenamiento: **abre el Sheet y comprueba que aparece una fila**, con pre/post, 13 ratings, condición y factores.
12. Pulsa **Retry the same submission** y comprueba que sigue habiendo una sola fila para ese `submission_id`.
13. Si no aparece la fila, revisa **Executions** en Apps Script, la ejecución de `setup`, los encabezados, el despliegue `/exec`, sus permisos y las cuotas. Códigos previstos: `invalid_payload`, `setup_required`, `header_mismatch`, `busy_retry`, `storage_error`. No cambies el orden de columnas de la pestaña de recepción; analiza copias u otras pestañas.
14. Si modificas el código de Apps Script después del despliegue, usa **Deploy → Manage deployments → Edit → New version → Deploy**. Guardar el archivo por sí solo no actualiza la versión pública.

El propietario autoriza el script; el participante no necesita una contraseña ni una clave API. Las propiedades del script solo guardan la referencia a la hoja. El proyecto no necesita `.env`.

## Activar GitHub Pages

Sube los archivos actuales. En el repositorio abre **Settings → Pages → Deploy from a branch**, selecciona tu rama principal y `/ (root)`. Mantén `.nojekyll`. Abre `https://USUARIO.github.io/REPOSITORIO/` con HTTPS. Los scripts, estilos e imports usan rutas relativas; no hay build.

Repite un envío desde el dominio público y verifica la fila en Sheets. Para mantener resultados privados no publiques el Google Sheet ni lo exportes dentro del repositorio.

## TEST_MODE y debug

La configuración entregada usa **`TEST_MODE = false`**, para no publicar controles de desarrollo por accidente. Para probar, cambia únicamente ese booleano a `true`:

- `/?condition=XAI`
- `/?condition=NO_XAI`
- `/?debug=1`: muestra IDs, condición y resultado, y permite limpiar el estado local de prueba.

En una subruta Pages antepón `/REPOSITORIO/`. Los parámetros de condición solo se aplican a una sesión aún no asignada; no cambian una condición existente. Usa debug para reiniciar antes de probar la otra condición. Con `TEST_MODE=false` los tres parámetros se ignoran. Devuelve el ajuste a `false` antes del estudio. Filtra `test_mode = FALSE` al analizar y conserva la versión del protocolo.

## Exportar CSV

En Google Sheets selecciona la pestaña de respuestas y usa **File → Download → Comma-separated values (.csv, current sheet)**. Para exportar únicamente datos reales, prepara antes otra pestaña con filas `test_mode = FALSE` y `experiment_version = 2.0.0`; el CSV de una pestaña de recepción puede incluir filas ocultas o filtradas. No supongas que ocultarlas las elimina del archivo.

Conserva los juicios brutos pre/post y las 13 respuestas numéricas. `explanation_factors_json` se exporta como texto JSON en una celda.

## Tests y comprobación visual

Sin instalar dependencias:

```bash
node --experimental-default-type=module tests/experiment.test.mjs
```

Para añadir la comprobación real en Chrome a **la misma suite**, instala solo la herramienta de pruebas en `/tmp`:

```bash
npm install --prefix /tmp/persuasive26-tools playwright@1.63.0
TEST_TOOLS_DIR=/tmp/persuasive26-tools/node_modules \
CHROME_PATH=/opt/google/chrome/chrome \
node --experimental-default-type=module tests/experiment.test.mjs
```

Ajusta `CHROME_PATH` a tu Chrome/Chromium y deja libre el puerto 8000. No son dependencias de la aplicación. El arnés usa un servidor estático Python y ejecuta `Code.gs` sin modificar en un contexto JavaScript con dobles de los servicios Google. Las peticiones al receptor de prueba son interceptadas en Chrome: no se envían datos a Google. Estas pruebas no sustituyen la verificación de una fila en un despliegue real.

**Resultado verificado: 16/16 tests correctos, incluido el recorrido de Chrome.** Se revisaron visualmente las capturas de consentimiento, Alex, pre/post, los dos assessments, las 13 preguntas y la pantalla final. Sin la herramienta de navegador, se ejecutan 15 tests y se omite explícitamente el test visual.

La suite cubre los 15.625 perfiles posibles, explicación consistente, bloqueo local del pre, condición persistente, 13 ratings obligatorios, payload completo, IDs y reintentos, validación y deduplicación en Apps Script. El recorrido de Chrome cubre ambas condiciones, cero peticiones antes de Submit, endpoint vacío, errores de red, respuesta opaca aunque el receptor rechace la escritura, recuperación de estados, imports, subruta Pages, teclado, scroll, escritorio, móvil de 320 px y ampliación CSS al 200 %.

Las capturas del recorrido se generan en `tests/artifacts/` y no se publican en Git. No se ha realizado una auditoría formal de accesibilidad ni una evaluación manual con lector de pantalla.

## Preparación antes del estudio real

Completa el consentimiento institucional y el plan de conservación; revisa el clasificador provisional y el protocolo con el equipo; preespecifica análisis y exclusiones; comprueba `TEST_MODE=false`; ejecuta ambos recorridos desde Pages; confirma recepción y ausencia de duplicados directamente en Sheets; revisa límites de la cuenta y restringe acceso a los resultados. Conserva una copia versionada del frontend y del script usados en la recogida.
