# Superintendencia Renegociación - Automatización Híbrida

> Sistema de automatización modular para solicitudes de renegociación de deudas en la Superintendencia de Insolvencia y Reemprendimiento (Superir), diseñado para abogados y ejecutado en un servidor Mac Mini remoto.

---

## Arquitectura del Sistema

```
┌──────────────────────┐      ┌──────────────────┐      ┌──────────────────────┐
│  Dashboard del       │◀────▶│ Supabase (DB)    │◀────▶│   Mac Mini Bot       │
│  Abogado (externo)   │      │ & Storage        │      │  (Node + Playwright) │
└──────────────────────┘      └──────────────────┘      └──────────────────────┘
```

- **Dashboard Web** (repo separado `rp_renegociaciones`): Panel del abogado para cargar documentos (`/subir-caso`) y encolar jobs. No vive en este repo.
- **Supabase**: Fuente de verdad de clientes, credenciales, cola de trabajos (`pato_prueba_automation_jobs`), documentos de acreditación (`client_documents`) y Storage de PDFs.
- **Mac Mini Bot**: Worker Node.js que consume la cola, ejecuta los pasos de Playwright, y escribe resultados/capturas de pantalla de vuelta a Supabase.

---

## Componentes Clave

| Componente | Archivo | Descripción |
|---|---|---|
| Worker daemon | `src/index.ts` | Polling de `pato_prueba_automation_jobs`; despacha pasos |
| Sentinel (API #1) | `src/utils/sentinel.ts` | Pre-valida mora y reclasifica acreedores usando documentos del banco |
| Orquestador Cognitivo | `src/utils/cognitive_orchestrator.ts` | Mapea certificados de acreditación a acreedores (Claude + thinking) |
| Analizador CMF | `src/utils/cmf_analyzer.ts` | Extrae deudas estructuradas del informe CMF en PDF |
| Analizador PDF | `src/utils/pdf_analyzer.ts` | Categoría tributaria, F29, extracción de texto |
| Matcher de acreedores | `src/utils/acreedor_matcher.ts` | Normalización de nombres y lookup de RUT en catálogo |
| Paso 1 | `src/automation/step1_personal.ts` | Información personal (con bypass de modal Bootstrap) |
| Paso 2 | `src/automation/step2_declaraciones.ts` | Declaraciones tributarias (subida de PDFs, auto-cleanup en dry-run) |
| Paso 3 | `src/automation/step3_acreedores.ts` | Acreedores Art. 260 / 261, adjunta documentos de acreditación |
| Paso 4 | `src/automation/step4_apoderado.ts` | Datos del apoderado |

---

## Directorio del Proyecto

```
renegociacion/
├── CLAUDE.md                          # Arquitectura, reglas críticas y tablas DB
├── task.md                            # Tareas pendientes y completadas
├── src/
│   ├── index.ts                       # Worker daemon (cola → despacha pasos)
│   ├── automation/                    # Scripts modulares de Playwright
│   │   ├── login.ts
│   │   ├── step1_personal.ts
│   │   ├── step2_declaraciones.ts
│   │   ├── step3_acreedores.ts
│   │   ├── step4_apoderado.ts
│   │   └── all_steps.ts
│   └── utils/                         # Módulos reutilizables (todos los casos)
│       ├── cognitive_orchestrator.ts  # IA → mapeo de certificados
│       ├── sentinel.ts                # IA → pre-validación de mora
│       ├── cmf_analyzer.ts
│       ├── pdf_analyzer.ts
│       ├── acreedor_matcher.ts
│       ├── pdf_optimizer.ts
│       ├── date_helper.ts
│       ├── logger.ts
│       ├── limpieza_total.ts          # Limpia borrador del portal (Pasos 2 y 3)
│       └── browser.ts / supabase.ts / supabaseWorker.ts
├── casos/                             # Carpeta por cliente (multi-cliente)
│   ├── claudia_silva/
│   │   ├── documentos/                # PDFs del cliente (CMF, acreditaciones, SII)
│   │   ├── analisis_deudas.md         # Análisis de elegibilidad y estado de acreditación
│   │   ├── instrucciones_sentinel.md  # Instrucciones específicas para el Sentinel
│   │   ├── instrucciones_orchestrator.md
│   │   ├── test_mapping.md
│   │   ├── setup_test.ts              # Sube documentos del caso al perfil de prueba en Supabase
│   │   ├── upload_documents.ts
│   │   ├── upload_acreedores.ts
│   │   └── test_step3.ts
│   └── alejandra_espinoza/
│       ├── documentos/
│       ├── análisis_deudas.md
│       └── setup_test.ts
├── outputs/                           # Capturas de pantalla, HTML y logs de ejecución
│   └── acreditaciones_tmp/            # PDFs de certificados descargados temporalmente
└── .claude/
    ├── commands/prime.md              # /prime — carga contexto al inicio de sesión
    ├── commands/session-sync.md       # /session-sync — actualiza docs al fin de sesión
    └── skills/renegociacion-automation/SKILL.md
```

---

## Estructura Multi-Cliente

Cada cliente tiene su carpeta en `casos/[nombre]/` con sus documentos, scripts de setup y análisis. La BD sandbox usa `rut UNIQUE` como identificador de fila — cada cliente real tiene su propia fila. Las pruebas del portal siempre usan las credenciales ClaveÚnica de Pato (`.env`), independientemente del cliente.

```
# Claudia Silva → perfil BD: Patricio Martini (client_id: a9ddf715-...)
# Alejandra Espinoza → perfil BD: fila propia con RUT 18.738.680-2
```

---

## Comandos Principales

```bash
# Correr un paso para un RUT específico (modo manual)
npm run automate -- --rut=12345678-9 --step=2

# Iniciar el worker daemon (modo producción/cola)
npm run worker

# Compilar TypeScript
npm run build

# Setup de un caso en Supabase (subir CMF y tributaria)
npx ts-node -r dotenv/config casos/claudia_silva/setup_test.ts
npx ts-node -r dotenv/config casos/alejandra_espinoza/setup_test.ts

# Subir certificados de acreditación de un caso
npx ts-node -r dotenv/config casos/claudia_silva/upload_acreedores.ts

# Test Paso 3 hardcodeado (sin worker ni créditos de API reales)
BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/claudia_silva/test_step3.ts

# Limpieza total del borrador del portal (antes de re-testear)
npx ts-node -r dotenv/config src/utils/limpieza_total.ts
```

---

## Variables de Entorno (`.env`)

```
HEADLESS=false                  # false = browser visible (MacBook Air)
DRY_RUN=true                    # true = no guardar formularios
CLAVE_UNICA_RUT=21917363-6      # RUT del perfil de prueba en el portal
CLAVE_UNICA_PASSWORD=...
SUPABASE_URL=...                # Sandbox
SUPABASE_SERVICE_ROLE_KEY=...
PROD_SUPABASE_URL=...           # Producción (solo lectura)
PROD_SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...           # Claude (Sentinel + Orquestador)
ENABLE_SENTINEL=false           # true = activar pre-validación IA
BYPASS_DATE_CHECK=true          # Omite chequeo de antigüedad de docs (solo tests)
```
