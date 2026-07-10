# INSTALL — Dejar el worker corriendo en una máquina

Guía para instalar y dejar corriendo el **worker** de la automatización Superir en una máquina
(un Mac Mini, un servidor Linux, o tu laptop para probar).

> **Qué se instala acá:** solo el **worker** — el daemon (un proceso) que pollea la cola
> `automation_jobs` en Supabase y ejecuta la automatización (cadena de agentes → Playwright
> Pasos 1→5). El **dashboard** (tu UI) es aparte y solo necesita hablar con la misma base
> Supabase — ver [`docs/integracion/dashboard-externo.md`](docs/integracion/dashboard-externo.md).
>
> La máquina solo necesita internet para alcanzar **Supabase + portal Superir + Anthropic** (HTTPS).

---

## 0. Base de datos (una sola vez, antes de todo)

Creá un proyecto en [supabase.com](https://supabase.com) y, en su **SQL Editor**, pegá y corré
[`supabase/setup.sql`](supabase/setup.sql). Crea todas las tablas y los buckets de Storage que el
worker necesita. Es idempotente (podés re-correrlo). Guardá `SUPABASE_URL` y la `service_role key`
(Project Settings → API) para el `.env`.

---

## 1. Requisitos del sistema (una vez por máquina)

Node.js 18+, git y los binarios de PDF que usa la automatización (**poppler** = `pdftotext`/`pdftoppm`,
**ghostscript** para comprimir PDFs). No se necesita OCR (el LLM lee los PDF de forma nativa).

**macOS:**
```bash
brew install node git poppler ghostscript
```

**Ubuntu / Debian:**
```bash
sudo apt update && sudo apt install -y nodejs npm git poppler-utils ghostscript
```

Verificar:
```bash
node -v && pdftotext -v && gs --version
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

## 3. Crear el `.env` (no está en git)

En la raíz del repo, un `.env` con el mínimo de producción:

```
SUPABASE_URL=https://<tu-proyecto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
ANTHROPIC_API_KEY=sk-ant-...
HEADLESS=true
```

Reglas:
- **NUNCA en producción:** `DRY_RUN`, `BYPASS_DATE_CHECK`, `BYPASS_DATE_VALIDATION`,
  `BYPASS_RUT_CHECK`, `DISABLE_SENTINEL`, `FORCE_VISION_MAPEADOR` (desactivan validaciones
  críticas; el worker avisa ruidoso si detecta alguna activa). El modo prueba se controla
  **por job** con `automation_jobs.dry_run`, no con variables de entorno.
- Opcionales: `WORKER_CONCURRENCY` (jobs en paralelo, default 1); `PROD_SUPABASE_URL` /
  `PROD_SUPABASE_SERVICE_ROLE_KEY` (solo si leés credenciales de un sistema externo por `airtable_id`).
- Las credenciales ClaveÚnica de cada cliente van en la tabla `clients` (las carga tu dashboard),
  no en el `.env`. Ver `.env.example` para la lista completa.

---

## 4. Encender (deja el worker corriendo)

```bash
bash scripts/sistema.sh start
```

Idempotente y portátil: instala dependencias si faltan, corre `playwright install chromium`,
valida que exista `.env`, y arranca el worker — con **pm2** si está instalado (auto-restart +
arranque al boot) o con `nohup` en background si no.

---

## 5. Que sobreviva reinicios y no se duerma

```bash
npm i -g pm2     # recomendado en un servidor
pm2 startup      # seguir la instrucción que imprime (1 vez) → el worker arranca al bootear
```

La máquina debe quedar **encendida, con internet y SIN dormir**:
- macOS: `caffeinate -dimsu` (o Ajustes → Energía → nunca dormir).
- Linux: deshabilitar suspensión.

---

## 6. Operar / verificar

```bash
bash scripts/sistema.sh status    # ¿worker vivo? + últimas líneas del log
bash scripts/sistema.sh logs      # seguir el log en vivo
bash scripts/sistema.sh stop      # apagar el worker
```

Cuando tu dashboard encole un job (fila en `automation_jobs`), el worker lo toma en pocos segundos
y ejecuta los Pasos 1→5 en el portal. El resultado vuelve en `automation_jobs.status` /
`automation_alerts` (ver el contrato de integración).

---

## Build de producción (opcional)

```bash
npm run build:prod      # compila solo el grafo de src/worker.ts → dist/
```
El worker corre normalmente con `bash scripts/sistema.sh start` (usa `ts-node`); el build es útil
si querés deployar `dist/` ya compilado.

---

## Problemas comunes

| Síntoma | Causa probable | Fix |
|---|---|---|
| `Missing SUPABASE_URL...` | falta `.env` o las claves | crear `.env` (paso 3) |
| Falla al lanzar el navegador | falta el binario de Playwright | `npx playwright install chromium` (Linux: `install-deps`) |
| Error leyendo/comprimiendo PDF | falta poppler/ghostscript | reinstalar requisitos (paso 1) |
| Jobs quedan en `pending` y no pasa nada | el worker no está corriendo | `bash scripts/sistema.sh start` |
| Login al portal falla | ClaveÚnica inválida del cliente | revisar `clients.clave_unica_password` |
| El caso queda `blocked` | no cumple un requisito de fondo (ver alerta) | revisar `automation_alerts` — no es un error del worker |
