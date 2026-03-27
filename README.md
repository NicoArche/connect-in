# Connect-In (v0.2)

Extension de Chrome/Brave para automatizar invitaciones de conexion, envio de InMails y gestion de perfiles en LinkedIn con foco en operacion segura, controlada y auditable.

## Estado de la version

- Release: `v0.2`
- Manifest (extension): `0.2.0`
- Navegadores probados: Chrome, Brave
- Idiomas soportados: Español, English (detecta automaticamente el idioma del navegador)

## Funcionalidades principales

### Conexiones automatizadas
- Envio automatizado de solicitudes de conexion desde resultados de busqueda en LinkedIn.
- Mensaje personalizado con placeholder `{{name}}` que se reemplaza por el primer nombre del perfil destino.
- Delay aleatorio configurable entre envios (ej. `5-10` segundos).
- Limite por sesion, por hora y por dia (configurables, `0` = sin limite).
- Conteo acumulado de solicitudes enviadas.
- Navegacion automatica entre paginas de resultados cuando se procesan todos los perfiles de la pagina actual.
- Deteccion inteligente de perfiles con boton "Seguir" en lugar de "Conectar", con guardado automatico para posterior procesamiento.

### Envio de InMail por lote
- Importacion de archivo CSV con columnas `profile_url` (o `url`) y opcionalmente `full_name` (o `name`).
- Asunto y mensaje predefinidos con soporte de `{{name}}` para personalizacion.
- Procesamiento secuencial: la extension navega a cada perfil, abre el composer de mensaje y envia automaticamente.
- Progreso en tiempo real: enviados, fallidos, saltados.
- Detencion manual del lote en cualquier momento.
- Exportacion de resultados a CSV con columnas de estado por perfil.
- Deduplicacion automatica de URLs en el CSV.

### Analisis y gestion de perfiles
- Listado de perfiles detectados con boton "Seguir" durante las busquedas.
- Exportacion completa o incremental (solo nuevos) a CSV con datos: URL, nombre, titular, ubicacion, query, pagina, fecha de deteccion y estado.

### Plantillas de mensaje
- Crear, editar y guardar multiples plantillas de mensaje para conexiones.
- Vista previa del mensaje con nombre placeholder sustituido.
- Aplicar plantilla al campo de mensaje de conexion con un click.
- Incluye plantillas por defecto ("Base" y "SaaS").

### Deteccion de limites de LinkedIn
- Deteccion de modal/aviso visual de limite semanal.
- Deteccion de respuesta API `HTTP 429` en endpoints de invitaciones.
- Deteccion de dialogos de advertencia ("te quedan pocas invitaciones") con descarte automatico.
- Finalizacion automatica de la sesion cuando se detecta cualquier tipo de limite.

### Configuracion avanzada
- **Modo diagnostico**: agrega logs detallados en la consola del navegador con prefijo `[Connect-In]`. No modifica la logica de envios.
- **Atajos de teclado** personalizables para: Iniciar/Detener, Procesar Seguir, y Modo diagnostico.

## Requisitos

- Google Chrome o Brave (soporte de extensiones Chromium).
- Sesion iniciada en `https://www.linkedin.com`.

## Instalacion (modo desarrollador)

1. Clonar o descargar este repositorio.
2. Abrir `chrome://extensions/` (o `brave://extensions/`).
3. Activar **Developer mode**.
4. Click en **Load unpacked**.
5. Seleccionar la carpeta raiz del proyecto (`connect-in`).

## Guia de uso

### Tab: Conexiones

Este es el modulo principal para enviar solicitudes de conexion automatizadas.

#### Configuracion

1. Abre una busqueda de personas en LinkedIn (ej. `https://www.linkedin.com/search/results/people/?keywords=marketing`).
2. Recarga la pagina (F5) y espera que carguen los resultados.
3. Abre el popup de la extension haciendo click en el icono de Connect-In.

