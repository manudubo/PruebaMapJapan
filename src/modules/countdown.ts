const TIME_UNITS = { day: 86400000, hour: 3600000, minute: 60000, second: 1000 };
const MAX_YEARS_AHEAD = 3;

interface CountdownValues {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

interface DateValidation {
  valid: boolean;
  message?: string;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function maxAllowedDate(now: Date): Date {
  const max = startOfDay(now);
  max.setFullYear(max.getFullYear() + MAX_YEARS_AHEAD);
  return max;
}

function parseDateInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function validateTargetDate(target: Date, now: Date = new Date()): DateValidation {
  if (target < startOfDay(now)) {
    return { valid: false, message: 'Esa fecha ya pasó, elegí una fecha futura.' };
  }
  if (target > maxAllowedDate(now)) {
    return { valid: false, message: '¡Falta demasiado! Espera un poco más para planificar.' };
  }
  return { valid: true };
}

export function calculateCountdown(target: Date, now: Date = new Date()): CountdownValues {
  const total = target.getTime() - now.getTime();
  if (total <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };
  return {
    days: Math.floor(total / TIME_UNITS.day),
    hours: Math.floor((total % TIME_UNITS.day) / TIME_UNITS.hour),
    minutes: Math.floor((total % TIME_UNITS.hour) / TIME_UNITS.minute),
    seconds: Math.floor((total % TIME_UNITS.minute) / TIME_UNITS.second),
    total
  };
}

export function initCountdown(): void {
  const container = document.getElementById('countdown');
  const input = document.getElementById('countdown-date-input') as HTMLInputElement | null;
  const errorEl = document.getElementById('countdown-error');
  if (!container || !input) return;

  const elements = {
    days: document.getElementById('countdown-days'),
    hours: document.getElementById('countdown-hours'),
    minutes: document.getElementById('countdown-minutes'),
    seconds: document.getElementById('countdown-seconds')
  };

  const now = new Date();
  input.min = formatDateForInput(startOfDay(now));
  input.max = formatDateForInput(maxAllowedDate(now));

  let intervalId: ReturnType<typeof setInterval> | undefined;

  function resetDisplay(): void {
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
    Object.values(elements).forEach(el => { if (el) el.textContent = '--'; });
  }

  function setError(message: string | null): void {
    if (!errorEl) return;
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  }

  function renderCountdown(target: Date): void {
    const { days, hours, minutes, seconds, total } = calculateCountdown(target);
    if (total <= 0) {
      Object.values(elements).forEach(el => { if (el) el.textContent = '🎉'; });
      return;
    }
    if (elements.days) elements.days.textContent = String(days);
    if (elements.hours) elements.hours.textContent = String(hours).padStart(2, '0');
    if (elements.minutes) elements.minutes.textContent = String(minutes).padStart(2, '0');
    if (elements.seconds) elements.seconds.textContent = String(seconds).padStart(2, '0');
  }

  function handleDateChange(): void {
    resetDisplay();
    const target = parseDateInputValue(input!.value);
    if (!target) {
      setError(null);
      return;
    }
    const validation = validateTargetDate(target);
    if (!validation.valid) {
      setError(validation.message ?? null);
      return;
    }
    setError(null);
    renderCountdown(target);
    intervalId = setInterval(() => renderCountdown(target), 1000);
  }

  input.addEventListener('input', handleDateChange);
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'true');
}
