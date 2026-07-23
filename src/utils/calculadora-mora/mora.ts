// ─────────────────────────────────────────────────────────────
// Lógica de mora Ley 20.720 — cálculos que se hacen en el BACKEND
// para garantizar precisión (no se confía en la aritmética del modelo).
// El modelo determina la fecha_inicio_mora; aquí recalculamos los días
// (con la fecha de Chile) y estampamos el veredicto legal.
//
// Portado desde el tool de Ricardo (Richipuelma/calculadora-mora), tipado
// para el dashboard (sin `any`). Puro y sin dependencias — apto para el
// endpoint server y para tests unitarios.
// ─────────────────────────────────────────────────────────────

export type VeredictoColor = 'verde' | 'amarillo' | 'rojo';

export type Veredicto = {
  estado: 'cumple' | 'advertencia' | 'no_cumple';
  etiqueta: string;
  color: VeredictoColor;
  simbolo: string;
  mensaje: string;
};

// Lo que devuelve el modelo por cada contrato/tarjeta, más los campos que
// el backend agrega (dias_mora recalculado, veredicto). Todo opcional porque
// viene de un LLM y no está validado por esquema.
export type MoraEstado = {
  numero?: number;
  titular?: string;
  tarjeta_tipo?: string;
  numero_contrato?: string;
  ultimo_abono_fecha?: string | null;
  ultimo_abono_monto?: number | null;
  fecha_inicio_mora?: string | null;
  explicacion?: string;
  dias_mora?: number | null;
  // Lo que dijo el modelo, conservado para diagnóstico (el que manda es dias_mora).
  dias_mora_modelo?: number | null;
  monto_adeudado?: number | null;
  moneda?: string;
  observaciones?: string;
  veredicto?: Veredicto | null;
};

/** Umbral legal: >=90 cumple; 75-89 advertencia; <75 no cumple. */
export function veredicto(dias: number): Veredicto {
  if (dias >= 90) {
    return {
      estado: 'cumple',
      etiqueta: 'CUMPLE',
      color: 'verde',
      simbolo: '✓',
      mensaje: 'Cumple los 90 días de mora — puede iniciar el procedimiento concursal.',
    };
  }
  if (dias >= 75) {
    return {
      estado: 'advertencia',
      etiqueta: 'POR CUMPLIR',
      color: 'amarillo',
      simbolo: '~',
      mensaje: `Faltan ${90 - dias} día(s) para alcanzar los 90.`,
    };
  }
  return {
    estado: 'no_cumple',
    etiqueta: 'NO CUMPLE',
    color: 'rojo',
    simbolo: '✗',
    mensaje: 'Aún no alcanza los 90 días de mora.',
  };
}

/** Convierte "DD/MM/YYYY" (tolerante a separadores - . /) a ms UTC, o null. */
export function parseChileanDateUTC(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!m) return null;
  const d = +m[1];
  const mo = +m[2];
  const y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d);
}

/** Partes de la fecha de hoy en horario de Chile (America/Santiago). */
export function todayChileParts(): { y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  return { y: +parts.year, m: +parts.month, d: +parts.day };
}

export function todayChileUTC(): number {
  const { y, m, d } = todayChileParts();
  return Date.UTC(y, m - 1, d);
}

/** Fecha de hoy en formato chileno DD/MM/YYYY (para inyectar en el prompt). */
export function fechaHoyChileLabel(): string {
  const { y, m, d } = todayChileParts();
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/** Días entre la fecha de inicio de mora y hoy (Chile). Nunca negativo. */
export function diasMora(fechaInicioMora: unknown): number | null {
  const inicio = parseChileanDateUTC(fechaInicioMora);
  if (inicio == null) return null;
  const diff = Math.round((todayChileUTC() - inicio) / 86_400_000);
  return Math.max(0, diff);
}

/**
 * Toma los "estados" devueltos por el modelo (crudos, sin validar) y los
 * enriquece: recalcula dias_mora desde fecha_inicio_mora y adjunta el
 * veredicto legal. Conserva el dato del modelo en dias_mora_modelo.
 */
export function recomputarEstados(estados: unknown[]): MoraEstado[] {
  return estados.map((raw, i): MoraEstado => {
    const e = (raw && typeof raw === 'object' ? raw : {}) as MoraEstado;
    const diasBackend = diasMora(e.fecha_inicio_mora);
    const dias = diasBackend ?? (typeof e.dias_mora === 'number' ? e.dias_mora : null);
    return {
      ...e,
      numero: e.numero ?? i + 1,
      dias_mora: dias,
      dias_mora_modelo: typeof e.dias_mora === 'number' ? e.dias_mora : null,
      veredicto: dias == null ? null : veredicto(dias),
    };
  });
}
