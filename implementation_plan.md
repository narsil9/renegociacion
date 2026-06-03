# Plan de Implementación: Automatización Inteligente Paso 2 (Categoría Tributaria)

Este documento detalla el plan para automatizar la decisión del Paso 2 del portal de Renegociación basándose en el análisis automático de la **Carpeta Tributaria** (PDF) del cliente.

---

## 1. Objetivo y Reglas de Negocio

El Paso 2 del portal exige declarar la calidad de persona deudora y si tiene o no inicio de actividades de 1ra Categoría. Automatizaremos esta decisión analizando el contenido del PDF de la Carpeta Tributaria:

1. **Análisis del PDF**: Extraer el texto del PDF de la Carpeta Tributaria descargada.
2. **Determinación de Categoría**:
   - **Segunda Categoría**: Si el cliente no registra actividades de 1ra categoría comerciales vigentes.
     - *Acción en portal*: Marcar opción 1 (`#calidadPersonaDeudora1`): *"No tengo inicio de actividades comerciales de primera categoría..."*.
   - **Primera Categoría**: Si el cliente registra actividades de 1ra categoría comerciales.
     - *Acción en portal*: Marcar opción 2 (`#calidadPersonaDeudora2`): *"Sí tengo inicio de actividades comerciales de primera categoría..."*.
     - *Acción subsiguiente*: Marcar la opción de no emisión de documentos (`#inicioActividades1`): *"No he emitido documentos tributarios (boletas o facturas) en los últimos 24 meses"*.
3. **Carga de PDFs**: Subir la Carpeta Tributaria y los Agentes Retenedores correspondientes.

---

## 2. Propuesta Técnica y Cambios

### [NEW] [pdf_analyzer.ts](file:///Users/patomartini/Desktop/renegociacion/src/utils/pdf_analyzer.ts)
Crearemos un módulo analizador de PDF que:
- Ejecute la herramienta nativa `/opt/homebrew/bin/pdftotext` para extraer el texto completo del PDF.
- Busque palabras clave dentro del texto de la Carpeta Tributaria, por ejemplo:
  - Si contiene `"Primera Categoría"` o `"1ra Categoría"`, y no indica que están de baja o sin movimiento, clasificarlo como `'primera'`.
  - En caso contrario, clasificarlo como `'segunda'`.
- Retorne la categoría detectada (`'primera'` o `'segunda'`).

### [MODIFY] [step2_declaraciones.ts](file:///Users/patomartini/Desktop/renegociacion/src/automation/step2_declaraciones.ts)
Modificaremos la función `fillStep2` para:
1. Aceptar un parámetro `categoria: 'primera' | 'segunda'`.
2. Si `categoria === 'segunda'`:
   - Marcar `#calidadPersonaDeudora1`.
3. Si `categoria === 'primera'`:
   - Marcar `#calidadPersonaDeudora2`.
   - Marcar `#inicioActividades1` (para declarar la no emisión de documentos tributarios).
4. Subir ambos archivos PDF correspondientes.

### [MODIFY] [worker.ts](file:///Users/patomartini/Desktop/renegociacion/src/worker.ts)
1. Integrar el análisis del PDF tras descargar la Carpeta Tributaria:
   ```typescript
   const categoria = await analizarCategoriaTributaria(tributariaLocalPath, logger);
   ```
2. Pasar esta `categoria` a la función `fillStep2`.

---

## 3. Plan de Verificación

1. **Prueba de Extracción**: Ejecutar un script de prueba sobre la Carpeta Tributaria local para validar que extraiga el texto y detecte la categoría correcta.
2. **Prueba en Sandbox (Dry Run)**: Ejecutar el job de prueba del Paso 2 en el worker y revisar la captura de pantalla (`outputs/verify_step2_clean_...png`) para confirmar que se seleccionaron los radio buttons correctos según la categoría detectada.
