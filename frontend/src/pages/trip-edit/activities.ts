import {
  createActivity,
  updateActivity,
  deleteActivity,
  reorderActivities,
} from '@/api/client';
import { setText } from '@/modules/dom';
import {
  searchNominatim,
  isGoogleMapsUrl,
  extractCoordsFromGoogleMapsUrl,
} from '@/modules/geocoder';
import type { ApiActivity, ApiDay } from '@/types';
import { buildCheckbox, isHttpUrl, saveErrorMessage } from './formHelpers';

// Module-scoped modal state (singleton — built once, reused per call)
let modalOverlay: HTMLElement | null = null;
let modalTitle: HTMLElement;
let nameInput: HTMLInputElement;
let timeInput: HTMLInputElement;
let notesInput: HTMLTextAreaElement;
let geocoderInput: HTMLInputElement;
let geocoderBtn: HTMLButtonElement;
let geocoderResults: HTMLElement;
let latInput: HTMLInputElement;
let lngInput: HTMLInputElement;
let mapsUrlInput: HTMLInputElement;
let optionalInput: HTMLInputElement;
let genericInput: HTMLInputElement;
let formError: HTMLElement;

// Current context
let currentTripId: string;
let currentDestId: string;
let currentDay: ApiDay;
let currentContainer: HTMLElement;
let editingActivityId: string | null = null;

function buildModal(): void {
  if (modalOverlay) return;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'act-modal-overlay';
  overlay.setAttribute('hidden', '');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const title = document.createElement('h2');
  title.id = 'act-modal-title';
  title.textContent = 'Add activity';
  modal.appendChild(title);

  const form = document.createElement('form');
  form.id = 'act-form';

  // Name field
  const nameGroup = document.createElement('div');
  nameGroup.className = 'form-group';
  const nameLabelEl = document.createElement('label');
  nameLabelEl.setAttribute('for', 'act-name');
  nameLabelEl.textContent = 'Name';
  nameGroup.appendChild(nameLabelEl);
  const nInput = document.createElement('input');
  nInput.type = 'text';
  nInput.id = 'act-name';
  nInput.name = 'name';
  nInput.required = true;
  nInput.maxLength = 255;
  nameGroup.appendChild(nInput);
  form.appendChild(nameGroup);

  // Time field
  const timeGroup = document.createElement('div');
  timeGroup.className = 'form-group';
  const timeLabelEl = document.createElement('label');
  timeLabelEl.setAttribute('for', 'act-time');
  timeLabelEl.textContent = 'Time (optional)';
  timeGroup.appendChild(timeLabelEl);
  const tInput = document.createElement('input');
  tInput.type = 'time';
  tInput.id = 'act-time';
  tInput.name = 'time';
  timeGroup.appendChild(tInput);
  form.appendChild(timeGroup);

  // Notes field
  const notesGroup = document.createElement('div');
  notesGroup.className = 'form-group';
  const notesLabelEl = document.createElement('label');
  notesLabelEl.setAttribute('for', 'act-notes');
  notesLabelEl.textContent = 'Notes (optional)';
  notesGroup.appendChild(notesLabelEl);
  const nTextarea = document.createElement('textarea');
  nTextarea.id = 'act-notes';
  nTextarea.name = 'notes';
  nTextarea.rows = 3;
  notesGroup.appendChild(nTextarea);
  form.appendChild(notesGroup);

  // Geocoder widget (optional)
  const geocoderGroup = document.createElement('div');
  geocoderGroup.className = 'form-group';
  const geocoderLabel = document.createElement('label');
  geocoderLabel.textContent = 'Coordinates (optional)';
  geocoderGroup.appendChild(geocoderLabel);

  const widget = document.createElement('div');
  widget.className = 'geocoder-widget';

  const gInput = document.createElement('input');
  gInput.type = 'text';
  gInput.id = 'act-geocoder-input';
  gInput.placeholder = 'Search location or paste Google Maps URL…';
  widget.appendChild(gInput);

  const gBtn = document.createElement('button');
  gBtn.type = 'button';
  gBtn.className = 'btn btn-primary';
  gBtn.id = 'act-geocoder-btn';
  gBtn.textContent = 'Search location';
  widget.appendChild(gBtn);

  const gResults = document.createElement('div');
  gResults.className = 'geocoder-results';
  gResults.id = 'act-geocoder-results';
  gResults.setAttribute('hidden', '');
  widget.appendChild(gResults);

  geocoderGroup.appendChild(widget);

  const latHidden = document.createElement('input');
  latHidden.type = 'hidden';
  latHidden.id = 'act-lat';
  latHidden.name = 'lat';
  geocoderGroup.appendChild(latHidden);

  const lngHidden = document.createElement('input');
  lngHidden.type = 'hidden';
  lngHidden.id = 'act-lng';
  lngHidden.name = 'lng';
  geocoderGroup.appendChild(lngHidden);

  form.appendChild(geocoderGroup);

  // Google Maps link (BIZ-03) — what "View on Maps" opens in the trip view.
  const mapsGroup = document.createElement('div');
  mapsGroup.className = 'form-group';
  const mapsLabel = document.createElement('label');
  mapsLabel.setAttribute('for', 'act-maps-url');
  mapsLabel.textContent = 'Google Maps link (optional)';
  mapsGroup.appendChild(mapsLabel);
  const mInput = document.createElement('input');
  mInput.type = 'url';
  mInput.id = 'act-maps-url';
  mInput.name = 'maps_url';
  mInput.placeholder = 'https://maps.app.goo.gl/…';
  mInput.setAttribute('aria-describedby', 'act-maps-url-hint');
  mapsGroup.appendChild(mInput);
  const mapsHint = document.createElement('p');
  mapsHint.className = 'form-hint';
  mapsHint.id = 'act-maps-url-hint';
  mapsHint.textContent = 'Without a link, the trip view opens the coordinates in Google Maps.';
  mapsGroup.appendChild(mapsHint);
  form.appendChild(mapsGroup);

  // Alternative option (BIZ-01) and area marker (BIZ-02)
  const optional = buildCheckbox(
    'act-optional',
    'is_optional',
    'Alternative option',
    'Shown as Option A, B… on the map — one of several choices for the day.',
  );
  form.appendChild(optional.group);
  const generic = buildCheckbox(
    'act-generic',
    'is_generic',
    'General area, not an exact spot',
    'For neighbourhoods or free time: no directions link is shown.',
  );
  form.appendChild(generic.group);

  const errorP = document.createElement('p');
  errorP.className = 'error-msg';
  errorP.id = 'act-form-error';
  errorP.setAttribute('hidden', '');
  form.appendChild(errorP);

  const actions = document.createElement('div');
  actions.className = 'form-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.id = 'act-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary';
  saveBtn.id = 'act-save-btn';
  saveBtn.textContent = 'Save';
  actions.appendChild(saveBtn);

  form.appendChild(actions);
  modal.appendChild(form);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modalOverlay = overlay;
  modalTitle = title;
  nameInput = nInput;
  timeInput = tInput;
  notesInput = nTextarea;
  geocoderInput = gInput;
  geocoderBtn = gBtn;
  geocoderResults = gResults;
  latInput = latHidden;
  lngInput = lngHidden;
  mapsUrlInput = mInput;
  optionalInput = optional.input;
  genericInput = generic.input;
  formError = errorP;

  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', onModalKeydown);
  gBtn.addEventListener('click', handleGeocoderSearch);
  form.addEventListener('submit', handleFormSubmit);
}

