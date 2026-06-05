# Plan de Implementación: Corrección de Errores en Automatización y Analizador de CMF

Este plan detalla las modificaciones necesarias para resolver los errores reportados en [CODE_REVIEW.md](CODE_REVIEW.md).

**Excluidos de este plan (se revisan antes de pasar a producción):**
- **BUG-03** — Valor de UF hardcodeado: se deja para cuando las pruebas se acerquen a producción.
- **BUG-04** — Ruta fija de `pdftotext`: el MacBook Air de desarrollo y el Mac Mini de producción son ambos Apple Silicon. Se personalizará al migrar al Mac Mini si fuera necesario.

---

## Notas de implementación para el agente

> **Modo Sandbox activo**: Toda escritura a base de datos va a la tabla `clients` del sandbox vía `supabaseWorker`. No se toca producción.

> **Orden de implementación obligatorio**: `alerts.ts` debe modificarse **antes** que `worker.ts`, ya que el cambio de firma de `createAlert`/`clearAlert` rompe la compilación hasta que `worker.ts` actualice sus llamadas. Hacer ambos cambios en el mismo commit.

> **Normalización de diacríticos en `cmf_analyzer.ts`**: la normalización se aplica solo al texto interno de búsqueda (variables locales usadas para búsqueda y comparación). El texto que se loguea con `logger.log()` debe seguir usando el texto original con tildes para que los logs sean legibles.

---

## Cambios propuestos

### 1. CMF Analyzer

#### [MODIFY] [src/utils/cmf_analyzer.ts](src/utils/cmf_analyzer.ts)

**BUG-11 — Búsqueda insensible a acentos**
Crear una variable interna `searchText` normalizada (NFD sin diacríticos) para todas las búsquedas por `indexOf` y regex. No normalizar el texto que se pasa a `logger.log()`.
```typescript
const searchText = normalized.normalize('NFD').replace(/[̀-ͯ]/g, '');
// Usar searchText.indexOf('90 o mas dias') en lugar de normalized.indexOf('90 o más días')
```

**BUG-10 — Índice hardcodeado `[3]` para `overdue90DaysTotal`**
En lugar de tomar el 4.º monto dollar después de "90 o mas dias", aislar el bloque de resumen entre las anclas "deuda total y estado de pago" y "como se compone esta deuda" (normalizadas sin tildes) y extraer el monto de 90+ días como el último `$X` de ese bloque. Si el bloque no se encuentra, hacer fallback al índice actual con un log de advertencia.

**BUG-01 — Columna incorrecta en `directOverdue90Days` (regex primario)**
Inspeccionar los PDFs de prueba locales (`cmf_16.173.618-K.pdf` e `informe_deudas_20285122-3.pdf`) con `pdftotext` antes de implementar para determinar la estructura real de la tabla de Deuda Directa. A partir de esa inspección:
- Si la tabla tiene 4 columnas de valor (Vigente, 30-59d, 60-89d, 90+d) seguidas de "Total" como etiqueta, el grupo 4 es 90+d → usar `totalRowMatch[4]`.
- Si la tabla tiene 5 columnas (Vigente, 30-59d, 60-89d, 90+d, Total-importe), usar suma de validación: verificar que la suma de los primeros 4 grupos sea aproximadamente igual al 5.º. Si hay discrepancia mayor al 1%, loguear advertencia y usar el 4.º grupo como 90+d.
- **No usar** la suma de validación como criterio primario de selección de columna — puede dar falsos positivos por redondeo. Usarla solo como check de sanidad.

**BUG-02 — `meetsAmountRequirement` ignora deuda indirecta**
Corregir para sumar `directOverdue90Days + indirectOverdue90Days` (extraer el equivalente de `overdue90DaysTotal` que representa la deuda indirecta en 90+d) antes de comparar contra `requiredAmountCLP`. Si no se puede aislar la deuda indirecta de 90+ días de forma confiable, usar `Math.max(directOverdue90Days, overdue90DaysTotal)` como cota conservadora.

---

### 2. Login y detección de ClaveÚnica

#### [MODIFY] [src/automation/login.ts](src/automation/login.ts)

**BUG-12 / BUG-16 — Clase `CredentialError` tipada**
Definir y exportar antes de la función `loginAndNavigateToStep1`:
```typescript
export class CredentialError extends Error {
  constructor(
    message: string,
    public readonly code: 'rut_incorrecto' | 'clave_unica_incorrecta'
  ) {
    super(message);
    this.name = 'CredentialError';
  }
}
```
Lanzar `new CredentialError(msg, 'rut_incorrecto')` o `new CredentialError(msg, 'clave_unica_incorrecta')` según corresponda, en lugar de `new Error('Alerta: ...')`.

**BUG-15 — Selectores parciales reemplazados por selectores exactos**
```typescript
// Antes (partial match — peligroso):
page.waitForSelector('text=Datos de acceso no', ...)
page.waitForSelector('text=Ingresa correctamente tu RUN', ...)

// Después (exact match):
page.waitForSelector('text="Datos de acceso no válidos"', ...)
page.waitForSelector('text="Ingresa correctamente tu RUN de 7 u 8 números más dígito verificador"', ...)
```
Si el texto exacto del portal no coincide perfectamente (whitespace, mayúsculas), usar `.locator(':text-is("...")')` como alternativa.

