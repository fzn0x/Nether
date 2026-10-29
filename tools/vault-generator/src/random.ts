// A small seeded random number generator, so a seed always makes the same
// vault. sfc32, seeded through splitmix32.

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Random {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    const next = splitmix32(seed);
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
  }

  /** A number from 0 up to, not including, 1. */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4_294_967_296;
  }

  /** A whole number from `min` to `max`, both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("pick needs at least one item");
    return item;
  }
}

/**
 * Picks indexes from 0 to n - 1 with Zipf's law, as links in real vaults
 * fall: a few notes are linked from everywhere, most from a handful. The
 * weights use only division and addition, which IEEE 754 rounds the same
 * way everywhere, so every platform draws the same indexes.
 */
export class PowerLaw {
  private readonly cumulative: Float64Array;

  constructor(n: number) {
    this.cumulative = new Float64Array(n);
    let total = 0;
    for (let rank = 0; rank < n; rank++) {
      total += 1 / (rank + 1);
      this.cumulative[rank] = total;
    }
    for (let rank = 0; rank < n; rank++) {
      this.cumulative[rank] = (this.cumulative[rank] ?? 0) / total;
    }
  }

  sample(random: Random): number {
    const target = random.next();
    let low = 0;
    let high = this.cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((this.cumulative[middle] ?? 1) < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
