export const mockTrip = {
  id: 1,
  name: 'Test Trip',
  start_date: '2026-01-01',
  end_date: '2026-01-10',
  is_public: true,
  destinations: [
    {
      id: 1,
      city_name: 'Tokyo',
      country: 'Japan',
      lat: 35.6762,
      lng: 139.6503,
      zoom_level: 13,
      start_date: '2026-01-01',
      end_date: '2026-01-05',
      order_index: 0,
      hotel: {
        id: 1,
        name: 'Test Hotel',
        lat: 35.6762,
        lng: 139.6503,
        check_in_date: '2026-01-01',
        check_out_date: '2026-01-05',
      },
      days: [
        {
          id: 1,
          date: '2026-01-01',
          label: 'Day 1',
          color_hex: '#FF6B6B',
          order_index: 0,
          activities: [
            {
              id: 1,
              name: 'Senso-ji Temple',
              lat: 35.7148,
              lng: 139.7967,
              notes: 'Famous temple',
              is_optional: false,
              is_generic: false,
              maps_url: '',
              order_index: 0,
            },
          ],
        },
      ],
    },
  ],
};

export const mockTripsApiResponse = {
  success: true,
  data: [mockTrip],
};

export const mockSingleTripApiResponse = {
  success: true,
  data: mockTrip,
};

export const mockUserApiResponse = {
  success: true,
  data: {
    id: 1,
    keycloak_id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    avatar_url: null,
  },
};
