# 🧠 Conocimiento aprendido del procedimiento — base viva, dividida por paso

> **Qué es esto.** Acá acumulamos, **prueba por prueba**, lo que vamos aprendiendo sobre cómo
> automatizar correctamente cada paso del portal Superir — para luego **inyectárselo a los agentes**
> (el Centinela en el Paso 3, el agente de ingresos en el Paso 5, etc.) y que **no vuelvan a cometer
> los mismos errores**. Es la "memoria de lecciones" del sistema: aprende por **contexto** (no
> reentrenando el modelo), acumulando reglas **validadas contra la verdad-terreno** (cómo declaró el
> caso el/la abogado/a en los screenshots).

## Estructura (dividida por paso del portal)

| Archivo | Paso del portal | Consumidor (a futuro, vía inyección en el prompt) |
|---|---|---|
| [`principios-generales.md`](principios-generales.md) | Transversal (aplica a todo) | Todos los agentes |
| [`paso3-acreedores.md`](paso3-acreedores.md) | Paso 3 — Acreedores (260/261) | Centinela (`sentinel.ts`) |
| [`paso5-ingresos.md`](paso5-ingresos.md) | Paso 5 — Ingresos | Agente de ingresos (`ingresos_agent.ts` + `income_extractor.ts`) |

> A medida que trabajemos un paso nuevo, se agrega su archivo `pasoN-<nombre>.md` y se suma a esta tabla.

## Reglas para agregar una lección (importante)

1. **General, no per-caso.** La lección sirve para CUALQUIER cliente; el caso concreto es solo el
   **testigo** que la reveló (regla rectora del proyecto).
2. **Validada contra la verdad-terreno.** Solo se confía si se comparó contra lo que hizo el abogado.
   Una lección equivocada "envenena" las corridas futuras → marcar `estado` (`validada` / `pendiente`).
3. **Concisa.** Va a entrar en el prompt del agente; una o dos líneas por lección.
4. **Cert-first y "el LLM no decide la estructura".** Las lecciones mejoran cómo el LLM **extrae
   hechos**; la estructura (260/261, split, override, montos de ingreso, etc.) la blinda TypeScript.

**Formato por lección:** `Ln — Título` · **regla general** · *(testigo: caso)* · estado · fecha.

## Cómo se usará (pendiente de cablear)

1. Correr un caso → comparar contra la verdad-terreno (arnés `casos/_shared/compare_vs_baseline.ts`).
2. De cada divergencia, extraer una **lección** → curarla → guardarla en el archivo del paso que
   corresponde.
3. En cada corrida futura, las lecciones de ese paso se **inyectan en el prompt del agente** →
   el robot ya "sabe" lo aprendido y mejora.
