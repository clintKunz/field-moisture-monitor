/**
 * Seeded random number generator (mulberry32).
 *
 * Math.random can't be seeded, so every run would differ. A seeded generator
 * makes the simulation reproducible: the same seed always produces the same
 * farm, which keeps tests stable and makes the replay identical every time.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximately normal noise with mean 0 and standard deviation 1. */
export function gaussian(rng: () => number): number {
  return rng() + rng() + rng() + rng() + rng() + rng() - 3;
}
