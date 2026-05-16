import { createDay, updateDay, deleteDay } from '@/api/client';
import { setText, setStyle } from '@/modules/dom';
import type { ApiDay, ApiDestination } from '@/types';
import { renderActivitiesSection } from './activities';

const COLOR_MAP: Record<string, string> = {
  '--marker-1': '#ff3b30',
  '--marker-2': '#ff9500',
  '--marker-3': '#ffcc00',
  '--marker-4': '#34c759',
  '--marker-5': '#5ac8fa',
  '--marker-6': '#007aff',
  '--marker-7': '#af52de',
  '--marker-8': '#ff2d55',
};

const REVERSE_COLOR_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(COLOR_MAP).map(([k, v]) => [v, k])
);

// Module-scoped modal state (singleton — built once, reused per call)
let modalOverlay: HTMLElement | null = null;
let modalTitle: HTMLElement;
let labelInput: HTMLInputElement;
let dateInput: HTMLInputElement;
let swatchContainer: HTMLElement;
let formError: HTMLElement;

// Module-scoped color selection state
let selectedColor: string | null = null;

// Current context set when modal opens or generate is triggered
let currentTripId: string;
let currentDest: ApiDestination;
let currentContainer: HTMLElement;
let editingDayId: string | null = null;

function buildModal(): void {
  if (modalOverlay) return;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'day-modal-overlay';
  overlay.setAttribute('hidden', '');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const title = document.createElement('h2');
  title.id = 'day-modal-title';
  title.textContent = 'Add day';
  modal.appendChild(title);

  const form = document.createElement('form');
  form.id = 'day-form';

  // Label field (optional)
  const labelGroup = document.createElement('div');
  labelGroup.className = 'form-group';
  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', 'day-label');
  labelEl.textContent = 'Label';
  labelGroup.appendChild(labelEl);
  const lInput = document.createElement('input');
  lInput.type = 'text';
  lInput.id = 'day-label';
  lInput.name = 'label';
  lInput.maxLength = 255;
  lInput.placeholder = 'E.g.: Free day in Tokyo';
  labelGroup.appendChild(lInput);
  form.appendChild(labelGroup);

  // Date field (required)
  const dateGroup = document.createElement('div');
  dateGroup.className = 'form-group';
  const dateLabelEl = document.createElement('label');
  dateLabelEl.setAttribute('for', 'day-date');
  dateLabelEl.textContent = 'Date';
  dateGroup.appendChild(dateLabelEl);
  const dInput = document.createElement('input');
  dInput.type = 'date';
  dInput.id = 'day-date';
  dInput.name = 'date';
  dInput.required = true;
  dateGroup.appendChild(dInput);
  form.appendChild(dateGroup);

  // Color picker
  const colorGroup = document.createElement('div');
  colorGroup.className = 'form-group';
  const colorLabelEl = document.createElement('label');
  colorLabelEl.textContent = 'Color';
  colorGroup.appendChild(colorLabelEl);

  const swatches = document.createElement('div');
  swatches.className = 'color-swatches';
  swatches.style.display = 'flex';
  swatches.style.gap = '8px';
  swatches.style.flexWrap = 'wrap';

  for (let n = 1; n <= 8; n++) {
    const varName = `--marker-${n}`;
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch';
    swatch.dataset['color'] = varName;
    swatch.setAttribute('aria-label', `Color ${n}`);
    swatch.setAttribute('aria-pressed', 'false');
    setStyle(swatch, 'background', `var(${varName})`);
    swatch.style.width = '24px';
    swatch.style.height = '24px';
    swatch.style.border = '2px solid transparent';
    swatch.style.cursor = 'pointer';
    swatch.style.flexShrink = '0';

    swatch.addEventListener('click', () => {
      const allSwatches = swatches.querySelectorAll<HTMLButtonElement>('.color-swatch');
      allSwatches.forEach((s) => {
        s.classList.remove('selected');
        s.setAttribute('aria-pressed', 'false');
        s.style.borderColor = 'transparent';
      });
      swatch.classList.add('selected');
      swatch.setAttribute('aria-pressed', 'true');
      swatch.style.borderColor = 'var(--text-primary, #1d1d1f)';
      selectedColor = varName;
    });

    swatches.appendChild(swatch);
  }

  colorGroup.appendChild(swatches);
  form.appendChild(colorGroup);

  const errorP = document.createElement('p');
  errorP.className = 'error-msg';
  errorP.id = 'day-form-error';
  errorP.setAttribute('hidden', '');
  form.appendChild(errorP);

  const actions = document.createElement('div');
  actions.className = 'form-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.id = 'day-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary';
  saveBtn.id = 'day-save-btn';
  saveBtn.textContent = 'Save';
  actions.appendChild(saveBtn);

  form.appendChild(actions);
  modal.appendChild(form);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modalOverlay = overlay;
  modalTitle = title;
  labelInput = lInput;
  dateInput = dInput;
  swatchContainer = swatches;
  formError = errorP;

  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', onModalKeydown);
  form.addEventListener('submit', handleFormSubmit);
}

