import { m } from '../utils/Scale.js';

export const ROAD_RENDER = {
  baseYOffset: -0.035,
  surfaceYOffset: 0.065,
  wearYOffset: 0.085,
  markingYOffset: 0.152,
  curbYOffset: 0.34,
  sidewalkYOffset: 0.075,
  arrowYOffset: 0.214,
  intersectionBaseYOffset: 0.045,
  intersectionSurfaceYOffset: 0.118,
  crosswalkYOffset: 0.176,
  centerLineOffset: m(0.52),
  centerLineWidth: Math.max(0.055, m(0.24)),
  laneDashWidth: Math.max(0.050, m(0.20)),
  laneDash: m(6.4),
  laneGap: m(12.6),
  shoulderWidth: m(4.2),
  curbWidth: m(0.72),
  sidewalkGap: m(0.72),
  edgeInset: m(1.12),
  parkingTickSpacing: m(18)
};

export const ROAD_MATERIAL_COLORS = {
  asphalt: 0x2d3234,
  roadBase: 0x15191b,
  roadEdge: 0x202729,
  curb: 0x9d9588,
  sidewalk: 0x9f978b,
  laneWhite: 0xcecabd,
  laneYellow: 0xc99b2e,
  crosswalk: 0xd8d4c7,
  busLane: 0xa9322c,
  bikeLane: 0x428a58,
  parkingLane: 0x555c5f,
  railBallast: 0x514d46,
  railSleeper: 0x30251c,
  railMetal: 0xb8bec0,
  railRust: 0x765039
};
