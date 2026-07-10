# `tools/mantenimiento/` — Herramientas reutilizables (prueba / mantenimiento)

Directorio **versionado** para las herramientas que se reutilizan para **probar** o **mejorar** la
automatización. NO son producción (el único entry de producción es `src/worker.ts`), pero se conservan
en git porque tienen valor recurrente — a diferencia de los scripts one-off de diagnóstico
(`inspect_*`, `check_*`, `migrate_*`, `scan_*`, …), que quedan **gitignored** en la raíz de `tools/`.

> Convención: `tools/` guarda tooling; sus subdirectorios **curados y versionados** son
> `paso3_validacion/` (batería determinista del Paso 3) y este `mantenimiento/`. El resto es local/one-off.
> Los scripts importan de `src/` (unidireccional) → quedan fuera del build de producción (`tsconfig.build.json`).

## Herramientas

### `limpieza_total.ts` — limpiar el borrador del portal tras una prueba
Inicia sesión con ClaveÚnica y borra del borrador de renegociación en el portal Superir los archivos del
**Paso 2** (Carpeta Tributaria + Agentes Retenedores) y **todos los acreedores + el Informe CMF del Paso 3**,
para poder re-correr el flujo real desde limpio. (No borra Paso 1 ni 4: solo se sobrescriben.)

```bash
npx ts-node -r dotenv/config tools/mantenimiento/limpieza_total.ts
# Otro cliente:
CLAVE_UNICA_RUT=12345678-9 npx ts-node -r dotenv/config tools/mantenimiento/limpieza_total.ts
```

### `project_case.ts` — proyector read-only `ton… → sandbox`
Materializa **un** caso del proyecto del abogado (`ton…`, solo lectura) al sandbox (`clients` +
`client_documents` + descarga de PDFs) para poder probar el worker como en producción. `MODE=stage|write`.

```bash
npx ts-node -r dotenv/config tools/mantenimiento/project_case.ts
```

### `run_projected_test.ts` — test E2E proyector → worker → portal
Encola un job del caso proyectado y verifica la corrida completa contra el portal.

```bash
npx ts-node -r dotenv/config tools/mantenimiento/run_projected_test.ts
```

## Qué NO va acá
- Scripts de un solo uso (inspección de esquema, chequeos de estado, migraciones de puerto, uploads
  puntuales): quedan en `tools/` (gitignored) o se descartan.
- Tests por cliente: viven en `casos/`.
- Batería de validación determinista del Paso 3: `tools/paso3_validacion/`.
