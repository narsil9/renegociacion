/**
 * Test rápido de los parsers contra los nuevos formatos de PDF (CT 2026 + CMF Ley 21.680).
 * Uso: npx ts-node --transpile-only -r dotenv/config casos/test_new_pdf_formats.ts
 */
import { analyzeTaxCategory, detectF29ActivityLast24Months, extractCarpetaTributariaMetadata } from '../src/utils/pdf_analyzer';
import { extractCreditors, analyzeCmfPdf } from '../src/utils/cmf_analyzer';

const CT_PATH = '/Users/patomartini/Desktop/20260602-232145_carpeta_tributaria.pdf';
const CMF_PATH = '/Users/patomartini/Desktop/informe_deudas_18680500-3.pdf';

const log = {
  log: (m: string) => console.log(m),
  error: (m: string, e?: unknown) => console.error(m, e),
};

async function main() {
  console.log('\n==== CARPETA TRIBUTARIA — formato nuevo ====\n');

  const categoria = await analyzeTaxCategory(CT_PATH, log);
  console.log(`\n→ Categoría: ${categoria}`);

  const f29 = await detectF29ActivityLast24Months(CT_PATH, log);
  console.log(`\n→ F29 activeMonths (${f29.activeMonths.length}): ${JSON.stringify(f29.activeMonths)}`);
  console.log(`→ F29 hasActivity: ${f29.hasActivityLast24Months}`);

  const meta = await extractCarpetaTributariaMetadata(CT_PATH, log);
  console.log(`\n→ Fecha generación CT: ${meta.fechaGeneracion}`);
  console.log(`→ Boletas detectadas: ${meta.boletasUltimos12Meses.length}`);
  meta.boletasUltimos12Meses.forEach(b =>
    console.log(`   ${b.periodo}: $${b.honorarioBruto.toLocaleString('es-CL')}`)
  );
  console.log(
    `→ Ingreso mensual promedio (últ. 6): ${
      meta.ingresoMensualPromedio ? '$' + meta.ingresoMensualPromedio.toLocaleString('es-CL') : 'null'
    }`
  );

  console.log('\n==== CMF — formato nuevo Ley 21.680 ====\n');

  const creditors = await extractCreditors(CMF_PATH, log);
  console.log(`\n→ Acreedores extraídos: ${creditors.length}`);
  creditors.forEach(c =>
    console.log(
      `   • [${c.institucion}] ${c.tipoCredito} — ` +
      `Total: $${c.totalCredito.toLocaleString('es-CL')} | ` +
      `90+d: $${c.overdue90Days.toLocaleString('es-CL')}`
    )
  );

  const cmfResult = await analyzeCmfPdf(CMF_PATH, log);
  console.log(`\n→ Total deuda: $${cmfResult.totalDebt.toLocaleString('es-CL')}`);
  console.log(`→ Fecha emisión: ${cmfResult.fechaEmision}`);
  console.log(`→ 90+d total: $${cmfResult.overdue90DaysTotal.toLocaleString('es-CL')}`);
  console.log(`→ qualifying90PlusCount: ${cmfResult.qualifying90PlusCount}`);
  console.log(`→ meets90DaysReq: ${cmfResult.meets90DaysRequirement}`);
}

main().catch(console.error);
