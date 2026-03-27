# Connect-In (v0.2)

Extension de Chrome/Brave para automatizar invitaciones de conexion en LinkedIn con foco en operacion segura, controlada y auditable.

## Estado de la version

- Release: `v0.2`
- Manifest (extension): `0.2.0`
- Navegadores probados: Chrome, Brave

## Funcionalidades principales

- Envio automatizado de invitaciones desde resultados de busqueda en LinkedIn.
- Mensaje personalizado con placeholder `{{name}}`.
- Delay aleatorio configurable entre envios.
- Limite por sesion configurable.
- Conteo de solicitudes enviadas.
- Deteccion de perfiles con boton "Seguir" y exportacion CSV.
- Deteccion de limite de LinkedIn por:
  - modal/aviso visual, y
  - respuesta API `HTTP 429` en endpoints de invitaciones.

## Requisitos

- Google Chrome o Brave (soporte de extensiones Chromium).
- Sesion iniciada en `https://www.linkedin.com`.

## Instalacion (modo desarrollador)

1. Clonar o descargar este repositorio.
2. Abrir `chrome://extensions/` (o `brave://extensions/`).
3. Activar **Developer mode**.
4. Click en **Load unpacked**.
5. Seleccionar la carpeta raiz del proyecto (`connect-in`).

## Uso rapido

1. Abrir una busqueda de personas en LinkedIn.
2. Recargar la pagina (F5) y esperar que carguen resultados.
3. Abrir popup de la extension.
4. Configurar:
   - Mensaje personalizado (opcional)
   - Limite de sesion (`0` = sin limite)
   - Delay (ej. `5-10`)
5. Presionar **Iniciar**.
6. Para detener manualmente, presionar **Detener**.

## Estados de finalizacion

La extension guarda y muestra motivo de finalizacion:

- `limit_reached`: limite de sesion alcanzado.
- `no_more_results`: no hay mas resultados para procesar.
- `linkedin_limit_reached`: LinkedIn detectado por modal/texto de limite.
- `linkedin_limit_reached_429`: LinkedIn bloquea por API (`HTTP 429`).
- `stopped_by_user`: detenido manualmente.

## Permisos y privacidad

Permisos declarados en `manifest.json`:

- `storage`: guardar configuracion y contadores locales.
- `webRequest`: detectar respuestas `429` de endpoints de invitacion.
- `host_permissions` sobre `https://www.linkedin.com/*`.

La extension no envia datos a servidores propios. Toda la informacion se procesa localmente en el navegador.

## Estructura del proyecto

- `manifest.json`: configuracion MV3.
- `background.js`: service worker, estado global y deteccion `429`.
- `content/content.js`: logica principal de automatizacion en pagina.
- `popup/popup.html`: interfaz.
- `popup/popup.js`: logica de UI, estados y export.
- `popup/popup.css`: estilos del popup.
- `i18n/strings.json`: textos ES/EN.

## Desarrollo

Cada vez que se cambie codigo:

1. Recargar extension en `chrome://extensions/`.
2. Recargar LinkedIn (F5).
3. Probar en una pagina de resultados real.

## Disclaimer

Este proyecto es para uso personal y educativo. El uso de automatizaciones en plataformas de terceros puede estar sujeto a terminos de servicio y restricciones del proveedor.