#### Campos disponibles

| Campo | Descripcion | Valor por defecto |
|-------|-------------|-------------------|
| **Mensaje personalizado** | Texto que acompana la solicitud. Usa `{{name}}` para insertar el primer nombre del destinatario. Si `{{name}}` no puede resolverse, se elimina del mensaje automaticamente. | (vacio = sin nota) |
| **Limite esta sesion** | Maximo de invitaciones en esta ejecucion. | `0` (sin limite) |
| **Delay entre invitaciones** | Rango en segundos entre cada envio (formato `min-max`). | `5-10` |
| **Limite por hora** | Maximo de invitaciones por hora (acumulativo entre sesiones). | `0` (sin limite) |
| **Limite por dia** | Maximo de invitaciones por dia (acumulativo entre sesiones). | `0` (sin limite) |

#### Flujo de ejecucion

1. Presiona **Iniciar**. La extension comenzara a procesar los botones "Conectar" visibles.
2. Para cada perfil con boton "Conectar":
   - Hace scroll al boton y lo clickea.
   - Si hay mensaje personalizado: clickea "Añadir nota", escribe el mensaje y envia.
   - Si no hay mensaje o falla el paso anterior: envia sin nota como fallback.
   - Espera el delay configurado antes de pasar al siguiente.
3. Perfiles con boton "Seguir" se guardan automaticamente en la lista de analisis.
4. Cuando no quedan mas botones de "Conectar" en la pagina, navega automaticamente a la siguiente pagina de resultados.
5. La sesion finaliza automaticamente cuando:
   - Se alcanza el limite de sesion, hora o dia.
   - No hay mas resultados.
   - LinkedIn muestra su limite semanal (modal o HTTP 429).
6. Presiona **Detener** en cualquier momento para parar manualmente.

#### Plantillas

Debajo de los campos principales hay un sistema de plantillas:

1. Selecciona una plantilla del dropdown.
2. Edita el nombre y texto de la plantilla.
3. Click en **Guardar plantilla** para persistirla.
4. Click en **Aplicar** para copiar el texto de la plantilla al campo de mensaje de conexion.

### Tab: Enviar InMail

Permite enviar mensajes InMail a una lista de perfiles desde un archivo CSV.

#### Preparar el CSV

El archivo CSV debe tener al menos una columna de URL de perfil. Columnas reconocidas:

| Columna | Obligatoria | Descripcion |
|---------|-------------|-------------|
| `profile_url` / `url` / `linkedin_url` | Si | URL completa del perfil de LinkedIn |
| `full_name` / `name` / `nombre` | No | Nombre completo (para personalizar con `{{name}}`) |

Ejemplo:

```
profile_url,full_name
https://www.linkedin.com/in/juanperez,Juan Perez
https://www.linkedin.com/in/mariagarcia,Maria Garcia
```

#### Flujo de ejecucion

1. Carga el archivo CSV usando el selector de archivo.
2. Completa el **Asunto** y el **Mensaje** (ambos obligatorios).
3. Presiona **Iniciar lote**.
4. La extension navega secuencialmente a cada perfil, abre el composer de mensaje, escribe asunto y cuerpo, y envia.
5. El progreso se actualiza en tiempo real (enviados, fallidos, saltados).
6. Al finalizar, usa **Exportar resultados InMail** para descargar un CSV con el estado de cada perfil.

### Tab: Analisis

#### Perfiles guardados (Seguir)

Muestra el conteo de perfiles detectados con boton "Seguir" durante las busquedas de conexion.

- **Exportar completo**: descarga CSV con todos los perfiles guardados.
- **Exportar nuevos**: descarga solo perfiles que no se han exportado previamente.

#### Procesar Seguir

Toma los perfiles guardados y navega a cada uno para intentar enviar solicitud de conexion desde la pagina del perfil individual.

| Campo | Descripcion |
|-------|-------------|
| **Score keywords** | Palabras clave separadas por coma. Perfiles que coincidan en titular, ubicacion o query se priorizan. |
| **Max. filas** | Limite de perfiles a procesar (`0` = todos). |
| **Whitelist URLs** | Solo procesar perfiles cuya URL contenga alguno de estos fragmentos. |
| **Blacklist URLs** | Excluir perfiles cuya URL contenga alguno de estos fragmentos. |

### Tab: Configuraciones

| Opcion | Descripcion |
|--------|-------------|
| **Modo diagnostico** | Activa logs en consola con prefijo `[Connect-In]`. Util para depuracion. |
| **Atajos de teclado** | Personaliza combinaciones para: Iniciar/Detener (`Ctrl+Shift+S`), Procesar CSV (`Ctrl+Shift+R`), Modo diagnostico (`Ctrl+Shift+D`). |

## Estados de finalizacion

La extension guarda y muestra el motivo de finalizacion de cada sesion:

| Estado | Significado |
|--------|-------------|
| `limit_reached` | Limite de sesion alcanzado. |
| `hour_limit_reached` | Limite por hora alcanzado. |
| `day_limit_reached` | Limite por dia alcanzado. |
| `no_more_results` | No hay mas resultados para procesar. |
| `linkedin_limit_reached` | LinkedIn detecto limite semanal por modal/texto. |
| `linkedin_limit_reached_429` | LinkedIn bloqueo envios por API (HTTP 429). |
| `stopped_by_user` | Detenido manualmente por el usuario. |

## Permisos y privacidad

Permisos declarados en `manifest.json`:

| Permiso | Uso |
|---------|-----|
| `storage` | Guardar configuracion, contadores, plantillas y listas de perfiles localmente. |
| `webRequest` | Detectar respuestas HTTP 429 en endpoints de invitacion de LinkedIn. |
| `host_permissions` (`https://www.linkedin.com/*`) | Interactuar con la pagina de LinkedIn para automatizar acciones. |

**La extension no envia datos a servidores externos. Toda la informacion se procesa y almacena localmente en el navegador.**

## Estructura del proyecto

```
connect-in/
├── manifest.json          # Configuracion MV3 de la extension
├── background.js          # Service worker: estado global, rate limits, deteccion 429, batch workers
├── content/
│   └── content.js         # Logica de automatizacion inyectada en paginas de LinkedIn
├── popup/
│   ├── popup.html         # Interfaz del popup (4 tabs)
│   ├── popup.js           # Logica de UI, estados, templates, exports
│   └── popup.css          # Estilos del popup
├── i18n/
│   └── strings.json       # Textos internacionalizados ES/EN
├── docs/
│   └── API_SYNC.md        # Documentacion de la funcionalidad de sync con API (futura)
├── CHANGELOG.md           # Historial de cambios
├── CONTRIBUTING.md        # Guia de contribucion
├── LICENSE                # Licencia del proyecto
└── .gitignore             # Archivos excluidos de git
```

## Recomendaciones de uso seguro

- **Usa delays razonables** (minimo 5-10 segundos) para simular comportamiento humano.
- **Configura limites por hora y dia** para evitar triggers de deteccion de LinkedIn.
- **No dejes multiples sesiones simultaneas** corriendo en distintas pestanas.
- **Recarga LinkedIn (F5) antes de cada sesion** para asegurar que el content script se inyecte correctamente.
- **Revisa el modo diagnostico** si algo no funciona como esperas; los logs en consola dan visibilidad completa del flujo.

## Desarrollo

Cada vez que se cambie codigo:

1. Recargar extension en `chrome://extensions/`.
2. Recargar LinkedIn (F5).
3. Probar en una pagina de resultados real.

## Disclaimer

Este proyecto es para uso personal y educativo. El uso de automatizaciones en plataformas de terceros puede estar sujeto a terminos de servicio y restricciones del proveedor.
