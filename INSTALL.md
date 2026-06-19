# INSTALL — Correr la automatización en otro computador

Guía para instalar y dejar corriendo el **worker** de la automatización Superir en una
máquina nueva (Mac Mini de producción u otro equipo).

> **Qué se instala acá:** solo el **worker** (este repo, `renegociacion`) — el daemon que
> pollea la cola y ejecuta la automatización (cadena de agentes → Playwright Pasos 1→4).
>
> **Qué NO se instala acá:** el **dashboard** (`rp_carga_documentos`) vive en **Vercel**; el
> abogado lo usa desde el navegador. Esta máquina solo necesita internet para alcanzar
> **Supabase + portal Superir + Anthropic** (todo HTTPS).

---

## Arquitectura (para ubicarse)

```
Abogado → Dashboard (Vercel, always-on) → Supabase sandbox (clients + automation_jobs + Storage)
                                                  ↑ pollea cada 5s
                            Worker daemon (ESTA máquina) → portal Superir (Pasos 1→4)
```

---

## 1. Requisitos del sistema (una sola vez por máquina)

Node.js 18+, git y los binarios de PDF/OCR que usa la automatización
(**poppler** = `pdftotext`/`pdftoppm`, **tesseract** con español, **ghostscript**).

**macOS** (Mac Mini):
```bash
brew install node git poppler tesseract tesseract-lang ghostscript
```

**Ubuntu / Debian**:
```bash
sudo apt update && sudo apt install -y nodejs npm git poppler-utils \
  tesseract-ocr tesseract-ocr-spa ghostscript
```

Verificar:
```bash
node -v && pdftotext -v && tesseract --version && gs --version
```

---

## 2. Instalar el worker

```bash
git clone <URL_DEL_REPO> renegociacion
cd renegociacion
npm install
npx playwright install chromium          # en Linux además: npx playwright install-deps chromium
```

---

## 3. Crear el archivo `.env` (NO está en git — hay que crearlo a mano)

En la raíz del repo, un archivo `.env` con (mínimo de producción):

```
SUPABASE_URL=https://fnzdruyojclfannkwyqe.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key del sandbox>
ANTHROPIC_API_KEY=sk-ant-...
HEADLESS=true
```

Reglas importantes:
- **NO** poner en producción: `BYPASS_DATE_CHECK`, `BYPASS_DATE_VALIDATION`, `BYPASS_RUT_CHECK`,
  `DISABLE_SENTINEL`, `FORCE_VISION_MAPEADOR` (desactivan validaciones críticas; el worker
  avisa ruidoso si detecta alguna activa).
- `PROD_SUPABASE_URL` / `PROD_SUPABASE_SERVICE_ROLE_KEY`: solo si se van a leer credenciales
  desde `renegociacion_overrides` del proyecto del abogado. En sandbox-como-producción no hacen falta.
- `CLAVE_UNICA_RUT` / `CLAVE_UNICA_PASSWORD`: solo para el cliente de prueba `21917363-6`.
  Los clientes reales traen su propia ClaveÚnica en la tabla `clients` (la carga el dashboard).
- Forma más simple y segura: **copiar el `.env` de la máquina actual** al nuevo equipo por un
  canal seguro (no commitearlo nunca).

---

## 4. Encender (deja el worker corriendo)

```bash
bash scripts/sistema.sh start
```

El script es idempotente y portátil: instala dependencias si faltan, corre
`playwright install chromium`, valida que exista `.env`, y arranca el worker — con **pm2**
si está instalado (auto-restart + arranque al boot) o con `nohup` en background si no.

---

## 5. Que sobreviva reinicios y no se duerma

```bash
npm i -g pm2     # opcional pero recomendado en el servidor
pm2 startup      # seguir la instrucción que imprime (1 sola vez) → el worker arranca al bootear
```

- La máquina debe quedar **encendida, con internet y SIN dormir**:
  - macOS: `caffeinate -dimsu` (o Ajustes → Energía → nunca dormir).
  - Linux: deshabilitar suspensión.

---

## 6. Operar / verificar

```bash
bash scripts/sistema.sh status    # ¿worker vivo? + últimas líneas del log
bash scripts/sistema.sh logs      # seguir el log en vivo
bash scripts/sistema.sh stop      # apagar el worker
```

Cuando el abogado cargue un caso desde el dashboard, el worker (corriendo acá) lo toma de la
cola `automation_jobs` en pocos segundos y ejecuta los Pasos 1→4 en el portal.

---

## Build de producción (opcional)

Para generar un artefacto compilado solo-producción (sin los scripts dev de `tools/`):
```bash
npm run build:prod      # compila el grafo de src/worker.ts → dist/
```
El worker se corre normalmente con `bash scripts/sistema.sh start` (usa `ts-node`); el build
es útil si se quiere deployar `dist/` ya compilado.

---

## Estructura del repo (referencia)

- `src/` — **código de producción** (worker + automation + agents + 13 utils del grafo del worker).
- `tools/` — scripts dev/diagnóstico/one-off (NO producción).
- `casos/` — pruebas por cliente.
- `scripts/sistema.sh` — encender/apagar/estado del worker.
- `supabase/` — migraciones (`migration_sandbox_v4.sql`) y `portal_select_values.json`.

## Problemas comunes

| Síntoma | Causa probable | Fix |
|---|---|---|
| `Missing SUPABASE_URL...` | falta `.env` o las claves | crear `.env` (paso 3) |
| Falla al lanzar el navegador | falta el binario de Playwright | `npx playwright install chromium` (Linux: `install-deps`) |
| OCR/PDF falla | falta poppler/tesseract/ghostscript | reinstalar requisitos del sistema (paso 1) |
| Jobs quedan en `pending` y no pasa nada | el worker no está corriendo | `bash scripts/sistema.sh start` |
| Login al portal falla | ClaveÚnica inválida del cliente | revisar `clients.clave_unica_password` (o `.env` para el cliente de prueba) |
