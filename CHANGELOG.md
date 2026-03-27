# Changelog

All notable changes to this project are documented in this file.

## [v0.2] - 2026-02-17

### Added

- Deteccion de limite de LinkedIn por respuesta API `HTTP 429` para endpoints de invitaciones.
- Motivo de finalizacion especifico `linkedin_limit_reached_429`.
- Mensaje visible en popup para distinguir bloqueo por API vs limite visual/modal.
- Documentacion base para publicacion en GitHub (`README`, `LICENSE`, `CONTRIBUTING`, `.gitignore`).

### Improved

- Deteccion de modal de limite semanal mas robusta.
- Seleccion de dialogos visibles para evitar falsos positivos por modales ocultos.
- Validacion de resultado real del envio antes de contabilizar solicitudes.
