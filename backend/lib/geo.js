const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points, in kilometers. */
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Returns points within `radiusKm` of (lat, lng), each annotated with
 * `distanceKm`, sorted nearest-first.
 */
function findWithinRadius(points, lat, lng, radiusKm) {
  return points
    .map(p => ({ ...p, distanceKm: haversineDistanceKm(lat, lng, p.lat, p.lng) }))
    .filter(p => p.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

module.exports = { haversineDistanceKm, findWithinRadius };
