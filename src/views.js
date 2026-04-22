const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const number = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('es-MX', { style: 'percent', minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function layout({ title, user, body }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/public/styles.css">
  <script src="/public/app.js" defer></script>
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/"><span>IMSS</span> Penciones</a>
    ${user ? `<nav><span>${escapeHtml(user.username)}</span><a class="nav-link" href="/logout">Salir</a></nav>` : ''}
  </header>
  <main class="page">${body}</main>
</body>
</html>`;
}

export function loginView({ error }) {
  return layout({
    title: 'Acceso',
    body: `
      <section class="auth-panel">
        <p class="eyebrow">Mesa de cálculo</p>
        <h1>Acceso</h1>
        ${error ? `<p class="alert">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/login" class="stack">
          <label>Usuario <input name="username" autocomplete="username" required></label>
          <label>Contraseña <input name="password" type="password" autocomplete="current-password" required></label>
          <button type="submit">Entrar</button>
        </form>
      </section>
    `
  });
}

export function dashboardView({ user, calculations }) {
  return layout({
    title: 'Calculadora Modalidad 40',
    user,
    body: `
      <section class="hero">
        <div>
          <p class="eyebrow">Modalidad 40 IMSS</p>
          <h1>Calculadora Modalidad 40</h1>
          <p>Escenarios separados por Ley 73 y Ley 97 para no mezclar formulas que no aplican al mismo regimen.</p>
        </div>
        <div class="law-note" aria-label="Diferencia entre regimenes">
          <strong>Ley 73</strong><span>Promedio 250 semanas + tabla IMSS.</span>
          <strong>Ley 97</strong><span>Cuenta individual/AFORE; aqui solo validamos costo y semanas.</span>
        </div>
      </section>

      <section class="grid">
        ${calculationForm({
          action: '/calculations',
          eyebrow: 'Nuevo folio',
          title: 'Datos del escenario',
          submitLabel: 'Calcular y guardar'
        })}

        <section class="panel">
          <div class="section-head">
            <p class="eyebrow">Archivo</p>
            <h2>Historial</h2>
          </div>
          ${historyTable(calculations)}
        </section>
      </section>
    `
  });
}

export function editCalculationView({ user, calculation }) {
  const inputData = JSON.parse(calculation.input_json);
  return layout({
    title: `Editar folio ${calculation.id}`,
    user,
    body: `
      <section class="detail-head compact">
        <div>
          <a href="/calculations/${calculation.id}" class="back">Folio ${calculation.id}</a>
          <p class="eyebrow">Nueva versión</p>
          <h1>Editar cálculo</h1>
          <p>Al guardar se conserva el historial y esta captura queda como la versión ${number.format((calculation.current_version || 1) + 1)}.</p>
        </div>
      </section>

      ${calculationForm({
        action: `/calculations/${calculation.id}/update`,
        eyebrow: `Versión ${number.format((calculation.current_version || 1) + 1)}`,
        title: 'Actualizar escenario',
        submitLabel: 'Guardar nueva versión',
        inputData
      })}
    `
  });
}

export function detailView({ user, calculation, versions = [] }) {
  const payload = JSON.parse(calculation.result_json);
  const inputData = JSON.parse(calculation.input_json);
  const { result, rates, warnings } = payload;
  const ley97Status = result.pensionLey97 || {
    elegible: false,
    semanasRequeridas: 875,
    semanasFaltantes: null,
    modalidadEdad: 'No disponible'
  };
  const ley97Label = ley97Status.semanasFaltantes === null
    ? 'Recalcular'
    : ley97Status.elegible ? 'Cumple semanas' : `Faltan ${number.format(ley97Status.semanasFaltantes)}`;
  const displayWarnings = normalizedWarnings(warnings, inputData.regimen, result.pensionLey97);

  return layout({
    title: `Folio ${calculation.id}`,
    user,
    body: `
      <section class="detail-head">
        <div>
          <a href="/" class="back">Historial</a>
          <p class="eyebrow">Resultado guardado</p>
          <h1>Folio ${calculation.id}</h1>
          <p>${escapeHtml(calculation.customer_name)} · versión ${number.format(calculation.current_version || 1)} · ${escapeHtml(calculation.updated_at || calculation.created_at)}</p>
        </div>
        <div class="actions">
          <a class="button secondary" href="/calculations/${calculation.id}/edit">Editar</a>
          <a class="button ghost" href="/calculations/${calculation.id}/pdf">Generar PDF</a>
        </div>
      </section>

      ${displayWarnings.length ? `<section class="panel warnings"><h2>Observaciones</h2>${displayWarnings.map((w) => `<p>${escapeHtml(w)}</p>`).join('')}</section>` : ''}

      <section class="cards">
        ${metric('Pago mensual', money(result.pagoMensual))}
        ${metric('Costo total', money(result.costoTotal))}
        ${metric('Semanas finales', number.format(result.semanasFinales))}
        ${inputData.regimen === 'ley-73'
          ? metric('Pensión mensual Ley 73', money(result.pensionLey73.mensual))
          : metric('Estatus Ley 97', ley97Label)}
      </section>

      <section class="grid two">
        <div class="panel">
          <h2>Entradas</h2>
          ${kv('Régimen', inputData.regimen === 'ley-73' ? 'Ley 73' : 'Ley 97')}
          ${kv('Edad actual / retiro', `${inputData.edadActual} / ${inputData.edadRetiro}`)}
          ${kv('Semanas cotizadas actuales', number.format(inputData.semanasCotizadas))}
          ${kv('SBC Modalidad 40', money(result.sbcDiario))}
          ${kv('Meses a aportar', number.format(inputData.mesesAportar))}
          ${kv('UMA diaria', money(inputData.umaDiaria))}
        </div>
        <div class="panel">
          <h2>Detalle</h2>
          ${kv('Tasa total', percent.format(rates.total))}
          ${kv('Semanas generadas', number.format(result.weeksFromM40))}
          ${inputData.regimen === 'ley-73' ? kv('Promedio diario 250 semanas', money(result.salarioPromedio250)) : ''}
          ${inputData.regimen === 'ley-97' ? kv('Semanas requeridas Ley 97', number.format(ley97Status.semanasRequeridas)) : ''}
          ${inputData.regimen === 'ley-97' ? kv('Modalidad por edad', ley97Status.modalidadEdad) : ''}
          ${kv('Costo por semana', money(result.costoPorSemana))}
          ${kv('Versión del cálculo', calculation.engine_version)}
        </div>
      </section>

      ${inputData.notas ? `<section class="panel"><h2>Notas</h2><p>${escapeHtml(inputData.notas)}</p></section>` : ''}

      <section class="panel versions">
        <div class="section-head">
          <p class="eyebrow">Auditoría</p>
          <h2>Historial de versiones</h2>
        </div>
        ${versionsTable(versions)}
      </section>
    `
  });
}

function historyTable(calculations) {
  if (!calculations.length) return '<p class="empty">Todavía no hay cálculos guardados.</p>';
  return `
    <div class="table-wrap">
      <table class="history-table">
        <thead><tr><th>Folio</th><th>Nombre</th><th>Versión</th><th>Régimen</th><th>Costo</th><th>Resultado</th><th>Fecha</th><th></th></tr></thead>
        <tbody>
          ${calculations.map((calculation) => {
            const payload = JSON.parse(calculation.result_json);
            const regimen = payload.input?.regimen === 'ley-97' ? 'Ley 97' : 'Ley 73';
            const resultLabel = payload.input?.regimen === 'ley-97'
              ? (payload.result.pensionLey97
                ? (payload.result.pensionLey97.elegible ? 'Cumple semanas' : `Faltan ${number.format(payload.result.pensionLey97.semanasFaltantes)}`)
                : 'Recalcular')
              : money(payload.result.pensionLey73.mensual);
            return `<tr>
              <td><a href="/calculations/${calculation.id}">#${calculation.id}</a></td>
              <td class="cell-name">${escapeHtml(calculation.customer_name)}</td>
              <td>v${number.format(calculation.current_version || 1)}</td>
              <td>${regimen}</td>
              <td>${money(payload.result.costoTotal)}</td>
              <td>${resultLabel}</td>
              <td>${escapeHtml(calculation.created_at.slice(0, 10))}</td>
              <td><a class="table-action" href="/calculations/${calculation.id}/edit">Editar</a></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function versionsTable(versions) {
  if (!versions.length) return '<p class="empty">Este folio todavía no tiene versiones registradas.</p>';
  return `
    <table>
      <thead><tr><th>Versión</th><th>Nombre</th><th>Régimen</th><th>Costo</th><th>Resultado</th><th>Fecha</th></tr></thead>
      <tbody>
        ${versions.map((version) => {
          const payload = JSON.parse(version.result_json);
          const regimen = payload.input?.regimen === 'ley-97' ? 'Ley 97' : 'Ley 73';
          const resultLabel = payload.input?.regimen === 'ley-97'
            ? (payload.result.pensionLey97
              ? (payload.result.pensionLey97.elegible ? 'Cumple semanas' : `Faltan ${number.format(payload.result.pensionLey97.semanasFaltantes)}`)
              : 'Recalcular')
            : money(payload.result.pensionLey73.mensual);
          return `<tr>
            <td>v${number.format(version.version_number)}</td>
            <td>${escapeHtml(version.customer_name)}</td>
            <td>${regimen}</td>
            <td>${money(payload.result.costoTotal)}</td>
            <td>${resultLabel}</td>
            <td>${escapeHtml(version.created_at)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function normalizedWarnings(warnings = [], regimen, hasLey97Result) {
  const filtered = warnings.filter((warning) => (
    !(regimen === 'ley-97' && warning.includes('solo aplica como referencia para Ley 73'))
  ));

  if (regimen === 'ley-97' && !hasLey97Result) {
    filtered.push('Este folio fue calculado con una version anterior. Edita y guarda una nueva version para recalcular el estatus Ley 97.');
  }

  return filtered;
}

function calculationForm({ action, eyebrow, title, submitLabel, inputData = {} }) {
  const regimen = inputData.regimen === 'ley-97' ? 'ley-97' : 'ley-73';
  const optionalOpen = inputData.nss || inputData.notas || inputData.diasMensuales;

  return `
    <form method="post" action="${escapeHtml(action)}" class="panel form-grid">
      <div class="section-head wide">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h2>${escapeHtml(title)}</h2>
      </div>
      ${input('nombre', 'Nombre', inputData.nombre || '', 'text', true)}
      <label>Régimen
        <select name="regimen" data-regimen-select>
          <option value="ley-73"${regimen === 'ley-73' ? ' selected' : ''}>Ley 73</option>
          <option value="ley-97"${regimen === 'ley-97' ? ' selected' : ''}>Ley 97</option>
        </select>
      </label>
      ${input('edadActual', 'Edad actual', valueOrDefault(inputData.edadActual, '55'), 'number')}
      ${input('edadRetiro', 'Edad de retiro', valueOrDefault(inputData.edadRetiro, '65'), 'number')}
      ${input('semanasCotizadas', 'Semanas cotizadas actuales', valueOrDefault(inputData.semanasCotizadas, ''), 'number', true)}
      ${input('ultimoSalarioDiario', 'Último salario diario registrado', valueOrDefault(inputData.ultimoSalarioDiario, ''), 'number', true, '0.01')}
      ${input('salarioModalidad40Diario', 'SBC diario deseado Modalidad 40', valueOrDefault(inputData.salarioModalidad40Diario, ''), 'number', true, '0.01')}
      ${input('mesesAportar', 'Meses a aportar', valueOrDefault(inputData.mesesAportar, '60'), 'number', true)}
      ${input('umaDiaria', 'UMA diaria', valueOrDefault(inputData.umaDiaria, '113.14'), 'number', true, '0.01')}
      <div class="wide regime-box" data-regimen-field="ley-73">
        <h3>Solo Ley 73</h3>
        <div class="nested-grid">
          ${input('salarioPromedioActualDiario', 'Promedio diario actual en últimas 250 semanas', valueOrDefault(inputData.salarioPromedioActualDiario, ''), 'number', false, '0.01', 'data-required-when-visible="true"')}
          ${input('salarioMinimoDiario', 'Salario mínimo diario para Ley 73', valueOrDefault(inputData.salarioMinimoDiario, '278.80'), 'number', false, '0.01', 'data-required-when-visible="true"')}
        </div>
      </div>
      <div class="wide regime-box" data-regimen-field="ley-97">
        <h3>Solo Ley 97</h3>
        <p>El monto de pension no se calcula aqui porque depende del saldo AFORE y de renta vitalicia, retiro programado o pension garantizada.</p>
      </div>
      <details class="wide optional-fields"${optionalOpen ? ' open' : ''}>
        <summary>Datos opcionales del expediente</summary>
        <div class="nested-grid">
          ${input('nss', 'NSS', inputData.nss || '')}
          ${input('diasMensuales', 'Días promedio por mes', valueOrDefault(inputData.diasMensuales, '30.4'), 'number', false, '0.01')}
          <label class="wide">Notas <textarea name="notas" rows="3">${escapeHtml(inputData.notas || '')}</textarea></label>
        </div>
      </details>
      <button type="submit" class="wide">${escapeHtml(submitLabel)}</button>
    </form>
  `;
}

function input(name, label, value = '', type = 'text', required = false, step = '1', attrs = '') {
  const stepAttr = type === 'number' ? ` step="${step}"` : '';
  return `<label>${label} <input name="${name}" type="${type}" value="${escapeHtml(value)}"${stepAttr}${required ? ' required' : ''}${attrs ? ` ${attrs}` : ''}></label>`;
}

function valueOrDefault(value, fallback) {
  return value === undefined || value === null || value === '' ? fallback : value;
}

function metric(label, value) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
}

function kv(label, value) {
  return `<div class="kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function money(value) {
  return currency.format(value || 0);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
