const TRIP_DATE = new Date('2026-02-22T07:50:00+09:00');
const TIME_UNITS = { day: 86400000, hour: 3600000, minute: 60000, second: 1000 };

interface CountdownValues {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

function calculateCountdown(): CountdownValues {
  const total = TRIP_DATE.getTime() - Date.now();
  if (total <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };
  return {
    days: Math.floor(total / TIME_UNITS.day),
    hours: Math.floor((total % TIME_UNITS.day) / TIME_UNITS.hour),
    minutes: Math.floor((total % TIME_UNITS.hour) / TIME_UNITS.minute),
    seconds: Math.floor((total % TIME_UNITS.minute) / TIME_UNITS.second),
    total
  };
}

function updateDisplay(elements: Record<string, HTMLElement | null>): void {
  const { days, hours, minutes, seconds, total } = calculateCountdown();
  if (total <= 0) {
    Object.values(elements).forEach(el => { if (el) el.textContent = '🎉'; });
    return;
  }
  if (elements.days) elements.days.textContent = String(days);
  if (elements.hours) elements.hours.textContent = String(hours).padStart(2, '0');
  if (elements.minutes) elements.minutes.textContent = String(minutes).padStart(2, '0');
  if (elements.seconds) elements.seconds.textContent = String(seconds).padStart(2, '0');
}

export function initCountdown(): void {
  const container = document.getElementById('countdown');
  if (!container) return;
  const elements = {
    days: document.getElementById('countdown-days'),
    hours: document.getElementById('countdown-hours'),
    minutes: document.getElementById('countdown-minutes'),
    seconds: document.getElementById('countdown-seconds')
  };
  updateDisplay(elements);
  setInterval(() => updateDisplay(elements), 1000);
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'true');
}

export function getDaysRemaining(): number {
  return calculateCountdown().days;
}

export function hasTripStarted(): boolean {
  return Date.now() >= TRIP_DATE.getTime();
}
