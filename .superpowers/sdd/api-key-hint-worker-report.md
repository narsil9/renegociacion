# api_key_hint en registrarConsumo — reporte

## Qué cambia

`src/utils/document_reads.ts`:
- `API_KEY_HINT` (const de módulo, calculada una sola vez al importar el archivo):
  `process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.slice(-4) : null`.
- `registrarConsumo` acepta `ctx.apiKeyHint?: string | null`. En el insert:
  `api_key_hint: ctx.apiKeyHint !== undefined ? ctx.apiKeyHint : API_KEY_HINT`.
  Ningún llamador de los 6 call sites pasa `apiKeyHint` hoy, así que todos heredan el
  default derivado del entorno sin tocarlos — el arreglo vive en un solo lugar.
- Todo dentro del mismo `try/catch` que ya envolvía el insert: un fallo en el cálculo del
  hint (no debería haberlo, es una `String.slice`) no puede romper el flujo del worker.
- Sin `ANTHROPIC_API_KEY`, el hint queda `null` y la fila se inserta igual (no desaparece).
- Solo se guardan 4 caracteres, nunca la key completa ni un prefijo, y nunca se loguea la key.

## Cómo llega el default solo

Los 6 call sites (`tributario_agent.ts`, `ingresos_agent.ts`, `sentinel.ts`,
`cognitive_orchestrator.ts`, `sentinel_per_doc.ts`, y la llamada interna dentro de
`registrarLectura`) siguen construyendo su `ctx` igual que antes, sin mencionar
`apiKeyHint`. Como el campo es opcional y el default vive adentro de `registrarConsumo`,
`ctx.apiKeyHint` llega `undefined` y el operador ternario cae al `API_KEY_HINT` del módulo.
No hizo falta tocar ninguno de los 6 llamadores.

## Comandos y output

```
$ npx tsc --noEmit
(sin output — limpio)

$ npm test
...
132 OK, 0 FAIL                                    (paso5_pruebas + run_deterministic + run_renegociacion_docs)
82 aserción(es) OK, 0 fallo(s).                   (fixes_agosto)
28 aserción(es) OK, 0 fallo(s).                   (costos_telemetria — 22 previas + 6 nuevas)
Exit code: 0
```

Línea base declarada (132 + 35 + 11 + 5 + 22) se mantiene intacta; el único delta es
costos_telemetria 22 → 28 (T11–T14 nuevos).

## Tests nuevos (`casos/costos_telemetria/unit_tests.ts`)

Se agregó un helper `reloadDocumentReads(envValue)` porque `API_KEY_HINT` se calcula al
cargar el módulo (a propósito, una sola vez): el `import` estático de arriba del archivo ya
fijó su valor, así que para probar distintos `ANTHROPIC_API_KEY` hay que pisar la env var,
borrar la entrada de `require.cache` y volver a pedir el módulo (mecanismo nativo de Node,
sin mocks nuevos).

- **T11** — con `ANTHROPIC_API_KEY='sk-ant-api03-abcXYZ9988'`, la fila lleva
  `api_key_hint: '9988'`.
- **T12** — `ctx.apiKeyHint: 'ZZZZ'` explícito gana sobre el derivado del módulo.
- **T13** — sin la env var, `api_key_hint` es `null` y la fila se inserta igual.
- **T14** — con una key larga, `api_key_hint` nunca supera 4 caracteres (y son los
  últimos 4, no los primeros).

## Prueba de mutación (revertida cada vez)

| # | Mutación aplicada | Test que debía morir | Resultado |
|---|---|---|---|
| 1 | Borrar la línea `api_key_hint: ...` del insert (columna nunca se escribe) | T11, T12, T13, T14 | Los 4 fallaron (`got undefined want ...`) |
| 2 | `api_key_hint: API_KEY_HINT` fijo, ignorando `ctx.apiKeyHint` | T12 | Falló solo, exacto: `got "9988" want "ZZZZ"` |
| 3 | `process.env.ANTHROPIC_API_KEY.slice(-4)` → `process.env.ANTHROPIC_API_KEY` (key entera) | T11, T14 | Ambos fallaron (`got "sk-ant-..." want "9988"`, largo real 36) |
| 4 | Rama sin env var: `: null` → `: ''` | T13 | Falló solo: `got "" want null` |

Las 4 mutaciones mataron exactamente los tests que debían matar; ninguna quedó sin test
que la agarre. Archivo restaurado a su estado correcto después de cada una (verificado con
`diff` contra el backup).

## Dudas

Ninguna. No toqué `mora-prompt.ts` (modificado sin commitear, ajeno a esta tarea).
