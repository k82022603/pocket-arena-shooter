export function xorshift32(x: number): number {
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

export class Xorshift32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  nextUint(): number {
    this.state = xorshift32(this.state);
    return this.state;
  }

  nextFloat(): number {
    return this.nextUint() / 0x100000000;
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.floor(this.nextFloat() * (maxExclusive - minInclusive));
  }
}
