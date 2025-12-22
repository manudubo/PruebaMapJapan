// Navigation active state handler
document.addEventListener('DOMContentLoaded', function() {
    const activePath = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    document.querySelectorAll('.top-nav a').forEach((link) => {
        const target = link.getAttribute('href').toLowerCase();
        if (target === activePath) {
            link.classList.add('is-active');
        }
    });
});
