/**
 * Simple map initializer for hotel-only pages
 * Expects a global 'hotel' object with: name, address, lat, lng
 */
function initSimpleMap(hotel) {
    const map = L.map('map', {
        scrollWheelZoom: true,
        worldCopyJump: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const hotelBadge = document.getElementById('hotel-badge');
    if (hotelBadge) {
        hotelBadge.textContent = hotel.name
            ? (hotel.name + ' - ' + hotel.address)
            : 'Alojamiento pendiente de confirmar';
    }

    if (hotel.lat && hotel.lng) {
        L.marker([hotel.lat, hotel.lng], {
            icon: L.divIcon({
                className: 'hotel-icon',
                html: '<div class="hotel-pin">&#9733;</div>',
                iconSize: [26, 26],
                iconAnchor: [13, 26],
                popupAnchor: [0, -20]
            })
        })
        .addTo(map)
        .bindPopup(
            '<strong>' + hotel.name + '</strong><br>' +
            hotel.address + '<br>' +
            '<a href="https://www.google.com/maps/search/?api=1&query=' +
            encodeURIComponent(hotel.address) +
            '" target="_blank" rel="noopener">Abrir en Google Maps</a>'
        );

        map.setView([hotel.lat, hotel.lng], 14);
    } else {
        map.fitWorld();
        map.setZoom(2);
    }
}