function openModal(day: ApiDay | null): void {
  buildModal();

  editingDayId = day ? day.id : null;
  selectedColor = null;

  setText(modalTitle, day ? 'Edit day' : 'Add day');
  labelInput.value = day?.label ?? '';
  dateInput.value = day?.date ?? '';

  const allSwatches = swatchContainer.querySelectorAll<HTMLButtonElement>('.color-swatch');
  allSwatches.forEach((s) => {
    s.classList.remove('selected');
    s.setAttribute('aria-pressed', 'false');
    s.style.borderColor = 'transparent';
  });

  if (day?.color_hex) {
    const existingVarName = REVERSE_COLOR_MAP[day.color_hex];
    if (existingVarName) {
      allSwatches.forEach((s) => {
        const isSelected = s.dataset['color'] === existingVarName;
        if (isSelected) {
          s.classList.add('selected');
          s.setAttribute('aria-pressed', 'true');
          s.style.borderColor = 'var(--text-primary, #1d1d1f)';
        }
      });
      selectedColor = existingVarName;
    }
  }

  formError.setAttribute('hidden', '');
  setText(formError, '');

  modalOverlay!.removeAttribute('hidden');
  labelInput.focus();
}

function closeModal(): void {
  if (modalOverlay) modalOverlay.setAttribute('hidden', '');
  editingDayId = null;
}

function onModalKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && modalOverlay && !modalOverlay.hasAttribute('hidden')) {
    closeModal();
  }
}

async function handleFormSubmit(e: Event): Promise<void> {
  e.preventDefault();

  formError.setAttribute('hidden', '');
  const saveBtn = document.getElementById('day-save-btn') as HTMLButtonElement | null;
  if (saveBtn) {
    saveBtn.disabled = true;
    setText(saveBtn, 'Saving…');
  }

  const colorHex = selectedColor ? (COLOR_MAP[selectedColor] ?? null) : null;
  const dateValue = dateInput.value;
  const labelValue = labelInput.value.trim();

  try {
    if (editingDayId) {
      const updated = await updateDay(currentTripId, currentDest.id, editingDayId, {
        date: dateValue,
        label: labelValue || '',
        ...(colorHex ? { color_hex: colorHex } : {}),
      });
      const idx = currentDest.days.findIndex((d) => d.id === editingDayId);
      if (idx !== -1) currentDest.days[idx] = updated;
    } else {
      const created = await createDay(currentTripId, currentDest.id, {
        date: dateValue,
        label: labelValue || '',
        ...(colorHex ? { color_hex: colorHex } : {}),
      });
      currentDest.days.push(created);
    }
    closeModal();
    renderDaysDisplay(currentContainer, currentDest, currentTripId);
  } catch {
    setText(formError, 'Could not save. Check your connection and try again.');
    formError.removeAttribute('hidden');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      setText(saveBtn, 'Save');
    }
  }
}

function openConfirmDelete(day: ApiDay): void {
  const confirmOverlay = document.getElementById('confirm-overlay');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMsg = document.getElementById('confirm-msg');
  const confirmError = document.getElementById('confirm-error');
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  const deleteBtn = document.getElementById('confirm-delete-btn');

  if (!confirmOverlay || !confirmTitle || !confirmMsg || !deleteBtn || !cancelBtn) return;

  setText(confirmTitle, 'Delete day?');
  setText(confirmMsg, 'All activities for this day will be deleted.');
  if (confirmError) confirmError.setAttribute('hidden', '');

  confirmOverlay.removeAttribute('hidden');

  const freshDelete = deleteBtn.cloneNode(true) as HTMLButtonElement;
  deleteBtn.parentNode?.replaceChild(freshDelete, deleteBtn);

  const freshCancel = cancelBtn.cloneNode(true) as HTMLButtonElement;
  cancelBtn.parentNode?.replaceChild(freshCancel, cancelBtn);

  const close = (): void => {
    confirmOverlay.setAttribute('hidden', '');
    document.removeEventListener('keydown', onEscape);
  };

  const onEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onEscape);

  freshCancel.addEventListener('click', close, { once: true });

  freshDelete.addEventListener('click', async () => {
    freshDelete.disabled = true;
    setText(freshDelete, 'Deleting…');
    if (confirmError) confirmError.setAttribute('hidden', '');

    try {
      await deleteDay(currentTripId, currentDest.id, day.id);
      currentDest.days = currentDest.days.filter((d) => d.id !== day.id);
      close();
      renderDaysDisplay(currentContainer, currentDest, currentTripId);
    } catch {
      if (confirmError) {
        setText(confirmError, 'Could not delete. Please try again.');
        confirmError.removeAttribute('hidden');
      }
      freshDelete.disabled = false;
      setText(freshDelete, 'Delete');
    }
  }, { once: true });
}

