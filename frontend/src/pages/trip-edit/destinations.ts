import { createDestination, updateDestination, deleteDestination } from '@/api/client';
import { setText } from '@/modules/dom';
import {
  searchNominatim,
  isGoogleMapsUrl,
  extractCoordsFromGoogleMapsUrl,
} from '@/modules/geocoder';
import { renderHotelSection } from './hotels';
import { renderDaysSection } from './days';
import type { ApiTrip, ApiDestination } from '@/types';

// Module-scoped state
let currentTrip: ApiTrip;
let currentTripId: string;
let editingDestId: string | null = null;

// Lazily resolved DOM references (created once, appended to body)
let modalOverlay: HTMLElement;
let modalTitle: HTMLElement;
let cityInput: HTMLInputElement;
let countryInput: HTMLInputElement;
let startInput: HTMLInputElement;
let endInput: HTMLInputElement;
let geocoderInput: HTMLInputElement;
let geocoderBtn: HTMLButtonElement;
let geocoderResults: HTMLElement;
let latInput: HTMLInputElement;
let lngInput: HTMLInputElement;
let formError: HTMLElement;

function buildModal(): void {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'dest-modal-overlay';
  overlay.setAttribute('hidden', '');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const title = document.createElement('h2');
  title.id = 'dest-modal-title';
  title.textContent = 'Agregar destino';
  modal.appendChild(title);

  const form = document.createElement('form');
  form.id = 'dest-form';

  form.appendChild(buildFormGroup('Ciudad', 'dest-city', 'city_name', 'text', true, 255));
  form.appendChild(buildFormGroup('País', 'dest-country', 'country', 'text', true, 100));

  const dateRow = document.createElement('div');
  dateRow.className = 'form-row';
  dateRow.appendChild(buildFormGroup('Llegada', 'dest-start', 'start_date', 'date', false));
  dateRow.appendChild(buildFormGroup('Salida', 'dest-end', 'end_date', 'date', false));
  form.appendChild(dateRow);

  const geocoderGroup = document.createElement('div');
  geocoderGroup.className = 'form-group';

  const geocoderLabel = document.createElement('label');
  geocoderLabel.textContent = 'Coordenadas (opcional)';
  geocoderGroup.appendChild(geocoderLabel);

  const widget = document.createElement('div');
  widget.className = 'geocoder-widget';

  const gInput = document.createElement('input');
  gInput.type = 'text';
  gInput.id = 'dest-geocoder-input';
  gInput.placeholder = 'Buscar lugar o pegar URL de Google Maps…';
  widget.appendChild(gInput);

  const gBtn = document.createElement('button');
  gBtn.type = 'button';
  gBtn.className = 'btn btn-primary';
  gBtn.id = 'dest-geocoder-btn';
  gBtn.textContent = 'Buscar lugar';
  widget.appendChild(gBtn);

  const gResults = document.createElement('div');
  gResults.className = 'geocoder-results';
  gResults.id = 'dest-geocoder-results';
  gResults.setAttribute('hidden', '');
  widget.appendChild(gResults);

  geocoderGroup.appendChild(widget);

  const latHidden = document.createElement('input');
  latHidden.type = 'hidden';
  latHidden.id = 'dest-lat';
  latHidden.name = 'lat';
  geocoderGroup.appendChild(latHidden);

  const lngHidden = document.createElement('input');
  lngHidden.type = 'hidden';
  lngHidden.id = 'dest-lng';
  lngHidden.name = 'lng';
  geocoderGroup.appendChild(lngHidden);

  form.appendChild(geocoderGroup);

  const errorP = document.createElement('p');
  errorP.className = 'error-msg';
  errorP.id = 'dest-form-error';
  errorP.setAttribute('hidden', '');
  form.appendChild(errorP);

  const actions = document.createElement('div');
  actions.className = 'form-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.id = 'dest-cancel-btn';
  cancelBtn.textContent = 'Cancelar';
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary';
  saveBtn.id = 'dest-save-btn';
  saveBtn.textContent = 'Guardar';
  actions.appendChild(saveBtn);

  form.appendChild(actions);
  modal.appendChild(form);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Cache references
  modalOverlay = overlay;
  modalTitle = title;
  cityInput = document.getElementById('dest-city') as HTMLInputElement;
  countryInput = document.getElementById('dest-country') as HTMLInputElement;
  startInput = document.getElementById('dest-start') as HTMLInputElement;
  endInput = document.getElementById('dest-end') as HTMLInputElement;
  geocoderInput = gInput;
  geocoderBtn = gBtn;
  geocoderResults = gResults;
  latInput = latHidden;
  lngInput = lngHidden;
  formError = errorP;

  // Events
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', onModalKeydown);
  gBtn.addEventListener('click', handleGeocoderSearch);
  form.addEventListener('submit', handleFormSubmit);
}

