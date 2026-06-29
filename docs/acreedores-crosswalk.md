# Crosswalk de acreedores — CMF / cert ↔ `acreedores_canonicos` ↔ RUT

> **Qué es.** Registro vivo que relaciona **cómo aparece cada acreedor en los documentos**
> (Informe CMF, certificados de bancos) con su **nombre canónico** en la tabla
> `acreedores_canonicos` y su **RUT** (la tabla trae además dirección y representante legal).
>
> **Para qué.** Mejorar progresivamente `acreedores_canonicos` y los **aliases** de
> `src/utils/acreedor_matcher.ts`: cada vez que un nombre del CMF/cert NO matchea el catálogo,
> se registra acá con el RUT correcto y la acción (alias nuevo / fila nueva en el catálogo).
> El RUT es la **llave dura** — con él, el matching no depende de cómo esté escrito el nombre.
>
> **Fuente del RUT/rep. legal:** `acreedores_canonicos` de prod `ton…` (501 filas, con
> `representante_legal`/`rut_representante`). ⚠️ Verificar que **nuestro catálogo (sandbox `fnz…`)**
> tenga la misma fila — puede faltar (ej. CCAF Los Andes).
>
> **Cómo extenderlo:** por cada caso nuevo, agregar las instituciones cuyo nombre del CMF/cert
> no calce 1:1 con el catálogo. No borrar filas; marcar el estado.

## ⭐ REGLA DE ORO — verificar el RUT antes de asociar un alias

> **Antes de agregar un nombre alternativo a una fila del catálogo, hay que estar SEGURO de que
> el RUT de esa fila corresponde a la MISMA empresa que el alias está referenciando.** Un alias
> mal puesto manda la deuda al acreedor equivocado (con su RUT, dirección y representante legal).

Cómo verificar, en orden de confianza:
1. **RUT del emisor impreso en el certificado** del propio acreedor (fuente más fuerte; ej. CCAF Los Andes 81.826.800-9 salió del cert). Si el cert trae el RUT, ese manda.
2. **Catálogo del abogado** (`acreedores_canonicos`) cuando hay **una sola** entidad de esa empresa — asociación razonable.
3. ⚠️ **Cuidado con nombres parecidos de empresas distintas**: "Banco Falabella" ≠ "Promotora CMR Falabella"; "Banco Ripley" ≠ "CAR S.A."; "Santander" (banco) ≠ "Santander Consumer". Mismo grupo, RUT distinto → NO mezclar.
4. Si NO se puede verificar el RUT (cert no lo imprime y hay ambigüedad de entidad) → **marcar el alias como pendiente de confirmación**, no asumir.

## Convención de estados
- ✅ **OK** — el nombre del CMF matchea el canónico (directo o por token); nada que hacer.
- 🟡 **ALIAS** — misma entidad, distinto string → falta un alias en `acreedor_matcher.ts`.
- 🔴 **FALTA** — la entidad no está en `acreedores_canonicos` → agregar fila (nombre + RUT + datos).

---

## Tabla de crosswalk

| Nombre en CMF | Nombre en cert/doc | Canónico en `acreedores_canonicos` | RUT | Representante legal | Estado / acción |
|---|---|---|---|---|---|
| Banco Santander-Chile | Certificado Ley 20.130 Santander | Banco Santander | 97036000-K | Claudio Melandri Hinojosa | ✅ (verificar alias `santander-chile` → `banco santander`) |
| Promotora CMR Falabella S.A. | Estado de Cuenta CMR | Promotora CMR Falabella S.A. | 90743000-6 | Claudio Cisternas Duque | ✅ |
| Banco de Crédito e Inversiones | EECC tarjeta (term. 2449) | Banco de Crédito e Inversiones | 97006000-6 | Guillermo Olavarría Leyton | ✅ |
| CAR S.A. (1) | Banco Ripley Mastercard (cta. 4546) | CAR S.A. (Tarjeta Ripley) | 83187800-2 | Carolina Pérez Echeverría | ✅ ⚠️ ojo: CAR S.A. ≠ "Banco Ripley" (entidades distintas) |
| Banco Falabella | Línea de crédito Falabella | Banco Falabella | 96509660-4 | Juan Manuel Matheu | ✅ ⚠️ el resolver tiende a confundir la línea con "CMR Falabella" |
| **Tenpo Payments S.A.** | EECC Tenpo (cupo $13M) | **Tenpo Prepago SA** | **76967692-9** | — | 🟡 **ALIAS**: `tenpo payments` y `tenpo prepago` → misma clave `tenpo` |
| **Santander Consumer Finance Limitada** | Cartola Operación (crédito auto) | **Santander Consumer Chile S.A.** | **76002293-4** | — | 🟡 **ALIAS**: `santander consumer finance` → `santander consumer chile` |
| **Caja de Compensación de Asignación Familiar Los Andes** | Certificado de deuda Caja Los Andes | **— (no está en el catálogo)** | **81826800-9** | — | 🔴 **FALTA**: agregar fila "CCAF Los Andes" + alias de la forma larga del CMF |

---

## Acciones pendientes derivadas (catálogo + aliases)

1. **Alias Tenpo** (`acreedor_matcher.ts`): `tenpo payments` y `tenpo prepago` → `tenpo`. (CMF dice "Tenpo Payments S.A."; catálogo tiene "Tenpo Prepago SA", RUT 76967692-9.)
2. **Alias Santander Consumer**: `santander consumer finance` / `santander consumer finance limitada` → `santander consumer chile`. (RUT 76002293-4.)
3. **CCAF Los Andes — agregar al catálogo** (sandbox `fnz…`): nombre "CCAF Los Andes", RUT **81826800-9**, + alias de la forma larga del CMF ("Caja de Compensación de Asignación Familiar Los Andes"). *(Ya documentado como gap recurrente en otros casos — ver memoria `project_catalog_name_gaps`.)*
4. **Reconciliar prod vs sandbox**: confirmar que las filas/RUT de arriba existan también en el catálogo del sandbox que usa el worker (no solo en prod).
5. **Desambiguación Falabella** (resolver): "Banco Falabella" (banco, RUT 96509660-4) vs "Promotora CMR Falabella" (tarjeta, RUT 90743000-6) — distinguir por **RUT del emisor**, no por la keyword "Falabella".

---

## Nota sobre consumir la tabla de clasificación del supervisor

`renegociacion_documento_match` (prod) ya clasifica cada documento → acreedor con los **nombres
alineados al CMF** (ej. "Tenpo Payments S.A.", "Santander Consumer Finance Limitada"). Es la
fuente ideal para **construir y validar este crosswalk**. ⚠️ Pero está keyeada por `drive_file_id`
(Google Drive) y `documentos_drive` suele venir vacío → **no hay puente confiable por documento**
hacia los archivos que bajamos de `renegociacion_audit_pdf`. Por eso hoy se usa como **referencia**
para mejorar el catálogo/aliases, no como input runtime por-documento.
