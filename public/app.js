const regimenSelect = document.querySelector('[data-regimen-select]');
const regimeFields = document.querySelectorAll('[data-regimen-field]');

function syncRegimenFields() {
  if (!regimenSelect) return;
  const selected = regimenSelect.value;

  regimeFields.forEach((field) => {
    const appliesTo = field.dataset.regimenField.split(/\s+/);
    const visible = appliesTo.includes(selected);
    field.hidden = !visible;
    field.querySelectorAll('input, select, textarea').forEach((control) => {
      control.disabled = !visible;
      if (control.dataset.requiredWhenVisible === 'true') {
        control.required = visible;
      }
    });
  });
}

regimenSelect?.addEventListener('change', syncRegimenFields);
syncRegimenFields();
