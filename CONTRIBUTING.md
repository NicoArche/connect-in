# Contributing

Gracias por contribuir a Connect-In.

## Flujo recomendado

1. Crear una rama desde `master`.
2. Hacer cambios pequenos y enfocados.
3. Probar manualmente en LinkedIn (Chrome/Brave):
   - recargar extension,
   - recargar pagina (F5),
   - validar flujo de invitacion y estados finales.
4. Actualizar documentacion si cambia comportamiento visible.
5. Abrir Pull Request con:
   - objetivo del cambio,
   - riesgos,
   - pasos de prueba.

## Convenciones

- Mantener compatibilidad con Manifest V3.
- Priorizar selectores robustos (`aria-label`, roles, clases estables).
- No depender de inyeccion inline de scripts (restricciones CSP).
- No contar envios si no hay confirmacion real del resultado.

## Reporte de bugs

Al reportar un bug, incluir:

- Navegador y version.
- URL de tipo de pagina (ej. resultados de personas).
- Config usada en popup (limite, delay, mensaje).
- Logs relevantes de consola (si hay `429`, indicarlo).
