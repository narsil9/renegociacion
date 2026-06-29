# Caso Jorge Andrés Romero Manuguian — testigo del Paso 5 (Ingresos)

Primer caso del **Paso 5 (Ingresos)**. Asalariado con contrato (empleador EQUISOFT).
RUT cliente: 15.842.968-3. Carpeta local: `~/Desktop/JORGE ANDRES ROMERO MANUGUIAN`.

## Documentos del Paso 5 (en la carpeta)

| Documento | Ruta | Destino portal |
|---|---|---|
| 3 liquidaciones (Mar/Abr/May 2025) | `Ingresos/Contrato de trabajo o últimas 3 liquidaciones.../LIQUIDACIONES JORGE ROMERO.pdf` | Justificativo `tipoAntecedente=28` |
| Certificado de Cotizaciones (AFP ProVida) | `Ingresos/Certificado de cotizaciones.../Cotizaciones.pdf` | Upload obligatorio aparte |

Las liquidaciones son **escaneo** (0 caracteres de texto) → se leen NATIVAMENTE por Claude.

## Verdad-terreno (audio del abogado + lectura nativa)

| Mes | "Líquido a pagar" |
|---|---|
| Marzo-2025 | 2.162.761 |
| Abril-2025 | 2.162.042 |
| Mayo-2025 | 2.161.887 |
| **Promedio /3** | **$2.162.230** |

- Ingreso declarado: **Remuneración (tipo 1)**, monto **$2.162.230**, **periodicidad Mensual (4)**.
- Doc justificativo: **3 últimas liquidaciones de sueldo (tipo 28)**.
- Sin descuentos voluntarios (solo AFP/salud/cesantía/impuesto = legales).
- Cert cotizaciones: ProVida, emitido **2025-05-22**, RUT empleador **59.212.930-2**.

> Reglas generales aprendidas → `lecciones/paso5-ingresos.md` (L1 líquido a pagar, L2 descuentos
> voluntarios, L3 promedio por tipo, L4 periodicidad mensual, L5 lectura nativa, L6 cert 30d, L7 crosswalk).

## Scripts

```bash
# 1) Extractor determinista contra verdad-terreno (sin API) — debe dar $2.162.230
npx ts-node --transpile-only -r dotenv/config casos/jorge_romero/test_extractor.ts

# 2) Lectura NATIVA real por Claude (GASTA API) — Claude lee el escaneo y extrae los líquidos
npx ts-node --transpile-only -r dotenv/config casos/jorge_romero/test_agent_nativo.ts

# 3) E2E contra el portal (login ClaveÚnica de Pato, DRY_RUN no envía)
DRY_RUN=true npx ts-node --transpile-only -r dotenv/config casos/jorge_romero/test_step5.ts
```

## Estado

✅ **E2E validado (2026-06-29)**: extractor exacto + lectura nativa exacta + portal real cargó el
ingreso, el justificativo (tipo 28) y el cert de cotizaciones (captura en `outputs/verify_step5_*.png`).

⚠️ Nota: `fillStep5` en DRY_RUN saca captura pero NO limpia el borrador (deja las filas/archivos del
Paso 5 cargados en el cliente de prueba). Re-correr sobrescribe; limpieza manual si se necesita vacío.
