# Principios generales — transversales a todos los pasos

> Reglas que aplican a CUALQUIER paso/agente. Ver [`README.md`](README.md) para el formato y las reglas
> de cómo agregar lecciones.

### G1 — El certificado manda, NO el CMF
El CMF suele estar **desactualizado**; el certificado es lo más **actual**. El monto y el vencimiento
de una deuda salen **del certificado**, no del CMF. **Nunca** reemplazar/anclar el monto de un cert al
del CMF (el CMF solo sirve como señal de contradicción para **alertar**, jamás como fuente del monto).
*(Testigo: el "Bug A" que se intentó y se revirtió por violar esto.)* · **validada** (2026-06-29).

### G2 — Nunca poner $0 ni romper el caso "en silencio"
Si un documento muestra un **valor > 0** (monto de deuda, ingreso, etc.), ese valor se usa + alerta si
hay dudas. Una **interpretación** del LLM ("parece pagado", "parece saldado", "no aplica") **no** puede
bajar un valor a $0 ni cambiar la elegibilidad sin confirmación humana. Las dudas se **alertan**, no se
aplican solas. · **validada** (2026-06-29).

### G3 — El LLM extrae hechos; TypeScript blinda la estructura
El LLM lee/extrae datos de documentos messy. Las decisiones **estructurales** (clasificación 260/261,
split multiproducto, override de monto, cálculo de ingreso, adjunción) las hace **TypeScript** de forma
determinista. Una lección mejora la **extracción** del LLM, no mueve la decisión estructural al LLM. · **validada**.
