// Terra Nova scale helpers.
// World coordinates use compact city-builder units; by design 1 unit = 5 real meters.
export const METERS_PER_UNIT = 5;
export const UNITS_PER_METER = 1 / METERS_PER_UNIT;

export function m(valueMeters = 0) {
  return (Number(valueMeters) || 0) * UNITS_PER_METER;
}

export function meters(valueUnits = 0) {
  return (Number(valueUnits) || 0) * METERS_PER_UNIT;
}

export function kmToWorldUnits(km = 20) {
  return (Number(km) || 20) * 1000 * UNITS_PER_METER;
}

export function worldUnitsToKm(units = 0) {
  return meters(units) / 1000;
}
