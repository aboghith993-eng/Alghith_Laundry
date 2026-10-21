(() => {
  const toggle = document.querySelector('[data-menu-toggle]');
  const sidebar = document.querySelector('[data-sidebar]');
  if (toggle && sidebar) toggle.addEventListener('click', () => sidebar.classList.toggle('open'));

  document.querySelectorAll('[data-dismiss]').forEach(button => {
    button.addEventListener('click', () => button.closest('.flash')?.remove());
  });

  const personSelect = document.getElementById('employee-select');
  const personWrap = document.getElementById('person-name-wrap');
  const personName = document.getElementById('person-name');
  const updatePerson = () => {
    if (!personSelect || !personWrap || !personName) return;
    const selected = personSelect.options[personSelect.selectedIndex];
    const isGeneral = selected?.dataset.type === 'general';
    personWrap.classList.toggle('hidden-field', !isGeneral);
    personName.required = isGeneral;
    if (!isGeneral) personName.value = '';
  };
  personSelect?.addEventListener('change', updatePerson);
  updatePerson();

  const shiftBox = document.querySelector('[data-shift-hint]');
  const shiftSummary = shiftBox?.querySelector('[data-shift-summary]');
  const shiftWarning = shiftBox?.querySelector('[data-shift-warning]');
  const serviceDateInput = document.querySelector('input[name="service_date"]');
  const updateShiftHint = () => {
    if (!shiftBox || !personSelect) return;
    const option = personSelect.options[personSelect.selectedIndex];
    const serviceType = option?.dataset.service || '';
    if (!option || !option.value || !serviceType) {
      shiftBox.classList.add('hidden-field');
      return;
    }
    const workDays = Number(option.dataset.work || 0);
    const restDays = Number(option.dataset.rest || 0);
    const cycleLength = workDays + restDays;
    const anchor = option.dataset.anchor || '';
    const parts = [`نوع الخدمة: ${serviceType}`];
    if (option.dataset.shift) parts.push(`نظام الدوام: ${option.dataset.shift}`);
    if (option.dataset.housing) parts.push(`السكن: ${option.dataset.housing}`);
    if (option.dataset.job) parts.push(`المسمى: ${option.dataset.job}`);
    if (cycleLength > 0) parts.push(`${workDays} يوم عمل / ${restDays} يوم راحة`);
    if (option.dataset.status) parts.push(`الحالة المسجلة: ${option.dataset.status}`);
    const warnings = [];
    if (serviceType !== 'سكن' && serviceType !== 'نقل-سكن') {
      warnings.push(`نوع خدمة الموظف «${serviceType}» وليس «سكن»، فهذه الخدمة تخص السكن فقط.`);
    }
    const target = serviceDateInput?.value;
    if (anchor && target && cycleLength > 0) {
      const diff = Math.floor((new Date(target) - new Date(anchor)) / 86400000);
      const day = ((diff % cycleLength) + cycleLength) % cycleLength + 1;
      const onDuty = day <= workDays;
      parts.push(onDuty ? `الدورة يوم ${day}: دوام` : `الدورة يوم ${day}: راحة`);
      if (!onDuty) {
        warnings.push(`التاريخ ${target} يقع في مرحلة الراحة لدورة دوام الموظف (اليوم ${day} من ${cycleLength}).`);
      }
    }
    shiftSummary.textContent = parts.join(' · ');
    shiftBox.classList.remove('hidden-field');
    if (warnings.length) {
      shiftWarning.textContent = warnings.join(' ');
      shiftWarning.classList.remove('hidden-field');
    } else {
      shiftWarning.textContent = '';
      shiftWarning.classList.add('hidden-field');
    }
  };
  personSelect?.addEventListener('change', updateShiftHint);
  serviceDateInput?.addEventListener('change', updateShiftHint);
  updateShiftHint();
  const employeeSearch = document.querySelector('[data-employee-search]');
  const selectByValue = value => {
    if (!personSelect || personSelect.value === value) return;
    personSelect.value = value;
    personSelect.dispatchEvent(new Event('change', {bubbles: true}));
  };
  employeeSearch?.addEventListener('input', () => {
    if (!personSelect) return;
    const term = employeeSearch.value.trim().toLocaleLowerCase();
    let firstMatch = '';
    let exactMatch = '';
    Array.from(personSelect.options).forEach((option, index) => {
      if (index === 0) { option.hidden = false; return; }
      const text = `${option.textContent || ''} ${option.value}`.toLocaleLowerCase();
      const code = (option.dataset.code || '').toLocaleLowerCase();
      const match = Boolean(term) && (text.includes(term) || code === term);
      option.hidden = Boolean(term) && !match;
      if (match) {
        if (!firstMatch) firstMatch = option.value;
        if (!exactMatch && (code === term || text.startsWith(term))) exactMatch = option.value;
      }
    });
    if (!term) {
      personSelect.value = '';
    } else if (exactMatch) {
      selectByValue(exactMatch);
    } else if (firstMatch) {
      selectByValue(firstMatch);
    } else {
      personSelect.value = '';
    }
    updatePerson();
    updateShiftHint();
  });

  const lines = document.querySelector('[data-order-lines]');
  const template = document.getElementById('order-line-template');
  const grand = document.querySelector('[data-grand-total]');
  const recalc = () => {
    if (!lines) return;
    let total = 0;
    lines.querySelectorAll('[data-order-line]').forEach(line => {
      const select = line.querySelector('select[name="service_item_id"]');
      const quantity = line.querySelector('input[name="quantity"]');
      const option = select?.options[select.selectedIndex];
      const rate = Number(option?.dataset.rate || 0);
      const qty = Number(quantity?.value || 0);
      const lineTotal = rate * qty;
      total += lineTotal;
      const rateNode = line.querySelector('.line-rate');
      const totalNode = line.querySelector('.line-total');
      if (rateNode) rateNode.textContent = option?.value ? `${rate.toLocaleString('en-US',{maximumFractionDigits:2})} / ${option.dataset.unit || ''}` : '—';
      if (totalNode) totalNode.textContent = option?.value ? lineTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
    });
    if (grand) grand.textContent = total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  };
  lines?.addEventListener('change', event => { if (event.target.matches('select,input')) recalc(); });
  lines?.addEventListener('input', event => { if (event.target.matches('select,input')) recalc(); });
  lines?.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-line]');
    if (!remove) return;
    const all = lines.querySelectorAll('[data-order-line]');
    if (all.length > 1) remove.closest('[data-order-line]')?.remove();
    else {
      const row = remove.closest('[data-order-line]');
      const select = row.querySelector('select');
      const quantity = row.querySelector('input[name="quantity"]');
      if (select) select.value = '';
      if (quantity) quantity.value = '1';
    }
    recalc();
  });
  document.querySelector('[data-add-line]')?.addEventListener('click', () => {
    if (!template || !lines) return;
    lines.appendChild(template.content.cloneNode(true));
    recalc();
    lines.querySelector('[data-order-line]:last-child select')?.focus();
  });
  recalc();

  document.querySelectorAll('[data-confirm-delivery]').forEach(button => {
    button.addEventListener('click', event => {
      if (!window.confirm('هل تؤكد أنك سلّمت الملابس أو المفروشات النظيفة للموظف؟')) event.preventDefault();
    });
  });
  document.querySelectorAll('[data-confirm-delete]').forEach(form => {
    form.addEventListener('submit', event => {
      if (!window.confirm('هل تريد حذف الطلب غير المعتمد نهائياً؟')) event.preventDefault();
    });
  });
  document.querySelectorAll('[data-confirm-reject]').forEach(button => {
    button.addEventListener('click', event => {
      const reason = button.closest('form')?.querySelector('[name="rejection_reason"]');
      if (!reason?.value.trim()) {
        event.preventDefault();
        reason?.focus();
        reason?.reportValidity();
      } else if (!window.confirm('هل تريد رفض الطلب وإعادته للمراجعة؟')) event.preventDefault();
    });
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', {scope: '/'}).catch(() => {}));
  }
})();
