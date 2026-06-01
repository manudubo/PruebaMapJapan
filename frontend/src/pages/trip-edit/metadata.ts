import { updateTrip } from '@/api/client';
import { showToast } from '@/modules/toast';
import { setText } from '@/modules/dom';
import type { ApiTrip } from '@/types';

export function initMetadataSection(trip: ApiTrip): void {
  const section = document.getElementById('metadata-section');
  const form = document.getElementById('metadata-form') as HTMLFormElement | null;
  const nameInput = document.getElementById('trip-name') as HTMLInputElement | null;
  const descInput = document.getElementById('trip-description') as HTMLTextAreaElement | null;
  const startInput = document.getElementById('trip-start-date') as HTMLInputElement | null;
  const endInput = document.getElementById('trip-end-date') as HTMLInputElement | null;
  const publicInput = document.getElementById('trip-public') as HTMLInputElement | null;
  const saveBtn = document.getElementById('metadata-save-btn') as HTMLButtonElement | null;
  const errorEl = document.getElementById('metadata-error');

  if (!section || !form) return;
  section.removeAttribute('hidden');

  if (nameInput) nameInput.value = trip.name;
  if (descInput) descInput.value = trip.description ?? '';
  if (startInput) startInput.value = trip.start_date ?? '';
  if (endInput) endInput.value = trip.end_date ?? '';
  if (publicInput) publicInput.checked = trip.is_public;

  const heading = document.getElementById('trip-name-heading');
  if (heading) setText(heading, trip.name);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!saveBtn) return;

    if (errorEl) errorEl.setAttribute('hidden', '');
    saveBtn.disabled = true;
    setText(saveBtn, 'Saving…');

    const formData = new FormData(form);
    try {
      await updateTrip(trip.id, {
        name: formData.get('name') as string,
        description: (formData.get('description') as string) || null,
        start_date: (formData.get('start_date') as string) || null,
        end_date: (formData.get('end_date') as string) || null,
        is_public: publicInput?.checked ?? false,
      });
      setText(saveBtn, 'Saved');
      showToast('Trip saved', 'success');
      setTimeout(() => { if (saveBtn) setText(saveBtn, 'Save changes'); }, 1500);
    } catch {
      if (errorEl) {
        errorEl.textContent = 'Could not save. Check your connection and try again.';
        errorEl.removeAttribute('hidden');
      }
    } finally {
      saveBtn.disabled = false;
      if (saveBtn.textContent === 'Saving…') setText(saveBtn, 'Save changes');
    }
  });
}
