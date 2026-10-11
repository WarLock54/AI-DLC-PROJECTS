// NFR7 load profile: 500 virtual users, 2-minute ramp-up, 8-minute steady state
// (10 minutes total), and an approximate 70/20/10 flow mix.

export const LOAD_PROFILE = {
  virtualUsers: 500,
  rampSeconds: 120,
  steadySeconds: 480,
  totalSeconds: 600,
} as const;

export type Flow = "read" | "rsvp" | "other";

/** Cumulative flow mix: 70% event list/detail GET, 20% RSVP POST, 10% other public GETs. */
export const FLOW_MIX: Readonly<Record<Flow, number>> = { read: 0.7, rsvp: 0.2, other: 0.1 };

/** Target number of active virtual users `elapsedSeconds` after the start of the run. */
export function targetVus(elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new Error("elapsedSeconds must be a non-negative finite number.");
  }
  if (elapsedSeconds >= LOAD_PROFILE.totalSeconds) {
    return 0;
  }
  if (elapsedSeconds >= LOAD_PROFILE.rampSeconds) {
    return LOAD_PROFILE.virtualUsers;
  }
  return Math.ceil((LOAD_PROFILE.virtualUsers * elapsedSeconds) / LOAD_PROFILE.rampSeconds);
}

/** Maps a uniform roll in [0, 1) to a flow according to FLOW_MIX. */
export function selectFlow(roll: number): Flow {
  if (!(roll >= 0 && roll < 1)) {
    throw new Error("The flow roll must be in [0, 1).");
  }
  if (roll < FLOW_MIX.read) {
    return "read";
  }
  return roll < FLOW_MIX.read + FLOW_MIX.rsvp ? "rsvp" : "other";
}

/** Small deterministic generator (mulberry32) so flow selection is reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