**BUG-14 — Portal caído no debe lanzar `CredentialError`**
Después del `Promise.race`, la lógica de detección debe ser:
1. Verificar explícitamente con `isVisible()` si está presente el selector de RUN inválido → lanzar `CredentialError(..., 'rut_incorrecto')`.
2. Verificar explícitamente con `isVisible()` si está presente el selector de acceso inválido → lanzar `CredentialError(..., 'clave_unica_incorrecta')`.
3. Si ninguno de los dos selectores es visible (portal caído, timeout, 503, mantenimiento) → lanzar `new Error('Error de autenticación no reconocido. URL actual: ' + page.url())` — error genérico que el worker reintentará.

```typescript
const isInvalidRun = await page.locator('text="Ingresa correctamente tu RUN..."').isVisible().catch(() => false);
const isInvalidAccess = await page.locator('text="Datos de acceso no válidos"').isVisible().catch(() => false);

if (isInvalidRun) {
  throw new CredentialError('RUT ingresado inválido.', 'rut_incorrecto');
} else if (isInvalidAccess) {
  throw new CredentialError('ClaveÚnica incorrecta.', 'clave_unica_incorrecta');
} else {
  throw new Error(`Error de autenticación no reconocido. URL actual: ${page.url()}`);
}
```

**BUG-21 — Logger en catch block**
```typescript
// Antes:
console.error(`[${new Date().toISOString()}] ✗ Error en login/navegación.`);

// Después:
if (logger) logger.error('✗ Error en login/navegación.', error);
else console.error(`[${new Date().toISOString()}] ✗ Error en login/navegación.`);
```

---

### 3. Worker

#### [MODIFY] [src/worker.ts](src/worker.ts)

**BUG-12 / BUG-16 — Detección estructurada de errores de credencial**
Importar `CredentialError` de `login.ts` y reemplazar todas las ocurrencias de `err.message?.includes('Alerta:')` y el parsing de string en español:
```typescript
import { CredentialError } from './automation/login';

// En el catch del retry loop:
const isValidationError = err instanceof CredentialError;

// En el bloque !success:
if (lastError instanceof CredentialError) {
  const alertType = lastError.code; // 'rut_incorrecto' | 'clave_unica_incorrecta'
  await createAlert(client.id, alertType, lastError.message, CLIENTS_TABLE, logger);
}
```

**BUG-20 — Pasar `CLIENTS_TABLE` a `createAlert` y `clearAlert`**
```typescript
await clearAlert(client.id, CLIENTS_TABLE, logger).catch(() => {});
// ...
await createAlert(client.id, alertType, lastError.message, CLIENTS_TABLE, logger);
```

---

### 4. Utilidad de alertas

#### [MODIFY] [src/utils/alerts.ts](src/utils/alerts.ts)

**BUG-20 — Nombre de tabla como parámetro**
Agregar `clientsTable: string` como tercer parámetro en ambas funciones:
```typescript
export async function createAlert(
  clientId: string,
  tipo: string,
  mensaje: string,
  clientsTable: string,
  logger: RunnerLogger
): Promise<void>

export async function clearAlert(
  clientId: string,
  clientsTable: string,
  logger: RunnerLogger
): Promise<void>
```
Reemplazar el literal `'clients'` por `clientsTable` en los `.from()`.

**BUG-19 — `mensaje` debe persistirse, no solo loguearse**
Guardar el mensaje en el log del worker (ya se hace vía `logger.log`) y adicionalmente incluirlo en el campo `credential_error` como JSON o en una columna separada. Opción pragmática para no requerir migración adicional: concatenar tipo y mensaje en el mismo campo:
```typescript
.update({ credential_error: `${tipo}: ${mensaje}` })
```
Esto permite que el operador lea el motivo completo desde Supabase sin necesidad de una columna extra.

---

### 5. Script de migración

#### [MODIFY] [src/utils/migrate_credential_error.ts](src/utils/migrate_credential_error.ts)

**BUG-22 — Eliminar `rejectUnauthorized: false`**
Reemplazar la conexión directa con `pg` por el cliente JS de Supabase que ya está configurado en el proyecto, o eliminar `rejectUnauthorized: false` y usar el certificado CA de Supabase. La migración ya incluye una instrucción SQL de fallback para ejecutar manualmente, así que si la conexión directa es problemática en el entorno actual, eliminar el bloque `pg` y dejar solo la instrucción de fallback como instrucción a ejecutar en el SQL Editor de Supabase.

---

### 6. Script de pruebas de credenciales

#### [MODIFY] [src/utils/test_invalid_credentials.ts](src/utils/test_invalid_credentials.ts)