async function generateDays(
  dest: ApiDestination,
  tripId: string,
  genBtn: HTMLButtonElement,
  genError: HTMLElement,
): Promise<void> {
  if (!dest.start_date || !dest.end_date) {
    setText(genError, 'The destination has no dates defined. Edit the destination to add dates.');
    genError.removeAttribute('hidden');
    return;
  }

  const existingDates = new Set(dest.days.map((d) => d.date));

  const current = new Date(dest.start_date);
  const end = new Date(dest.end_date);
  const promises: Promise<ApiDay>[] = [];

  while (current <= end) {
    const iso = current.toISOString().slice(0, 10);
    if (!existingDates.has(iso)) {
      promises.push(createDay(tripId, dest.id, { date: iso }));
    }
    current.setDate(current.getDate() + 1);
  }

  if (promises.length === 0) {
    setText(genError, 'All days in this period already exist.');
    genError.removeAttribute('hidden');
    return;
  }

  try {
    const created = await Promise.all(promises);
    dest.days.push(...created);
    renderDaysDisplay(currentContainer, dest, tripId);
  } catch {
    setText(genError, 'Could not generate all days. Please try again.');
    genError.removeAttribute('hidden');
    genBtn.disabled = false;
    setText(genBtn, 'Generate all days');
  }
}

function renderDaysDisplay(
  container: HTMLElement,
  dest: ApiDestination,
  tripId: string,
): void {
  container.replaceChildren();

  // Action buttons row
  const actionsRow = document.createElement('div');
  actionsRow.style.display = 'flex';
  actionsRow.style.gap = '8px';
  actionsRow.style.marginBottom = '12px';
  actionsRow.style.flexWrap = 'wrap';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-secondary';
  addBtn.textContent = 'Add day';
  addBtn.addEventListener('click', () => {
    currentTripId = tripId;
    currentDest = dest;
    currentContainer = container;
    openModal(null);
  });
  actionsRow.appendChild(addBtn);

  const genBtn = document.createElement('button');
  genBtn.type = 'button';
  genBtn.className = 'btn btn-secondary';
  genBtn.textContent = 'Generate all days';

  const genError = document.createElement('p');
  genError.className = 'error-msg';
  genError.setAttribute('hidden', '');

  genBtn.addEventListener('click', async () => {
    genBtn.disabled = true;
    setText(genBtn, 'Generating…');
    genError.setAttribute('hidden', '');
    currentTripId = tripId;
    currentDest = dest;
    currentContainer = container;
    await generateDays(dest, tripId, genBtn, genError);
    genBtn.disabled = false;
    setText(genBtn, 'Generate all days');
  });

  actionsRow.appendChild(genBtn);
  container.appendChild(actionsRow);
  container.appendChild(genError);

  // Empty state
  if (dest.days.length === 0) {
    const emptyP = document.createElement('p');
    setText(emptyP, 'No days. Add a day or use "Generate all days".');
    emptyP.style.color = 'var(--text-secondary, #515154)';
    emptyP.style.margin = '0';
    container.appendChild(emptyP);
    return;
  }

  // Day rows
  const sorted = [...dest.days].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of sorted) {
    const row = document.createElement('div');
    row.className = 'day-row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '8px 0';
    row.style.borderBottom = '1px solid var(--border-color, rgba(0,0,0,0.1))';

    // Color swatch square
    const colorDot = document.createElement('div');
    colorDot.style.width = '24px';
    colorDot.style.height = '24px';
    colorDot.style.flexShrink = '0';
    if (day.color_hex) {
      colorDot.style.backgroundColor = day.color_hex;
    } else {
      colorDot.style.backgroundColor = 'var(--border-color, rgba(0,0,0,0.1))';
    }
    row.appendChild(colorDot);

    // Label + date
    const info = document.createElement('div');
    info.style.flex = '1';
    info.style.minWidth = '0';

    if (day.label) {
      const labelEl = document.createElement('p');
      labelEl.style.margin = '0';
      labelEl.style.fontWeight = '600';
      labelEl.style.overflow = 'hidden';
      labelEl.style.textOverflow = 'ellipsis';
      labelEl.style.whiteSpace = 'nowrap';
      setText(labelEl, day.label);
      info.appendChild(labelEl);
    }

    const dateEl = document.createElement('p');
    dateEl.style.margin = '0';
    dateEl.style.fontSize = '13px';
    dateEl.style.color = 'var(--text-secondary, #515154)';
    setText(dateEl, day.date);
    info.appendChild(dateEl);

    row.appendChild(info);

    // Editar button
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      currentTripId = tripId;
      currentDest = dest;
      currentContainer = container;
      openModal(day);
    });
    row.appendChild(editBtn);

    // Eliminar button
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      currentTripId = tripId;
      currentDest = dest;
      currentContainer = container;
      openConfirmDelete(day);
    });
    row.appendChild(delBtn);

    container.appendChild(row);

    const activitiesContainer = document.createElement('div');
    activitiesContainer.id = `activities-${day.id}`;
    container.appendChild(activitiesContainer);
    renderActivitiesSection(activitiesContainer, day, tripId, dest.id);
  }
}

export function renderDaysSection(
  container: HTMLElement,
  dest: ApiDestination,
  tripId: string,
): void {
  currentTripId = tripId;
  currentDest = dest;
  currentContainer = container;
  renderDaysDisplay(container, dest, tripId);
}
