export const CALC_ENGINE_VERSION = 'm40-2026.2';
const LEY_97_REQUIRED_WEEKS_2026 = 875;

const CEAV_PATRON_RATES_2026 = [
  { minUma: 0, maxUma: 2.5, rate: 0.0315 },
  { minUma: 2.51, maxUma: 3, rate: 0.06026 },
  { minUma: 3.01, maxUma: 3.5, rate: 0.06361 },
  { minUma: 3.51, maxUma: 4, rate: 0.06613 },
  { minUma: 4.01, maxUma: Infinity, rate: 0.07513 }
];

const LEY_73_TABLE = [
  { max: 1, basic: 80, increment: 0.563 },
  { max: 1.25, basic: 77.11, increment: 0.814 },
  { max: 1.5, basic: 58.18, increment: 1.178 },
  { max: 1.75, basic: 49.23, increment: 1.43 },
  { max: 2, basic: 42.67, increment: 1.615 },
  { max: 2.25, basic: 37.65, increment: 1.756 },
  { max: 2.5, basic: 33.68, increment: 1.868 },
  { max: 2.75, basic: 30.48, increment: 1.958 },
  { max: 3, basic: 27.83, increment: 2.033 },
  { max: 3.25, basic: 25.6, increment: 2.096 },
  { max: 3.5, basic: 23.7, increment: 2.149 },
  { max: 3.75, basic: 22.07, increment: 2.195 },
  { max: 4, basic: 20.65, increment: 2.235 },
  { max: 4.25, basic: 19.39, increment: 2.271 },
  { max: 4.5, basic: 18.29, increment: 2.302 },
  { max: 4.75, basic: 17.3, increment: 2.33 },
  { max: 5, basic: 16.41, increment: 2.355 },
  { max: 5.25, basic: 15.61, increment: 2.377 },
  { max: 5.5, basic: 14.88, increment: 2.398 },
  { max: 5.75, basic: 14.22, increment: 2.416 },
  { max: 6, basic: 13.62, increment: 2.433 },
  { max: Infinity, basic: 13, increment: 2.45 }
];

