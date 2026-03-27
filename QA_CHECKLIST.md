# QA Checklist Rapida - Connect-In

Usar esta hoja en cada release.

## Datos de la ejecucion

- Fecha:
- Tester:
- Version de la extension:
- Navegador/Canal (Chrome, Edge, etc.):
- Resultado general: OK / PARCIAL / FALLA
- Notas generales:

## Pre-check

- [ ] Cargar extension unpacked sin errores en `chrome://extensions`.
- [ ] Limpiar storage previo de la extension (si aplica).
- [ ] Verificar permisos activos y `host_permissions` en LinkedIn.
- [ ] Confirmar idioma de prueba (ES/EN) segun escenario.

## Flujo principal (Conectar)

- [ ] Iniciar corrida desde popup en pagina de busqueda de personas.
- [ ] Detecta botones `Conectar` correctamente.
- [ ] Abre modal de invitacion.
- [ ] Si hay mensaje configurado: hace click en `Anadir una nota`.
- [ ] Completa el campo de mensaje con plantilla (incluyendo `{{name}}` si aplica).
- [ ] Envia invitacion y el estado visual cambia (ej. `Pendiente`).
- [ ] El contador de popup incrementa solo en envios reales.

## Flujo Seguir + CSV

- [ ] Detecta perfiles con boton `Seguir`.
- [ ] Guarda perfiles en lista interna sin duplicados.
- [ ] Exporta CSV correctamente.
- [ ] Validar columnas minimas: perfil, nombre, headline, ubicacion, estado, fecha.
- [ ] Export incremental funciona (si se usa modo incremental).

## Paginacion y estabilidad

- [ ] No salta pagina antes de que carguen botones.
- [ ] Avanza a siguiente pagina solo cuando corresponde.
- [ ] Se detiene al llegar al limite de sesion configurado.
- [ ] Muestra mensaje final en popup con conteo enviado.

## Limites y seguridad

- [ ] Respeta limite por hora.
- [ ] Respeta limite por dia.
- [ ] Si LinkedIn bloquea (UI o 429), la extension se detiene automaticamente.
- [ ] Guarda `finishReason` correcto en estado final.

## Procesar Seguir (si aplica)

- [ ] Inicia batch de `Procesar Seguir`.
- [ ] Actualiza progreso (enviados/fallidos/salteados).
- [ ] Permite detener batch manualmente.
- [ ] Persiste resultados al terminar.

## i18n y UI popup

- [ ] Textos visibles en ES/EN correctamente.
- [ ] Fallback de strings funciona si falla carga de `i18n/strings.json`.
- [ ] Botones Start/Stop y estados reflejan correctamente la ejecucion.

## Consola y logs

- [ ] Sin errores bloqueantes de la extension.
- [ ] `[Violation]` solo como warning de performance (no bloqueante).
- [ ] Errores de ads bloqueadas (`ERR_BLOCKED_BY_CLIENT`) no afectan funcionalidad.

## Evidencia de la corrida

- URL de busqueda usada:
- Limite de sesion:
- Enviadas reales:
- Guardadas en Seguir:
- Archivo CSV generado:
- Capturas/logs adjuntos:
- [ ] Exportar evidencia QA desde popup (`Exportar evidencia QA (JSON)`).
- [ ] Verificar que el JSON incluya `observability.events` con `runId` y eventos `start/retry/timeout/finish/stop`.
- [ ] Confirmar `finishReason` y `sentThisSession` en `lastRunStatus` dentro de la evidencia.

## Resultado final

- Estado: OK / PARCIAL / FALLA
- Bloqueantes encontrados:
- Riesgos no bloqueantes:
- Acciones sugeridas antes de release:
