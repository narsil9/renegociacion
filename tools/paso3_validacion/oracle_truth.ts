/**
 * TABLA-VERDAD ORÁCULO — la extracción CORRECTA por cliente, leída por Claude (esta sesión)
 * directamente de los documentos y corroborada contra la declaración real de la abogada.
 *
 * Es la "extracción ideal" que el Centinela debería producir. Sirve para:
 *  - inyectarla como si fuera la salida del Centinela y verificar que el flujo declara bien
 *    (test_oracle_injection.ts),
 *  - comparar producto-a-producto la salida real del Centinela contra esta verdad (mejor que
 *    el conteo a secas).
 *
 * `leido: true`  = monto/clasificación leídos DIRECTO del documento en esta sesión.
 * `leido: false` = corroborado por la declaración de la abogada (doc no releído en detalle).
 * `seccion` es indicativa (260 si mora 90+d con venc acreditable, 261 si no); el conteo NO
 * penaliza la sección (regla del usuario): lo que importa es el set de productos declarados.
 */
export interface OracleProduct {
  institucion: string;     // nombre tal como lo emitiría el Centinela / catálogo
  monto: number;           // CLP (UF convertida para vivienda)
  seccion: 260 | 261;
  operacion?: string;      // Nº de operación/contrato si el doc lo trae
  doc: string;             // documento fuente
  cmf: boolean;            // ¿aparece en el Informe CMF? (false = NO-CMF, ej. TGR)
  moneda?: 'UF' | 'CLP';
  leido: boolean;          // leído directo del PDF esta sesión
  nota?: string;
}

export interface OracleCase { rut: string; label: string; total: number; productos: OracleProduct[]; }