**BUG-13 — Parser de `.env` roto para valores con `=`**
```typescript
// Antes:
return line ? line.split('=')[1].trim() : '';

// Después:
return line ? line.slice(key.length + 1).trim() : '';
```
Aplicar tanto en `getEnvValue` como verificar que `setEnvValue` no tenga el mismo problema (no lo tiene — ya usa template literal).

**BUG-17 — Espera post-`pm2 restart`**
Agregar 5 segundos de espera después de cada `execSync('pm2 restart superir-worker')` antes de continuar con el test:
```typescript
execSync('pm2 restart superir-worker');
await new Promise(r => setTimeout(r, 5000)); // esperar arranque del worker
```

**BUG-18 — Filtro de borrado de jobs por estado terminal**
```typescript
// Antes:
await supabase.from('automation_jobs').delete().eq('client_id', pato.id);

// Después:
await supabase.from('automation_jobs').delete()
  .eq('client_id', pato.id)
  .in('status', ['pending', 'success', 'failed']);
```

---

### 7. Pasos de automatización (Steps 2, 3, 4)

#### [MODIFY] [src/automation/step2_declaraciones.ts](src/automation/step2_declaraciones.ts)

**BUG-09 — URL check antes del `waitForSelector`**
Mover el bloque `if (!page.url().includes('renegociacion'))` para que sea lo primero que se ejecute dentro del `try`, antes del `waitForSelector`.

**BUG-08 — Logger en catch block**
```typescript
} catch (error) {
  if (logger) logger.error('✗ Error en Paso 2.', error);
  else console.error(`[${new Date().toISOString()}] ✗ Error en Paso 2.`);
  await screenshotOnFailure(page, 'step2');
  throw error;
}
```

#### [MODIFY] [src/automation/step3_acreedores.ts](src/automation/step3_acreedores.ts)

**BUG-09** — Mismo reordenamiento de URL check.

**BUG-05 — Selector de confirmación de upload con `:not(.hidden)`**
```typescript
// Antes:
await page.locator('#btnEliminarCMF, #btnVerCMF').first().waitFor({ state: 'attached', timeout: 45000 });

// Después:
await page.locator('#btnEliminarCMF:not(.hidden), #btnVerCMF:not(.hidden)').first()
  .waitFor({ state: 'attached', timeout: 45000 });
```

**BUG-07 — Estabilidad post-borrado en DRY_RUN cleanup**
Después de confirmar que `#btnEliminarCMF` está oculto, esperar a que el formulario vuelva a estar listo antes de tomar el screenshot:
```typescript
await page.locator('#btnEliminarCMF').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
await page.waitForSelector('#acreedoresRenegociacionForm', { timeout: 30000 }); // ← agregar esto
log('✓ Estado limpio tras eliminar Informe CMF.');
```

**BUG-06 — Timeout del modal de confirmación: 5s → 15s**
```typescript
await page.waitForSelector('#btnConfirmarModal', { state: 'visible', timeout: 15000 });
```

**BUG-08** — Mismo cambio de logger en catch.

#### [MODIFY] [src/automation/step4_apoderado.ts](src/automation/step4_apoderado.ts)

**BUG-09 y BUG-08** — Mismo reordenamiento de URL check y logger en catch.

---

## Plan de verificación

### Paso 1 — Compilación
```bash
npm run build
```
Debe compilar sin errores de TypeScript. Verificar especialmente que la firma de `createAlert`/`clearAlert` sea consistente entre `alerts.ts` y todos sus callers en `worker.ts`.

### Paso 2 — Parser CMF con PDFs reales
```bash
npx ts-node src/utils/test_cmf_parser.ts
```
Verificar con los dos PDFs locales (`cmf_16.173.618-K.pdf`, `informe_deudas_20285122-3.pdf`) que:
- `directOverdue90Days` extrae el monto correcto de la columna 90+d (no el total de la fila).
- `overdue90DaysTotal` extrae el monto del resumen sin depender del índice posicional.
- `meetsAmountRequirement` refleja la suma de deuda directa + indirecta en 90+d.
- Los logs muestran texto con tildes (texto original, no el normalizado).

### Paso 3 — Dry-run Step 3 (portal real)
Ejecutar el Step 3 en modo dry-run con un cliente de prueba para verificar:
- El upload del CMF espera correctamente a que `#btnEliminarCMF:not(.hidden)` aparezca.
- La limpieza post-borrado espera `#acreedoresRenegociacionForm` antes del screenshot.
- El modal de confirmación de borrado no hace timeout.

### Paso 4 — E2E detección de credenciales inválidas
```bash
npx ts-node src/utils/test_invalid_credentials.ts
```
Verificar que:
- TEST 1 (password incorrecta): job falla, `credential_error` se actualiza a `clave_unica_incorrecta: ...` (incluyendo mensaje).
- TEST 2 (RUT incorrecto): job falla, `credential_error` se actualiza a `rut_incorrecto: ...`.
- En ambos casos el worker no reintenta (1 solo intento).
- Posterior job exitoso con credenciales correctas limpia `credential_error` a `null`.
- Un error de red o portal caído genera `credential_error = null` y el job se reintenta 3 veces.
