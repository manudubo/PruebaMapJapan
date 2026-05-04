import { upsertHotel, deleteHotel } from '@/api/client';
import { setText } from '@/modules/dom';
import {
  searchNominatim,
  isGoogleMapsUrl,
  extractCoordsFromGoogleMapsUrl,
} from '@/modules/geocoder';
import type { ApiDestination, ApiHotel } from '@/types';

// Module-scoped modal state (singleton — built once, reused per destination)
let modalOverlay: HTMLElement | null = null;
let modalTitle: HTMLElement;
let nameInput: HTMLInputElement;
let urlInput: HTMLInputElement;
let checkInInput: HTMLInputElement;
let checkOutInput: HTMLInputElement;
let geocoderInput: HTMLInputElement;
let geocoderBtn: HTMLButtonElement;
let geocoderResults: HTMLElement;
let latInput: HTMLInputElement;
let lngInput: HTMLInputElement;
let formError: HTMLElement;

// Current context set when modal opens
let currentTripId: string;
let currentDest: ApiDestination;
let currentContainer: HTMLElement;

function buildModal(): void {
  if (modalOverlay) return;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'hotel-modal-overlay';
  overlay.setAttribute('hidden', '');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const title = document.createElement('h2');
  title.id = 'hotel-modal-title';
  title.textContent = 'Agregar hotel';
  modal.appendChild(title);

  const form = document.createElement('form');
  form.id = 'hotel-form';

  form.appendChild(buildFormGroup('Nombre', 'hotel-name', 'name', 'text', true, 255));
  form.appendChild(buildFormGroup('URL', 'hotel-url', 'url', 'url', false));
  (form.querySelector('#hotel-url') as HTMLInputElement).placeholder = 'https://…';

  const dateRow = document.createElement('div');
  dateRow.className = 'form-row';
  dateRow.appendChild(buildFormGroup('Check-in', 'hotel-check-in', 'check_in_date', 'date', false));
  dateRow.appendChild(buildFormGroup('Check-out', 'hotel-check-out', 'check_out_date', 'date', false));
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
  gInput.id = 'hotel-geocoder-input';
  gInput.placeholder = 'Buscar lugar o pegar URL de Google Maps…';
  widget.appendChild(gInput);

  const gBtn = document.createElement('button');
  gBtn.type = 'button';
  gBtn.className = 'btn btn-primary';
  gBtn.id = 'hotel-geocoder-btn';
  gBtn.textContent = 'Buscar lugar';
  widget.appendChild(gBtn);

  const gResults = document.createElement('div');
  gResults.className = 'geocoder-results';
  gResults.id = 'hotel-geocoder-results';
  gResults.setAttribute('hidden', '');
  widget.appendChild(gResults);

  geocoderGroup.appendChild(widget);

  const latHidden = document.createElement('input');
  latHidden.type = 'hidden';
  latHidden.id = 'hotel-lat';
  latHidden.name = 'lat';
  geocoderGroup.appendChild(latHidden);

  const lngHidden = document.createElement('input');
  lngHidden.type = 'hidden';
  lngHidden.id = 'hotel-lng';
  lngHidden.name = 'lng';
  geocoderGroup.appendChild(lngHidden);

  form.appendChild(geocoderGroup);

  const errorP = document.createElement('p');
  errorP.className = 'error-msg';
  errorP.id = 'hotel-form-error';
  errorP.setAttribute('hidden', '');
  form.appendChild(errorP);

  const actions = document.createElement('div');
  actions.className = 'form-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.id = 'hotel-cancel-btn';
  cancelBtn.textContent = 'Cancelar';
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary';
  saveBtn.id = 'hotel-save-btn';
  saveBtn.textContent = 'Guardar';
  actions.appendChild(saveBtn);

  form.appendChild(actions);
  modal.appendChild(form);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Cache references
  modalOverlay = overlay;
  modalTitle = title;
  nameInput = document.getElementById('hotel-name') as HTMLInputElement;
  urlInput = document.getElementById('hotel-url') as HTMLInputElement;
  checkInInput = document.getElementById('hotel-check-in') as HTMLInputElement;
  checkOutInput = document.getElementById('hotel-check-out') as HTMLInputElement;
  geocoderInput = gInput;
  geocoderBtn = gBtn;
  geocoderResults = gResults;
  latInput = latHidden;
  lngInput = lngHidden;
  formError = errorP;

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

function openModal(hotel: ApiHotel | undefined): void {
  buildModal();

  setText(modalTitle, hotel ? 'Editar hotel' : 'Agregar hotel');

  nameInput.value = hotel?.name ?? '';
  urlInput.value = hotel?.url ?? '';
  checkInInput.value = hotel?.check_in_date ?? '';
  checkOutInput.value = hotel?.check_out_date ?? '';
  geocoderInput.value = '';
  latInput.value = hotel ? String(hotel.lat) : '';
  lngInput.value = hotel ? String(hotel.lng) : '';

  geocoderResults.setAttribute('hidden', '');
  geocoderResults.replaceChildren();
  formError.setAttribute('hidden', '');
  setText(formError, '');

  modalOverlay!.removeAttribute('hidden');
  nameInput.focus();
}

function closeModal(): void {
  if (modalOverlay) modalOverlay.setAttribute('hidden', '');
}

function onModalKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && modalOverlay && !modalOverlay.hasAttribute('hidden')) {
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
  const saveBtn = document.getElementById('hotel-save-btn') as HTMLButtonElement | null;
  if (saveBtn) {
    saveBtn.disabled = true;
    setText(saveBtn, 'Guardando…');
  }

  const rawLat = latInput.value;
  const rawLng = lngInput.value;

  try {
    const updated = await upsertHotel(currentTripId, currentDest.id, {
      name: nameInput.value.trim(),
      url: urlInput.value.trim() || null,
      check_in_date: checkInInput.value || null,
      check_out_date: checkOutInput.value || null,
      ...(rawLat ? { lat: Number(rawLat) } : {}),
      ...(rawLng ? { lng: Number(rawLng) } : {}),
    });
    currentDest.hotel = updated;
    closeModal();
    renderHotelDisplay(currentContainer, currentDest, currentTripId);
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

function openConfirmDelete(): void {
  const confirmOverlay = document.getElementById('confirm-overlay');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMsg = document.getElementById('confirm-msg');
  const confirmError = document.getElementById('confirm-error');
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  const deleteBtn = document.getElementById('confirm-delete-btn');

  if (!confirmOverlay || !confirmTitle || !confirmMsg || !deleteBtn || !cancelBtn) return;

  setText(confirmTitle, '¿Eliminar hotel?');
  setText(confirmMsg, 'Esta acción no se puede deshacer.');
  if (confirmError) confirmError.setAttribute('hidden', '');

  confirmOverlay.removeAttribute('hidden');

  // Swap buttons to remove prior event listeners
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
      await deleteHotel(currentTripId, currentDest.id);
      currentDest.hotel = undefined;
      close();
      renderHotelDisplay(currentContainer, currentDest, currentTripId);
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

function renderHotelDisplay(
  container: HTMLElement,
  dest: ApiDestination,
  tripId: string,
): void {
  container.replaceChildren();

  if (!dest.hotel) {
    const empty = document.createElement('p');
    setText(empty, 'Sin hotel asignado.');
    empty.style.color = 'var(--text-secondary, #515154)';
    empty.style.margin = '0 0 8px';
    container.appendChild(empty);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-secondary';
    addBtn.textContent = 'Agregar hotel';
    addBtn.addEventListener('click', () => {
      currentTripId = tripId;
      currentDest = dest;
      currentContainer = container;
      openModal(undefined);
    });
    container.appendChild(addBtn);
    return;
  }

  const hotel = dest.hotel;

  const nameEl = document.createElement('p');
  nameEl.style.fontWeight = '600';
  nameEl.style.margin = '0 0 4px';
  setText(nameEl, hotel.name);
  container.appendChild(nameEl);

  if (hotel.url) {
    const urlEl = document.createElement('p');
    urlEl.style.margin = '0 0 4px';
    urlEl.style.fontSize = '13px';
    urlEl.style.color = 'var(--text-secondary, #515154)';
    setText(urlEl, hotel.url);
    container.appendChild(urlEl);
  }

  if (hotel.check_in_date || hotel.check_out_date) {
    const datesEl = document.createElement('p');
    datesEl.style.margin = '0 0 8px';
    datesEl.style.fontSize = '13px';
    datesEl.style.color = 'var(--text-secondary, #515154)';
    const dateText = [hotel.check_in_date, hotel.check_out_date]
      .filter(Boolean)
      .join(' – ');
    setText(datesEl, dateText);
    container.appendChild(datesEl);
  }

  const actions = document.createElement('div');
  actions.className = 'section-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-secondary';
  editBtn.textContent = 'Editar';
  editBtn.addEventListener('click', () => {
    currentTripId = tripId;
    currentDest = dest;
    currentContainer = container;
    openModal(hotel);
  });
  actions.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-danger';
  delBtn.textContent = 'Eliminar';
  delBtn.addEventListener('click', () => {
    currentTripId = tripId;
    currentDest = dest;
    currentContainer = container;
    openConfirmDelete();
  });
  actions.appendChild(delBtn);

  container.appendChild(actions);
}

export function renderHotelSection(
  container: HTMLElement,
  dest: ApiDestination,
  tripId: string,
): void {
  currentTripId = tripId;
  currentDest = dest;
  currentContainer = container;
  renderHotelDisplay(container, dest, tripId);
}