function openModal(act: ApiActivity | null): void {
  buildModal();

  editingActivityId = act ? act.id : null;
  setText(modalTitle, act ? 'Edit activity' : 'Add activity');

  nameInput.value = act?.name ?? '';
  timeInput.value = act?.time ?? '';
  notesInput.value = act?.notes ?? '';
  geocoderInput.value = '';
  // lat/lng are null at runtime for activities without coordinates; avoid
  // String(null) === "null" leaking into the form.
  latInput.value = String(act?.lat ?? '');
  lngInput.value = String(act?.lng ?? '');
  mapsUrlInput.value = act?.maps_url ?? '';
  optionalInput.checked = act?.is_optional ?? false;
  genericInput.checked = act?.is_generic ?? false;

  geocoderResults.setAttribute('hidden', '');
  geocoderResults.replaceChildren();
  formError.setAttribute('hidden', '');
  setText(formError, '');

  modalOverlay!.removeAttribute('hidden');
  nameInput.focus();
}

function closeModal(): void {
  if (modalOverlay) modalOverlay.setAttribute('hidden', '');
  editingActivityId = null;
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
      // The pasted link is also the natural "View on Maps" target.
      if (!mapsUrlInput.value.trim()) mapsUrlInput.value = query;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Found';
      btn.addEventListener('click', () => {
        geocoderResults.setAttribute('hidden', '');
        geocoderResults.replaceChildren();
      });
      geocoderResults.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'No results. Try a different search.';
      btn.disabled = true;
      geocoderResults.appendChild(btn);
    }
    return;
  }

  const originalText = geocoderBtn.textContent ?? 'Search location';
  geocoderBtn.textContent = 'Searching…';
  geocoderBtn.disabled = true;

  try {
    const results = await searchNominatim(query);
    geocoderResults.replaceChildren();

    if (results.length === 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'No results. Try a different search.';
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
    setText(formError, 'Error searching location. Please try again.');
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

  const mapsUrl = mapsUrlInput.value.trim();
  if (mapsUrl && !isHttpUrl(mapsUrl)) {
    setText(formError, 'The Google Maps link must start with http:// or https://.');
    formError.removeAttribute('hidden');
    mapsUrlInput.focus();
    return;
  }

  const saveBtn = document.getElementById('act-save-btn') as HTMLButtonElement | null;
  if (saveBtn) {
    saveBtn.disabled = true;
    setText(saveBtn, 'Saving…');
  }

  const rawLat = latInput.value;
  const rawLng = lngInput.value;
  const lat = rawLat ? parseFloat(rawLat) : undefined;
  const lng = rawLng ? parseFloat(rawLng) : undefined;

  const payload = {
    name: nameInput.value.trim(),
    time: timeInput.value || null,
    notes: notesInput.value.trim() || null,
    maps_url: mapsUrl || null,
    is_optional: optionalInput.checked,
    is_generic: genericInput.checked,
    ...(lat !== undefined && !isNaN(lat) ? { lat } : {}),
    ...(lng !== undefined && !isNaN(lng) ? { lng } : {}),
  };

  try {
    if (editingActivityId) {
      const updated = await updateActivity(
        currentTripId,
        currentDestId,
        currentDay.id,
        editingActivityId,
        payload,
      );
      const idx = currentDay.activities.findIndex((a) => a.id === editingActivityId);
      if (idx !== -1) currentDay.activities[idx] = updated;
    } else {
      const created = await createActivity(
        currentTripId,
        currentDestId,
        currentDay.id,
        payload,
      );
      currentDay.activities.push(created);
    }
    closeModal();
    renderActivitiesDisplay(currentContainer, currentDay, currentTripId, currentDestId);
  } catch (err) {
    setText(formError, saveErrorMessage(err));
    formError.removeAttribute('hidden');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      setText(saveBtn, 'Save');
    }
  }
}