function buildFormGroup(
  labelText: string,
  inputId: string,
  inputName: string,
  inputType: string,
  required: boolean,
  maxLength?: number,
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'form-group';

  const label = document.createElement('label');
  label.setAttribute('for', inputId);
  label.textContent = labelText;
  group.appendChild(label);

  const input = document.createElement('input');
  input.type = inputType;
  input.id = inputId;
  input.name = inputName;
  if (required) input.required = true;
  if (maxLength) input.maxLength = maxLength;
  group.appendChild(input);

  return group;
}

function openModal(dest: ApiDestination | null): void {
  editingDestId = dest ? dest.id : null;
  setText(modalTitle, dest ? 'Editar destino' : 'Agregar destino');

  cityInput.value = dest?.city_name ?? '';
  countryInput.value = dest?.country ?? '';
  startInput.value = dest?.start_date ?? '';
  endInput.value = dest?.end_date ?? '';
  geocoderInput.value = '';
  latInput.value = dest ? String(dest.lat) : '';
  lngInput.value = dest ? String(dest.lng) : '';

  geocoderResults.setAttribute('hidden', '');
  geocoderResults.replaceChildren();
  formError.setAttribute('hidden', '');
  setText(formError, '');

  modalOverlay.removeAttribute('hidden');
  cityInput.focus();
}

function closeModal(): void {
  modalOverlay.setAttribute('hidden', '');
  editingDestId = null;
}

function onModalKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !modalOverlay.hasAttribute('hidden')) {
    closeModal();
  }
}

async function handleGeocoderSearch(): Promise<void> {
  const query = geocoderInput.value.trim();
  if (!query) return;

  geocoderResults.removeAttribute('hidden');
  geocoderResults.replaceChildren();
  formError.setAttribute('hidden', '');

  if (isGoogleMapsUrl(query)) {
    const coords = extractCoordsFromGoogleMapsUrl(query);
    if (coords) {
      latInput.value = coords.lat;
      lngInput.value = coords.lng;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Encontrado';
      btn.addEventListener('click', () => {
        geocoderResults.setAttribute('hidden', '');
        geocoderResults.replaceChildren();
      });
      geocoderResults.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Sin resultados. Probá con otra búsqueda.';
      btn.disabled = true;
      geocoderResults.appendChild(btn);
    }
    return;
  }

  const originalText = geocoderBtn.textContent ?? 'Buscar lugar';
  geocoderBtn.textContent = 'Buscando…';
  geocoderBtn.disabled = true;

  try {
    const results = await searchNominatim(query);
    geocoderResults.replaceChildren();

    if (results.length === 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Sin resultados. Probá con otra búsqueda.';
      btn.disabled = true;
      geocoderResults.appendChild(btn);
      return;
    }

    for (const result of results) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = result.display_name;
      btn.addEventListener('click', () => {
        latInput.value = result.lat;
        lngInput.value = result.lon;
        geocoderInput.value = result.display_name;
        geocoderResults.setAttribute('hidden', '');
        geocoderResults.replaceChildren();
      });
      geocoderResults.appendChild(btn);
    }
  } catch {
    setText(formError, 'Error al buscar la ubicación. Intentá de nuevo.');
    formError.removeAttribute('hidden');
    geocoderResults.setAttribute('hidden', '');
  } finally {
    geocoderBtn.textContent = originalText;
    geocoderBtn.disabled = false;
  }
}

async function handleFormSubmit(e: Event): Promise<void> {
  e.preventDefault();

  formError.setAttribute('hidden', '');
  const saveBtn = document.getElementById('dest-save-btn') as HTMLButtonElement | null;
  if (saveBtn) {
    saveBtn.disabled = true;
    setText(saveBtn, 'Guardando…');
  }

  const rawLat = latInput.value;
  const rawLng = lngInput.value;
  const lat = rawLat ? parseFloat(rawLat) : undefined;
  const lng = rawLng ? parseFloat(rawLng) : undefined;

  const payload: Partial<Omit<ApiDestination, 'id' | 'trip_id' | 'hotel' | 'days'>> = {
    city_name: cityInput.value.trim(),
    country: countryInput.value.trim(),
    start_date: startInput.value || null,
    end_date: endInput.value || null,
    ...(lat !== undefined && !isNaN(lat) ? { lat } : {}),
    ...(lng !== undefined && !isNaN(lng) ? { lng } : {}),
  };

  try {
    if (editingDestId) {
      const updated = await updateDestination(currentTripId, editingDestId, payload);
      const idx = currentTrip.destinations.findIndex((d) => d.id === editingDestId);
      if (idx !== -1) currentTrip.destinations[idx] = updated;
    } else {
      const created = await createDestination(currentTripId, payload);
      currentTrip.destinations.push(created);
    }
    closeModal();
    renderList();
  } catch {
    setText(formError, 'No se pudo guardar. Verificá tu conexión e intentá de nuevo.');
    formError.removeAttribute('hidden');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      setText(saveBtn, 'Guardar');
    }
  }
}

