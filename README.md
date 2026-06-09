# Superintendencia Renegociación - Automatización Híbrida

> Sistema de automatización modular de 8 pasos para solicitudes de renegociación de deudas en la Superintendencia de Insolvencia y Reemprendimiento (Superir), diseñado para abogados y ejecutado en un servidor Mac Mini remoto.

Este proyecto implementa una **automatización híbrida y asistida** mediante la cual los abogados pueden rellenar pasos específicos de una solicitud usando un Dashboard remoto, interactuar con el portal mediante cookies de sesión compartidas y resolver pasos complejos de forma manual.

---

## Arquitectura del Sistema

El sistema consta de tres componentes principales:

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Dashboard Web   │◀────▶│ Supabase (DB)    │◀────▶│   Mac Mini Bot   │
│  (PC del Abogado)│      │ & Cookie Storage │      │  (Node+Playwright)│
└──────────────────┘      └──────────────────┘      └──────────────────┘
```

1. **Dashboard Web (Next.js/React)**: El panel donde el abogado selecciona al cliente, activa la automatización de un paso específico, revisa capturas de pantalla de la ejecución y obtiene un enlace autenticado. Incluye la vista **"Carga de Documentos"** (`/subir-caso`) para adjuntar el CMF y los certificados de deuda/vencimiento de un cliente existente; los archivos se suben a Supabase Storage y `client_documents`, que el worker consume en el Paso 3.
2. **Base de Datos y Almacenamiento (Supabase)**: Guarda los datos de entrada del cliente, las capturas de pantalla de la automatización y las **cookies de sesión** extraídas por el bot.
3. **Servidor de Automatización (Mac Mini)**: Ejecuta Playwright para rellenar los datos de manera rápida, simular interacciones complejas, tomar capturas del portal y exportar las cookies.

---

## Flujo Híbrido de Trabajo (Alternado)

Para lograr un sistema a prueba de balas y rápido, el abogado y el bot ejecutan turnos:

1. **Relleno Automático (Paso 1 - Información Personal)**: El bot inicia sesión con ClaveÚnica, rellena el Paso 1 y lo guarda en el portal (usando un bypass directo de formulario en caso de fallos del modal de Bootstrap).
2. **Relleno Automático (Paso 2 - Declaraciones)**: El bot descarga la Carpeta Tributaria y Agentes Retenedores de Supabase, analiza mediante `pdftotext` la categoría tributaria del contribuyente (Primera o Segunda), marca las opciones adecuadas, realiza la subida de los PDFs y en modo `Dry Run` los elimina al finalizar para mantener el borrador limpio.
3. **Relleno de Deudas (Paso 3 - Acreedores)**: El bot lee las deudas estructuradas en la base de datos (extraídas de la CMF) y las digita automáticamente.

---

## Directorio del Proyecto

```
renegociacion/
├── CLAUDE.md                      # Instrucciones de memoria del proyecto
├── README.md                      # Documentación general (este archivo)
├── package.json                   # Dependencias de Node.js y scripts
├── .env                           # Variables de entorno locales (credenciales)
├── .claude/
│   ├── settings.json              # Configuración y hooks de Claude Code
│   └── skills/
│       └── renegociacion-automation/
│           └── SKILL.md           # Guía de depuración y selectores para la IA
└── src/
    ├── automation/                # Scripts modulares de Playwright
    │   ├── login.ts               # Login en ClaveÚnica y guardado de cookies
    │   ├── step1_personal.ts      # Relleno del Paso 1 (con bypass de modal)
    │   ├── step2_declaraciones.ts # Relleno del Paso 2 (con subida y análisis de PDF)
    │   └── step3_acreedores.ts    # Relleno del Paso 3
    └── utils/
        ├── browser.ts             # Inicialización y config de Playwright
        └── supabase.ts            # Cliente de base de datos Supabase
```

---

## Primeros Pasos

### Requisitos Previos
- Node.js (versión 18 o superior)
- Mac Mini (para la ejecución remota)

### Instalación
```bash
# Clonar e ingresar al repositorio
git clone <url-repositorio>
cd renegociacion

# Instalar dependencias
npm install

# Instalar navegadores de Playwright
npx playwright install chromium
```

### Ejecutar Automatización por Consola
```bash
# Rellenar paso 1 para un RUT específico
npm run automate -- --rut=12345678-9 --step=1
```