export function parseNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(String(value).replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function calculateModality40(rawInput) {
  const input = normalizeInput(rawInput);
  const warnings = [];

  const maxSbc = input.umaDiaria * 25;
  const sbcDiario = Math.min(input.salarioModalidad40Diario, maxSbc);
  if (input.salarioModalidad40Diario > maxSbc) {
    warnings.push(`El SBC se topo a 25 UMAs: ${money(maxSbc)} diarios.`);
  }

  if (sbcDiario < input.ultimoSalarioDiario) {
    warnings.push('El salario de Modalidad 40 no debe ser menor al ultimo salario registrado.');
  }

  const weeksFromM40 = input.mesesAportar * 52 / 12;
  const semanasFinales = input.semanasCotizadas + weeksFromM40;
  const diasCotizados = input.diasMensuales * input.mesesAportar;
  const rates = modalityRates(sbcDiario, input.umaDiaria);
  const pagoMensual = sbcDiario * input.diasMensuales * rates.total;
  const costoTotal = pagoMensual * input.mesesAportar;

  const calculaLey73 = input.regimen === 'ley-73';
  const semanasM40EnPromedio = calculaLey73 ? Math.min(250, weeksFromM40) : 0;
  const semanasPreviasEnPromedio = calculaLey73 ? Math.max(0, 250 - semanasM40EnPromedio) : 0;
  const salarioPromedio250 = calculaLey73
    ? (
      (sbcDiario * semanasM40EnPromedio) +
      (input.salarioPromedioActualDiario * semanasPreviasEnPromedio)
    ) / 250
    : 0;

  const pensionLey73 = estimateLey73Pension({
    edadRetiro: input.edadRetiro,
    semanasFinales,
    salarioPromedio250,
    salarioMinimoDiario: input.salarioMinimoDiario
  });
  const pensionLey97 = estimateLey97Status({
    edadRetiro: input.edadRetiro,
    semanasFinales
  });

  if (input.regimen === 'ley-73') {
    if (!pensionLey73.elegible) {
      warnings.push('Ley 73 requiere al menos 500 semanas, edad minima de 60 años y salario promedio valido para estimar pension.');
    }
  } else {
    warnings.push('Ley 97 no se estima con formula de salario promedio: el monto depende del saldo en la cuenta individual/AFORE y de la modalidad autorizada.');
    if (!pensionLey97.elegible) {
      warnings.push(`Para Ley 97 en 2026 se requieren ${LEY_97_REQUIRED_WEEKS_2026} semanas como minimo para cesantia/vejez.`);
    }
  }

  return {
    version: CALC_ENGINE_VERSION,
    input,
    rates,
    result: {
      sbcDiario,
      maxSbc,
      weeksFromM40,
      semanasFinales,
      diasCotizados,
      pagoMensual,
      costoTotal,
      semanasM40EnPromedio,
      semanasPreviasEnPromedio,
      salarioPromedio250,
      pensionLey73,
      pensionLey97,
      costoPorSemana: weeksFromM40 > 0 ? costoTotal / weeksFromM40 : 0
    },
    warnings
  };
}

function normalizeInput(raw) {
  return {
    nombre: String(raw.nombre || '').trim(),
    nss: String(raw.nss || '').trim(),
    regimen: raw.regimen === 'ley-97' ? 'ley-97' : 'ley-73',
    edadActual: parseNumber(raw.edadActual),
    edadRetiro: parseNumber(raw.edadRetiro, 65),
    semanasCotizadas: parseNumber(raw.semanasCotizadas),
    ultimoSalarioDiario: parseNumber(raw.ultimoSalarioDiario),
    salarioPromedioActualDiario: parseNumber(raw.salarioPromedioActualDiario),
    salarioModalidad40Diario: parseNumber(raw.salarioModalidad40Diario),
    mesesAportar: parseNumber(raw.mesesAportar),
    umaDiaria: parseNumber(raw.umaDiaria, 113.14),
    salarioMinimoDiario: parseNumber(raw.salarioMinimoDiario, 278.8),
    diasMensuales: parseNumber(raw.diasMensuales, 30.4),
    notas: String(raw.notas || '').trim()
  };
}

function modalityRates(sbcDiario, umaDiaria) {
  const sbcUma = umaDiaria > 0 ? sbcDiario / umaDiaria : 0;
  const ceavPatron = CEAV_PATRON_RATES_2026.find((row) => sbcUma >= row.minUma && sbcUma <= row.maxUma)?.rate || 0.07513;
  const rates = {
    retiro: 0.02,
    ceavPatron,
    ceavObrero: 0.01125,
    invalidezVida: 0.02375,
    gastosMedicosPensionados: 0.01425
  };

  return {
    ...rates,
    sbcUma,
    total: Object.values(rates).reduce((sum, rate) => sum + rate, 0)
  };
}

function estimateLey97Status({ edadRetiro, semanasFinales }) {
  const hasWeeks = semanasFinales >= LEY_97_REQUIRED_WEEKS_2026;
  const hasAge = edadRetiro >= 60;
  return {
    elegible: hasWeeks && hasAge,
    semanasRequeridas: LEY_97_REQUIRED_WEEKS_2026,
    semanasFaltantes: Math.max(0, LEY_97_REQUIRED_WEEKS_2026 - semanasFinales),
    modalidadEdad: edadRetiro >= 65 ? 'Vejez' : edadRetiro >= 60 ? 'Cesantia en edad avanzada' : 'Aun sin edad minima',
    montoEstimado: null
  };
}

function estimateLey73Pension({ edadRetiro, semanasFinales, salarioPromedio250, salarioMinimoDiario }) {
  if (semanasFinales < 500 || salarioPromedio250 <= 0 || salarioMinimoDiario <= 0 || ageFactor(edadRetiro) === 0) {
    return {
      elegible: false,
      mensual: 0,
      factorEdad: ageFactor(edadRetiro),
      incrementos: 0,
      porcentajeTotal: 0
    };
  }

  const vecesSalarioMinimo = salarioPromedio250 / salarioMinimoDiario;
  const bracket = LEY_73_TABLE.find((row) => vecesSalarioMinimo <= row.max) || LEY_73_TABLE.at(-1);
  const incrementos = yearlyIncrements(semanasFinales);
  const porcentajeTotal = bracket.basic + (incrementos * bracket.increment);
  const factorEdad = ageFactor(edadRetiro);
  const anual = salarioPromedio250 * 365 * (porcentajeTotal / 100) * factorEdad;

  return {
    elegible: true,
    mensual: anual / 12,
    anual,
    factorEdad,
    incrementos,
    porcentajeBasico: bracket.basic,
    porcentajeIncremento: bracket.increment,
    porcentajeTotal,
    vecesSalarioMinimo
  };
}

function yearlyIncrements(semanasFinales) {
  const extraWeeks = Math.max(0, semanasFinales - 500);
  const completeYears = Math.floor(extraWeeks / 52);
  const remainder = extraWeeks % 52;
  return completeYears + (remainder > 26 ? 1 : 0);
}

function ageFactor(age) {
  if (age >= 65) return 1;
  if (age === 64) return 0.95;
  if (age === 63) return 0.9;
  if (age === 62) return 0.85;
  if (age === 61) return 0.8;
  if (age === 60) return 0.75;
  return 0;
}

function money(value) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value || 0);
}