export const ORACLE: Record<string, OracleCase> = {
  cristian_mancilla: {
    rut: '16.587.870-1', label: 'Cristian Mancilla', total: 10,
    productos: [
      { institucion: 'Banco Santander-Chile', monto: 6_985_718, seccion: 260, operacion: '00350401650054550434', doc: 'Santander_consumo_pago_total.pdf', cmf: true, moneda: 'CLP', leido: true, nota: 'PAGO TOTAL DEL PRÉSTAMO = payoff (checkboxes de pago vacíos → no es recibo)' },
      { institucion: 'Promotora CMR Falabella S.A.', monto: 4_168_214, seccion: 260, doc: 'CMR_Falabella_eecc.pdf', cmf: true, moneda: 'CLP', leido: false },
      { institucion: 'Banco del Estado de Chile', monto: 138_932_112, seccion: 261, doc: 'BancoEstado_hipotecario_liquidacion.pdf', cmf: true, moneda: 'CLP', leido: false, nota: 'hipotecario' },
      { institucion: 'Banco del Estado de Chile', monto: 5_884_108, seccion: 261, operacion: '00036222267', doc: 'BancoEstado_consumo_liquidacion.pdf', cmf: true, moneda: 'CLP', leido: true, nota: 'liquidación: tabla payoff por fecha, $5.827.472→$5.884.108' },
      { institucion: 'Banco del Estado de Chile', monto: 149_465, seccion: 261, doc: 'BancoEstado_linea_credito_portal.pdf', cmf: true, moneda: 'CLP', leido: false, nota: 'línea' },
      { institucion: 'Caja de Compensación de Asignación Familiar Los Andes', monto: 1_220_547, seccion: 261, doc: 'CCAF_LosAndes_certificado.pdf', cmf: true, moneda: 'CLP', leido: false },
      { institucion: 'Caja de Compensación de Asignación Familiar Los Andes', monto: 967_439, seccion: 261, doc: 'CCAF_LosAndes_certificado.pdf', cmf: true, moneda: 'CLP', leido: false },
      { institucion: 'Banco Santander-Chile', monto: 2_444, seccion: 261, doc: 'Santander_tarjeta_visa_eecc.pdf', cmf: true, moneda: 'CLP', leido: false, nota: 'tarjeta visa' },
      { institucion: 'Tesorería General de la República', monto: 18_537, seccion: 261, doc: 'TGR_contribuciones_rol_02454.pdf', cmf: false, moneda: 'CLP', leido: false, nota: 'NO-CMF contribuciones' },
      { institucion: 'Tesorería General de la República', monto: 19_049, seccion: 261, doc: 'TGR_contribuciones_rol_00760.pdf', cmf: false, moneda: 'CLP', leido: false, nota: 'NO-CMF contribuciones' },
    ],
  },
  miguel_lugo: {
    rut: '26.625.555-1', label: 'Miguel Lugo', total: 13,
    productos: [
      { institucion: 'Banco de Chile', monto: 34_170_587, seccion: 260, operacion: '30010', doc: 'ESTADO DE DEUDA - Banco de Chile.pdf', cmf: true, moneda: 'CLP', leido: true, nota: 'crédito en cuotas, venc 02/01/2026' },
      { institucion: 'Banco de Chile', monto: 750_944, seccion: 260, operacion: '01167', doc: 'ESTADO DE DEUDA - Banco de Chile.pdf', cmf: true, moneda: 'CLP', leido: true, nota: 'tarjetas vencidas, venc 07/01/2026' },
      { institucion: 'Banco de Chile', monto: 606_175, seccion: 261, operacion: '72012', doc: 'ESTADO DE DEUDA - Banco de Chile.pdf', cmf: true, moneda: 'CLP', leido: true, nota: 'línea cta cte' },
      { institucion: 'Banco de Chile', monto: 45_798, seccion: 260, operacion: '97000', doc: 'ESTADO DE DEUDA - Banco de Chile.pdf', cmf: false, moneda: 'CLP', leido: true, nota: 'VARIOS DEUDORES, NO-CMF, venc 19/02/2026' },
      { institucion: 'Banco Itaú Chile', monto: 6_756_287, seccion: 261, operacion: '60384313', doc: 'Certificado Deuda - Banco Itau.pdf', cmf: true, moneda: 'CLP', leido: true, nota: 'consumo, Saldo Insoluto (no el original $8.183.872)' },
      { institucion: 'Banco Itaú Chile', monto: 500_000, seccion: 261, operacion: '226430883', doc: 'Certificado Deuda - Banco Itau.pdf', cmf: true, moneda: 'CLP', leido: true, nota: 'línea preferencial (la que se cae en escaneos)' },
      { institucion: 'Banco Itaú Chile', monto: 9_511_066, seccion: 261, operacion: '5598002100197410', doc: 'Certificado Deuda - Banco Itau.pdf', cmf: true, moneda: 'CLP', leido: true, nota: 'tarjeta MasterCard, Cart.Vcida' },
      { institucion: 'Caja de Compensación de Asignación Familiar Los Andes', monto: 1_589_849, seccion: 261, doc: 'Certificado - CCAF Los Andes.pdf', cmf: true, moneda: 'CLP', leido: false },
      { institucion: 'Caja de Compensación de Asignación Familiar Los Andes', monto: 2_767_909, seccion: 261, doc: 'Certificado - CCAF Los Andes.pdf', cmf: true, moneda: 'CLP', leido: false },
      { institucion: 'Caja de Compensación de Asignación Familiar Los Andes', monto: 4_774_083, seccion: 261, doc: 'Certificado - CCAF Los Andes.pdf', cmf: true, moneda: 'CLP', leido: false },
      { institucion: 'Banco de Crédito e Inversiones', monto: 14_830_069, seccion: 261, operacion: 'D43400044917', doc: 'Certificado - BCI.pdf', cmf: true, moneda: 'CLP', leido: false, nota: 'PDF texto' },
      { institucion: 'Banco de Crédito e Inversiones', monto: 615, seccion: 261, operacion: 'ENTE 21904910', doc: 'Certificado - BCI.pdf', cmf: false, moneda: 'CLP', leido: false, nota: 'cuenta corriente, backstop cert_line_items' },
      { institucion: 'Tenpo Prepago SA', monto: 6_180, seccion: 261, doc: 'Estado Cuenta - Tenpo.pdf', cmf: true, moneda: 'CLP', leido: false, nota: 'fintech' },
    ],
  },
  nector_ruiz: {
    rut: '15.420.073-8', label: 'Néctor Ruiz', total: 12,
    productos: [
      { institucion: 'Banco Falabella', monto: 2_988_488, seccion: 260, operacion: '29821865337', doc: 'BancoFalabella_certificado_deuda.pdf', cmf: true, moneda: 'CLP', leido: false, nota: 'cartera vencida, venc 19/09/2025' },
      { institucion: 'Promotora CMR Falabella S.A.', monto: 2_296_733, seccion: 260, doc: 'CMR_certificado_deuda.pdf', cmf: true, moneda: 'CLP', leido: false, nota: 'venc 05/10/2025' },
      { institucion: 'Banco de Chile', monto: 37_700_317, seccion: 261, doc: 'BancoChile_certificado_deuda.pdf', cmf: true, moneda: 'CLP', leido: true, nota: '⚠️ la abogada usó el TOTAL PESO global como consumo (no hay cert de consumo aparte). El conteo de productos BdCh lo fija el CMF.' },
      { institucion: 'Banco de Chile', monto: 503_808, seccion: 261, doc: 'BancoChile_linea_credito.pdf', cmf: true, moneda: 'CLP', leido: false, nota: 'línea (screenshot)' },
      { institucion: 'Banco de Chile', monto: 1_335_287, seccion: 261, operacion: 'XXXX-2949', doc: 'BancoChile_tarjeta_eecc_2949.pdf', cmf: true, moneda: 'CLP', leido: false, nota: 'tarjeta 2949' },
      { institucion: 'Banco de Chile', monto: 1_443_774, seccion: 261, operacion: 'XXXX-9558', doc: 'BancoChile_tarjeta_eecc_9558.pdf', cmf: true, moneda: 'CLP', leido: false, nota: 'tarjeta 9558' },
      { institucion: 'Banco de Chile', monto: 145_043_269, seccion: 261, operacion: '430-9-929961-500', doc: 'BancoChile_hipotecario.pdf', cmf: true, moneda: 'UF', leido: true, nota: 'vivienda 3.538,959 UF (= total UF del cert global)' },
      { institucion: 'Banco del Estado de Chile', monto: 36_130_323, seccion: 261, operacion: 'CRE-00039038355', doc: 'BancoEstado_certificado_deuda.pdf', cmf: true, moneda: 'CLP', leido: true },
      { institucion: 'Banco del Estado de Chile', monto: 389_848, seccion: 261, operacion: 'CRE-00040145148', doc: 'BancoEstado_certificado_deuda.pdf', cmf: true, moneda: 'CLP', leido: true },
      { institucion: 'Banco del Estado de Chile', monto: 553_350, seccion: 261, operacion: 'CRE-00040166973', doc: 'BancoEstado_certificado_deuda.pdf', cmf: true, moneda: 'CLP', leido: true },
      { institucion: 'Caja de Compensación de Asignación Familiar La Araucana', monto: 8_049_440, seccion: 261, doc: 'LaAraucana_certificado_credito.pdf', cmf: true, moneda: 'CLP', leido: false },
      { institucion: 'CAT Administradora de Tarjetas S.A.', monto: 105_185, seccion: 261, doc: 'Cencosud_CAT_eecc.pdf', cmf: true, moneda: 'CLP', leido: false },
    ],
  },
};