function openConfirmDelete(act: ApiActivity): void {
  const confirmOverlay = document.getElementById('confirm-overlay');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMsg = document.getElementById('confirm-msg');
  const confirmError = document.getElementById('confirm-error');
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  const deleteBtn = document.getElementById('confirm-delete-btn');

  if (!confirmOverlay || !confirmTitle || !confirmMsg || !deleteBtn || !cancelBtn) return;

  setText(confirmTitle, 'Delete activity?');
  setText(confirmMsg, 'This action cannot be undone.');
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
      await deleteActivity(currentTripId, currentDestId, currentDay.id, act.id);
      currentDay.activities = currentDay.activities.filter((a) => a.id !== act.id);
      close();
      renderActivitiesDisplay(currentContainer, currentDay, currentTripId, currentDestId);
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

async function handleReorder(
  activities: ApiActivity[],
  movedIndex: number,
  direction: 'up' | 'down',
  tripId: string,
  destId: string,
  day: ApiDay,
  container: HTMLElement,
): Promise<void> {
  const swapped = [...activities];
  const swapIndex = direction === 'up' ? movedIndex - 1 : movedIndex + 1;
  [swapped[movedIndex], swapped[swapIndex]] = [
    swapped[swapIndex],
    swapped[movedIndex],
  ];

  // Optimistic update. order_index must be renumbered too: the render sorts
  // by order_index, so a bare array swap would be undone on re-render.
  // Copies (not mutations) keep `activities` intact for the revert path.
  const newActivities = swapped.map((a, idx) => ({ ...a, order_index: idx }));
  day.activities = newActivities;
  renderActivitiesDisplay(container, day, tripId, destId);

  try {
    const orderedIds = newActivities.map((a) => Number(a.id));
    const saved = await reorderActivities(tripId, destId, day.id, orderedIds);

    // Confirm with the server's order_index values — unless a newer reorder
    // has already replaced this state, in which case that one wins.
    if (day.activities !== newActivities) return;
    const savedIndex = new Map(saved.map((a) => [String(a.id), a.order_index]));
    day.activities = newActivities.map((a) => ({
      ...a,
      order_index: savedIndex.get(String(a.id)) ?? a.order_index,
    }));
    renderActivitiesDisplay(container, day, tripId, destId);
  } catch {
    // Revert to original order
    day.activities = activities;
    renderActivitiesDisplay(container, day, tripId, destId);
    const errEl = document.createElement('p');
    errEl.className = 'error-msg';
    setText(errEl, 'Could not save. Check your connection and try again.');
    container.appendChild(errEl);
  }
}

function buildTag(text: string): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'activity-tag';
  setText(tag, text);
  return tag;
}