function openConfirmDelete(dest: ApiDestination): void {
  const confirmOverlay = document.getElementById('confirm-overlay');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMsg = document.getElementById('confirm-msg');
  const confirmError = document.getElementById('confirm-error');
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  const deleteBtn = document.getElementById('confirm-delete-btn');

  if (!confirmOverlay || !confirmTitle || !confirmMsg || !deleteBtn || !cancelBtn) return;

  setText(confirmTitle, '¿Eliminar destino?');
  setText(confirmMsg, 'Se eliminarán todos los días y actividades de este destino.');
  if (confirmError) confirmError.setAttribute('hidden', '');

  confirmOverlay.removeAttribute('hidden');

  // Swap button to remove prior event listeners
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
    setText(freshDelete, 'Eliminando…');
    if (confirmError) confirmError.setAttribute('hidden', '');

    try {
      await deleteDestination(currentTripId, dest.id);
      currentTrip.destinations = currentTrip.destinations.filter((d) => d.id !== dest.id);
      close();
      renderList();
    } catch {
      if (confirmError) {
        setText(confirmError, 'No se pudo eliminar. Intentá de nuevo.');
        confirmError.removeAttribute('hidden');
      }
      freshDelete.disabled = false;
      setText(freshDelete, 'Eliminar');
    }
  }, { once: true });
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return '';
  if (start && end) return `${start} – ${end}`;
  return start ?? end ?? '';
}

function renderList(): void {
  const list = document.getElementById('destinations-list');
  const emptyMsg = document.getElementById('destinations-empty');
  if (!list) return;

  list.replaceChildren();

  if (currentTrip.destinations.length === 0) {
    if (emptyMsg) emptyMsg.removeAttribute('hidden');
    return;
  }

  if (emptyMsg) emptyMsg.setAttribute('hidden', '');

  for (const dest of currentTrip.destinations) {
    const section = document.createElement('div');
    section.className = 'dest-section';

    const header = document.createElement('div');
    header.className = 'dest-section-header';

    const nameSpan = document.createElement('span');
    setText(nameSpan, `${dest.city_name}, ${dest.country}`);
    nameSpan.style.fontWeight = '600';
    nameSpan.style.flex = '1';
    header.appendChild(nameSpan);

    const dateRange = formatDateRange(dest.start_date, dest.end_date);
    if (dateRange) {
      const dateSpan = document.createElement('span');
      dateSpan.style.fontSize = '13px';
      dateSpan.style.color = 'var(--text-secondary)';
      setText(dateSpan, dateRange);
      header.appendChild(dateSpan);
    }

    const chevron = document.createElement('span');
    chevron.textContent = '▼';
    chevron.setAttribute('aria-hidden', 'true');
    header.appendChild(chevron);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', () => openModal(dest));
    header.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Eliminar';
    delBtn.addEventListener('click', () => openConfirmDelete(dest));
    header.appendChild(delBtn);

    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'dest-section-body';

    const hotelHeader = document.createElement('h3');
    hotelHeader.style.fontSize = '14px';
    hotelHeader.style.fontWeight = '600';
    hotelHeader.style.margin = '0 0 8px';
    hotelHeader.textContent = 'Hotel';
    body.appendChild(hotelHeader);

    const hotelContainer = document.createElement('div');
    hotelContainer.style.marginBottom = '16px';
    body.appendChild(hotelContainer);
    renderHotelSection(hotelContainer, dest, currentTripId);

    const daysHeader = document.createElement('h3');
    daysHeader.style.fontSize = '14px';
    daysHeader.style.fontWeight = '600';
    daysHeader.style.margin = '0 0 8px';
    daysHeader.textContent = 'Días';
    body.appendChild(daysHeader);

    const daysContainer = document.createElement('div');
    body.appendChild(daysContainer);
    renderDaysSection(daysContainer, dest, currentTripId);

    section.appendChild(body);

    list.appendChild(section);
  }
}

export function initDestinationsSection(trip: ApiTrip, tripId: string): void {
  currentTrip = trip;
  currentTripId = tripId;

  buildModal();

  const addBtn = document.getElementById('add-dest-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => openModal(null));
  }

  renderList();
}
