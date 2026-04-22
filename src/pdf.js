import PDFDocument from 'pdfkit';

export function buildCalculationPdf(calculation) {
  const input = JSON.parse(calculation.input_json);
  const payload = JSON.parse(calculation.result_json);
  const { result, rates, warnings } = payload;

  const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  doc.fontSize(18).text('Calculo Modalidad 40', { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#555').text(`Folio: ${calculation.id}`);
  doc.text(`Fecha: ${calculation.created_at}`);
  doc.text(`Version del calculo: ${calculation.engine_version}`);
  doc.moveDown();

  section(doc, 'Datos');
  row(doc, 'Nombre', input.nombre || 'Sin nombre');
  row(doc, 'NSS', input.nss || '-');
  row(doc, 'Regimen', input.regimen === 'ley-73' ? 'Ley 73' : 'Ley 97');
  row(doc, 'Edad actual / retiro', `${input.edadActual} / ${input.edadRetiro}`);
  row(doc, 'Semanas actuales', number(input.semanasCotizadas));
  row(doc, 'Meses a aportar', number(input.mesesAportar));
  row(doc, 'SBC Modalidad 40', money(result.sbcDiario));
  row(doc, 'UMA diaria', money(input.umaDiaria));

  doc.moveDown();
  section(doc, 'Resultado');
  row(doc, 'Tasa mensual aplicada', percent(rates.total));
  row(doc, 'Pago mensual estimado', money(result.pagoMensual));
  row(doc, 'Costo total estimado', money(result.costoTotal));
  row(doc, 'Semanas generadas', number(result.weeksFromM40));
  row(doc, 'Semanas finales', number(result.semanasFinales));
  if (input.regimen === 'ley-73') {
    row(doc, 'Promedio diario ultimas 250 semanas', money(result.salarioPromedio250));
    row(doc, 'Pension mensual Ley 73 estimada', money(result.pensionLey73.mensual));
  } else {
    row(doc, 'Semanas requeridas Ley 97', number(result.pensionLey97?.semanasRequeridas || 875));
    row(doc, 'Estatus Ley 97', result.pensionLey97
      ? (result.pensionLey97.elegible ? 'Cumple semanas' : `Faltan ${number(result.pensionLey97.semanasFaltantes)} semanas`)
      : 'Recalcular con la version actual');
    row(doc, 'Monto de pension Ley 97', 'No estimado: depende del saldo AFORE y modalidad autorizada.');
  }

  if (warnings?.length) {
    doc.moveDown();
    section(doc, 'Observaciones');
    warnings.forEach((warning) => doc.fontSize(10).fillColor('#333').text(`- ${warning}`));
  }

  if (input.notas) {
    doc.moveDown();
    section(doc, 'Notas');
    doc.fontSize(10).fillColor('#333').text(input.notas);
  }

  doc.moveDown(2);
  doc.fontSize(8).fillColor('#666').text(
    'Documento informativo. La pension definitiva depende de la resolucion del IMSS y de los datos oficiales del asegurado.'
  );

  doc.end();

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function section(doc, title) {
  doc.fontSize(13).fillColor('#111').text(title);
  doc.moveTo(48, doc.y + 3).lineTo(564, doc.y + 3).strokeColor('#ddd').stroke();
  doc.moveDown(0.6);
}

function row(doc, label, value) {
  doc.fontSize(10).fillColor('#555').text(label, { continued: true, width: 210 });
  doc.fillColor('#111').text(String(value));
}

function money(value) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value || 0);
}

function number(value) {
  return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(value || 0);
}

function percent(value) {
  return new Intl.NumberFormat('es-MX', { style: 'percent', minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value || 0);
}
