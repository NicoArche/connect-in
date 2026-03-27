# API Sync — Documentacion tecnica

> **Estado actual: DESACTIVADA**
> La funcionalidad de sincronizacion API esta oculta en la UI y deshabilitada
> mediante el flag `API_SYNC_ENABLED = false` en `background.js`.
> Todo el codigo fuente se conserva intacto para retomarlo mas adelante.

---

## 1. Que hace la API Sync

Cuando esta habilitada, la extension envia eventos de actividad a un endpoint
externo propio (`POST {baseUrl}/events`) usando autenticacion Bearer token.
Esto permite centralizar metricas de uso en un backend propio: invitaciones
enviadas, fallidas, runs finalizados y leads detectados.

**No confundir con la deteccion de LinkedIn 429**: esa funcionalidad (detectar
cuando LinkedIn bloquea solicitudes con HTTP 429) permanece activa y es
independiente de la API Sync.

---

## 2. Configuracion del usuario

El usuario configura la API desde la pestana **Configuraciones** del popup:

| Campo          | Descripcion                                 |
|----------------|---------------------------------------------|
| `apiEnabled`   | Checkbox que activa/desactiva la sync       |
| `apiBaseUrl`   | URL base del endpoint (ej. `https://api.midominio.com`) |
| `apiKey`       | Token Bearer para autenticacion             |

Los datos se guardan en `chrome.storage.local` bajo la clave `apiConfig`:

```json
{
  "enabled": true,
  "baseUrl": "https://api.midominio.com",
  "apiKey": "sk-xxxx..."
}
```

---

## 3. Tipos de evento

La extension envia los siguientes tipos de evento al endpoint:

| Tipo              | Cuando se dispara                                  | Origen                     |
|-------------------|----------------------------------------------------|----------------------------|
| `invite_sent`     | Se envia una invitacion de conexion exitosamente   | connect_loop, follow_retry |
| `invite_failed`   | Una invitacion falla                               | connect_loop, follow_retry |
| `run_finished`    | Un ciclo de ejecucion termina                      | connect_loop               |
| `lead_detected`   | Se detecta un perfil nuevo (boton Seguir)          | connect_loop               |

---

## 4. Formato del request

```
POST {baseUrl}/events
Content-Type: application/json
Authorization: Bearer {apiKey}
```

Body:

```json
{
  "event_id": "1710000000000-abc123",
  "event_type": "invite_sent",
  "created_at": "2026-03-16T12:00:00.000Z",
  "payload": {
    "source": "connect_loop"
  }
}
```

---

## 5. Sistema de cola y reintentos

Los eventos no se envian inmediatamente, sino que se encolan en
`chrome.storage.local` bajo la clave `apiEventQueue`:

```json
{
  "version": 1,
  "items": [
    {
      "id": "1710000000000-abc123",
      "type": "invite_sent",
      "payload": { "source": "connect_loop" },
      "createdAt": "2026-03-16T12:00:00.000Z",
      "attempts": 0,
      "nextRetryAt": 1710000000000
    }
  ]
}
```

### Flush (envio)

La funcion `flushApiQueue(maxItems)` procesa hasta `maxItems` eventos
pendientes. Se invoca automaticamente despues de cada accion relevante
(envio de invitacion, fallo, fin de run, etc.) y tambien manualmente
desde el boton "Sincronizar ahora" del popup.

### Reintentos

Si un POST falla, el evento permanece en la cola con backoff exponencial:

```
backoff = min(15 min, 1.5s * 2^min(attempts, 6))
```

La cola tiene un limite de 1000 items para evitar crecimiento descontrolado.

---

## 6. Archivos involucrados

| Archivo              | Que contiene respecto a la API                        |
|----------------------|-------------------------------------------------------|
| `background.js`      | Toda la logica: normalizeApiConfig, createApiEvent, enqueueApiEvent, flushApiQueue, message handlers (saveApiConfig, getApiSyncState, syncApiNow) |
| `popup/popup.html`   | Seccion de UI (checkbox, inputs, botones) dentro de `#apiSyncSection` |
| `popup/popup.js`     | Funciones saveApiConfig, refreshApiStatus; bindings de eventos; carga de config |
| `i18n/strings.json`  | Clave `apiHelp` (texto de ayuda en ES y EN)           |
| `content/content.js` | No interactua con la API externa directamente          |

---

## 7. Funciones clave en background.js

### `normalizeApiConfig(raw)`
Sanitiza la config del usuario. Retorna `{ enabled, baseUrl, apiKey }`.

### `createApiEvent(type, payload)`
Crea un objeto evento con id unico, tipo, payload, timestamp y metadata de
reintentos.

### `enqueueApiEvent(type, payload)`
Lee la cola actual de storage, agrega el evento, recorta si supera 1000 items
y persiste.

### `flushApiQueue(maxItems)`
Lee config y cola. Si la API esta habilitada y hay eventos pendientes cuyo
`nextRetryAt` ya paso, hace POST uno por uno. Los exitosos se eliminan de la
cola; los fallidos incrementan `attempts` y recalculan `nextRetryAt`.

### Message handlers

| Action           | Descripcion                                         |
|------------------|-----------------------------------------------------|
| `saveApiConfig`  | Guarda config en storage y ejecuta un flush          |
| `getApiSyncState`| Retorna config, tamano de cola, stopStats, analytics |
| `syncApiNow`     | Ejecuta flush manual con hasta 40 items              |

---

## 8. Storage keys

| Clave           | Tipo                | Descripcion                        |
|-----------------|---------------------|------------------------------------|
| `apiConfig`     | `{ enabled, baseUrl, apiKey }` | Configuracion del usuario |
| `apiEventQueue` | `{ version, items[] }` | Cola de eventos pendientes      |

---

## 9. Como reactivar la API Sync

Para volver a habilitar esta funcionalidad:

### Paso 1 — background.js
Cambiar el flag en la parte superior del archivo:

```javascript
const API_SYNC_ENABLED = true;
```

### Paso 2 — popup/popup.html
Quitar el `style="display:none"` del div `#apiSyncSection`:

```html
<!-- Cambiar esto: -->
<div id="apiSyncSection" style="display:none">

<!-- Por esto: -->
<div id="apiSyncSection">
```

### Paso 3 — popup/popup.js
Descomentar las siguientes secciones (buscar "API sync disabled"):

1. En `bindEvents()` — listeners de `btnSaveApiConfig` y `btnSyncApiNow`
2. En `loadConfig()` — carga de `apiEnabled`, `apiBaseUrl`, `apiKey`, `apiStatus`
3. En `init()` — llamada a `refreshApiStatus()`

### Verificacion
Despues de reactivar, probar:
- [ ] La seccion API aparece en la pestana Configuraciones
- [ ] Se puede guardar config (baseUrl + apiKey)
- [ ] Al enviar una invitacion, se encola un evento `invite_sent`
- [ ] "Sincronizar ahora" hace flush de la cola
- [ ] Los eventos llegan al endpoint con el formato correcto

---

## 10. Endpoint esperado del backend

El backend debe exponer:

```
POST /events
Authorization: Bearer {token}
Content-Type: application/json
```

Y aceptar el body descrito en la seccion 4. La respuesta esperada es
cualquier status `2xx` para considerar el evento como entregado.
Cualquier otro status o error de red provoca un reintento con backoff.