function renderActivitiesDisplay(
  container: HTMLElement,
  day: ApiDay,
  tripId: string,
  destId: string,
): void {
  container.replaceChildren();

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-secondary';
  addBtn.textContent = 'Add activity';
  addBtn.style.marginBottom = '8px';
  addBtn.addEventListener('click', () => {
    currentTripId = tripId;
    currentDestId = destId;
    currentDay = day;
    currentContainer = container;
    openModal(null);
  });
  container.appendChild(addBtn);

  if (day.activities.length === 0) {
    const emptyP = document.createElement('p');
    emptyP.style.color = 'var(--jp-text-secondary, #515154)';
    emptyP.style.margin = '0';
    setText(emptyP, 'No activities. Add the first one.');
    container.appendChild(emptyP);
    return;
  }

  const sorted = [...day.activities].sort((a, b) => a.order_index - b.order_index);

  for (let i = 0; i < sorted.length; i++) {
    const act = sorted[i];
    const isFirst = i === 0;
    const isLast = i === sorted.length - 1;

    const row = document.createElement('div');
    row.className = 'activity-row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '6px 0';
    row.style.borderBottom = '1px solid var(--jp-border, rgba(0,0,0,0.1))';

    // Up button
    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn-icon';
    upBtn.title = 'Move up';
    upBtn.textContent = '▲';
    if (isFirst) {
      upBtn.disabled = true;
      upBtn.style.opacity = '0.35';
      upBtn.style.cursor = 'default';
    }
    upBtn.addEventListener('click', () => {
      if (isFirst) return;
      currentTripId = tripId;
      currentDestId = destId;
      currentDay = day;
      currentContainer = container;
      void handleReorder(sorted, i, 'up', tripId, destId, day, container);
    });
    row.appendChild(upBtn);

    // Down button
    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'btn-icon';
    downBtn.title = 'Move down';
    downBtn.textContent = '▼';
    if (isLast) {
      downBtn.disabled = true;
      downBtn.style.opacity = '0.35';
      downBtn.style.cursor = 'default';
    }
    downBtn.addEventListener('click', () => {
      if (isLast) return;
      currentTripId = tripId;
      currentDestId = destId;
      currentDay = day;
      currentContainer = container;
      void handleReorder(sorted, i, 'down', tripId, destId, day, container);
    });
    row.appendChild(downBtn);

    // Activity name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'activity-name';
    nameSpan.style.flex = '1';
    nameSpan.style.minWidth = '0';
    nameSpan.style.overflow = 'hidden';
    nameSpan.style.textOverflow = 'ellipsis';
    nameSpan.style.whiteSpace = 'nowrap';
    setText(nameSpan, act.name);
    row.appendChild(nameSpan);

    // Activity time (only shown if not null)
    if (act.time) {
      const timeSpan = document.createElement('span');
      timeSpan.className = 'activity-time';
      timeSpan.style.fontSize = '13px';
      timeSpan.style.color = 'var(--jp-text-secondary, #515154)';
      timeSpan.style.flexShrink = '0';
      setText(timeSpan, act.time);
      row.appendChild(timeSpan);
    }

    // Flags set in the modal, so they're visible without opening it
    if (act.is_optional) row.appendChild(buildTag('Option'));
    if (act.is_generic) row.appendChild(buildTag('Area'));

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      currentTripId = tripId;
      currentDestId = destId;
      currentDay = day;
      currentContainer = container;
      openModal(act);
    });
    row.appendChild(editBtn);

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      currentTripId = tripId;
      currentDestId = destId;
      currentDay = day;
      currentContainer = container;
      openConfirmDelete(act);
    });
    row.appendChild(delBtn);

    container.appendChild(row);
  }
}

export function renderActivitiesSection(
  container: HTMLElement,
  day: ApiDay,
  tripId: string,
  destId: string,
): void {
  currentTripId = tripId;
  currentDestId = destId;
  currentDay = day;
  currentContainer = container;
  renderActivitiesDisplay(container, day, tripId, destId);
}
