// Countdown Timer Module
export function initCountdown() {
  const countdownEl = document.getElementById('countdown');
  if (!countdownEl) return;

  const targetDate = new Date('2026-02-21T22:55:00Z');

  function updateCountdown() {
    const now = new Date();
    const diff = targetDate - now;

    if (diff <= 0) {
      countdownEl.innerHTML = '<div class="countdown-unit"><div class="countdown-value">0</div><div class="countdown-text">Llegaste!</div></div>';
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    countdownEl.innerHTML = `
      <div class="countdown-unit"><div class="countdown-value">${days}</div><div class="countdown-text">Días</div></div>
      <div class="countdown-unit"><div class="countdown-value">${hours.toString().padStart(2, '0')}</div><div class="countdown-text">Horas</div></div>
      <div class="countdown-unit"><div class="countdown-value">${minutes.toString().padStart(2, '0')}</div><div class="countdown-text">Min</div></div>
      <div class="countdown-unit"><div class="countdown-value">${seconds.toString().padStart(2, '0')}</div><div class="countdown-text">Seg</div></div>
    `;
  }

  updateCountdown();
  setInterval(updateCountdown, 1000);
}
