// 시드 난수. Math.random은 호스트와 참가자·재실행 사이에 같은 값을 보장하지 않으므로 쓰지 않는다.

// xorshift32: 비트 이동과 XOR만으로 다음 값을 만든다. 빠르고, 같은 시드면 같은 수열이 나온다
export function xorshift32(x: number): number {
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0; // 부호 없는 32비트로
}

// 상태 안의 시드를 전진시키고 [0, 1) 난수를 돌려준다 (결정적).
export function nextRandom(state: { rngState: number }): number {
  state.rngState = xorshift32(state.rngState || 0x9e3779b9); // 0에서는 영원히 0이므로 황금비 상수로 대신한다
  return state.rngState / 0x100000000; // 2^32로 나눠 0 이상 1 미만으로
}

// 상태 객체 없이 쓰는 클래스형. 검사 스크립트 등에서 쓴다
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

  // [min, max) 범위의 정수
  nextInt(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.floor(this.nextFloat() * (maxExclusive - minInclusive));
  }
}
