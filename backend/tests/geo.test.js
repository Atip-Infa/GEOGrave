const { haversineDistanceKm, findWithinRadius } = require('../lib/geo');

describe('haversineDistanceKm', () => {
  test('distance from a point to itself is 0', () => {
    expect(haversineDistanceKm(13.75, 100.5, 13.75, 100.5)).toBeCloseTo(0, 5);
  });

  test('Bangkok to Chiang Mai is roughly 580-600km great-circle', () => {
    const d = haversineDistanceKm(13.7563, 100.5018, 18.7883, 98.9853);
    expect(d).toBeGreaterThan(560);
    expect(d).toBeLessThan(600);
  });

  test('is symmetric', () => {
    const a = haversineDistanceKm(13.75, 100.5, 18.79, 98.99);
    const b = haversineDistanceKm(18.79, 98.99, 13.75, 100.5);
    expect(a).toBeCloseTo(b, 8);
  });
});

describe('findWithinRadius', () => {
  const points = [
    { id: 'center', lat: 13.7563, lng: 100.5018 },
    { id: 'nearby', lat: 13.76, lng: 100.505 },   // ~0.5km away
    { id: 'far', lat: 14.2, lng: 101.0 },         // ~60km away
  ];

  test('excludes points outside the radius', () => {
    const result = findWithinRadius(points, 13.7563, 100.5018, 5);
    expect(result.map(p => p.id).sort()).toEqual(['center', 'nearby']);
  });

  test('sorts results nearest-first', () => {
    const result = findWithinRadius(points, 13.7563, 100.5018, 1000);
    expect(result.map(p => p.id)).toEqual(['center', 'nearby', 'far']);
  });

  test('annotates each result with distanceKm', () => {
    const result = findWithinRadius(points, 13.7563, 100.5018, 5);
    const center = result.find(p => p.id === 'center');
    expect(center.distanceKm).toBeCloseTo(0, 3);
  });

  test('does not mutate the input array', () => {
    const copy = JSON.parse(JSON.stringify(points));
    findWithinRadius(points, 13.7563, 100.5018, 5);
    expect(points).toEqual(copy);
  });
});
