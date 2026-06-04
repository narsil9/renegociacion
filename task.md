# Tareas: Corrección de Errores en Automatización y CMF Analyzer

- [x] **1. CMF Analyzer**
  - [x] Implementar normalización de diacríticos para búsquedas internas (BUG-11)
  - [x] Implementar extracción de `overdue90DaysTotal` basada en anclas y fallback (BUG-10)
  - [x] Implementar mapeo de columnas dinámico y check de sanidad para `directOverdue90Days` (BUG-01)
  - [x] Sumar deuda directa e indirecta para validación de 80 UF (BUG-02)

- [ ] **2. Utilidad de Alertas**
  - [ ] Modificar `createAlert` y `clearAlert` para aceptar nombre de tabla parametrizado (BUG-20)
  - [ ] Concatenar tipo y mensaje en `credential_error` (BUG-19)

- [ ] **3. Login y Detección de ClaveÚnica**
  - [ ] Definir e implementar clase `CredentialError` tipada (BUG-12 / BUG-16)
  - [ ] Reemplazar selectores parciales por selectores exactos con comillas (BUG-15)
  - [ ] Implementar distinción entre error de credenciales y portal caído/timeout (BUG-14)
  - [ ] Reemplazar `console.error` por el logger inyectado en el catch block (BUG-21)

- [ ] **4. Worker**
  - [ ] Integrar `CredentialError` en la captura de errores del bucle de reintentos y actualización de alertas (BUG-12 / BUG-16)
  - [ ] Pasar `CLIENTS_TABLE` parametrizado a `createAlert` y `clearAlert` (BUG-20)

- [ ] **5. Script de Migración**
  - [ ] Eliminar `rejectUnauthorized: false` o simplificar script a SQL de fallback (BUG-22)

- [ ] **6. Script de Pruebas de Credenciales**
  - [ ] Corregir parseador de `.env` para soportar contraseñas con el carácter `=` (BUG-13)
  - [ ] Añadir delay de 5s post-pm2 restart (BUG-17)
  - [ ] Filtrar eliminación de jobs previos a estados terminales (BUG-18)

- [ ] **7. Pasos de Automatización (Steps 2, 3, 4)**
  - [ ] Mover URL Check inicial antes del `waitForSelector` en todos los Steps (BUG-09)
  - [ ] Usar logger inyectado en los bloques catch (BUG-08)
  - [ ] Step 3: Agregar `:not(.hidden)` al selector de confirmación de subida (BUG-05)
  - [ ] Step 3: Aumentar timeout del modal de confirmación a 15s (BUG-06)
  - [ ] Step 3: Esperar `#acreedoresRenegociacionForm` tras borrado en Dry Run (BUG-07)

- [ ] **8. Compilación y Verificación**
  - [ ] Ejecutar `npm run build` para asegurar compilación limpia
  - [ ] Ejecutar `npx ts-node src/utils/test_cmf_parser.ts` y validar resultados
  - [ ] Ejecutar `npx ts-node src/utils/test_invalid_credentials.ts` y validar flujo E2E
