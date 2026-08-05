import * as path from 'path';

/**
 * ¿Este archivo cumple la regla del estudio para adjuntar al portal?
 *
 * La regla es PDF (Patricio, 2026-08-05). NO es una limitación del portal: medido en el job
 * `bbf83b2d` (Kerum, 30-jul), `Linea_de_Credito_Bice.jpg` se adjuntó con éxito. Es la regla del
 * estudio, y el abogado la aplicó — teniendo la captura de Banco de Chile en .pdf y en .png, usó
 * el PDF.
 *
 * Por eso esto se usa como PREFERENCIA, nunca como filtro excluyente: una deuda con evidencia
 * subóptima es recuperable, una deuda sin acreditar es inadmisibilidad.
 */
export function esPdf(localPath: string | null | undefined): boolean {
  if (!localPath) return false;
  return path.extname(localPath).toLowerCase() === '.pdf';
}
