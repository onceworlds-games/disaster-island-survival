// The look of the sky and light for each disaster, and the mix between calm and the disaster as the warning runs.
// Colours are sRGB hex; mixing happens in sRGB 0..1 and the stage converts when it applies them.

export const SKIES = {
  calm: { top: 0x3f86d4, horizon: 0xcfe7f7, sun: 0xfff0d2, sunI: 2.7, hemiSky: 0xbfe0ff, hemiGround: 0xd8c8a2, hemiI: 0.95, fog: 0xcde3f0, fogNear: 110, fogFar: 380, exposure: 1.0, cloud: 0xffffff, sea: 0x1f93c9 },
  flood: { top: 0x2f4a68, horizon: 0x93aebf, sun: 0xd9e6f2, sunI: 1.5, hemiSky: 0x9db6c9, hemiGround: 0x6d7f8c, hemiI: 0.85, fog: 0x8fa8b8, fogNear: 60, fogFar: 300, exposure: 0.92, cloud: 0x8c9aa6, sea: 0x2a7fa6 },
  meteor: { top: 0x2b0a12, horizon: 0xff7a3d, sun: 0xff9a5a, sunI: 2.0, hemiSky: 0xff8a66, hemiGround: 0x5a2c22, hemiI: 0.78, fog: 0xc9603a, fogNear: 70, fogFar: 320, exposure: 0.95, cloud: 0x7a3a2c, sea: 0x1c6a92 },
  tornado: { top: 0x3f4632, horizon: 0xb7b383, sun: 0xe4dfae, sunI: 1.35, hemiSky: 0xa9ad88, hemiGround: 0x6b6a4e, hemiI: 0.8, fog: 0xa9a97c, fogNear: 55, fogFar: 270, exposure: 0.92, cloud: 0x77785c, sea: 0x2b7894 },
  acid: { top: 0x1c4426, horizon: 0x9fd05f, sun: 0xd5f08a, sunI: 1.4, hemiSky: 0x93d36a, hemiGround: 0x4f6b35, hemiI: 0.85, fog: 0x8fc05a, fogNear: 55, fogFar: 270, exposure: 0.94, cloud: 0x6d8c45, sea: 0x3d8f5d },
  quake: { top: 0x5a3a28, horizon: 0xdca86a, sun: 0xffc98a, sunI: 1.9, hemiSky: 0xe0b280, hemiGround: 0x74543a, hemiI: 0.85, fog: 0xd0a46c, fogNear: 80, fogFar: 320, exposure: 0.97, cloud: 0xa88460, sea: 0x24809d },
  volcano: { top: 0x1a0e12, horizon: 0xe0662e, sun: 0xff8a45, sunI: 1.7, hemiSky: 0xd9794a, hemiGround: 0x3d2420, hemiI: 0.75, fog: 0xa04d2c, fogNear: 55, fogFar: 300, exposure: 0.93, cloud: 0x4b2a24, sea: 0x1a6382 },
  sunset: { top: 0x2a2f6b, horizon: 0xff9a4d, sun: 0xffb36b, sunI: 2.2, hemiSky: 0xffb68a, hemiGround: 0x6b4a52, hemiI: 0.8, fog: 0xf0a56b, fogNear: 100, fogFar: 380, exposure: 1.0, cloud: 0xffc7a0, sea: 0x2a6fa0 },
};

const ch = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const mixc = (a, b, t) => {
  const x = ch(a), y = ch(b);
  return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
};
const mixn = (a, b, t) => a + (b - a) * t;

/**
 * The sky for a round: `kinds` blended equally, `k` (0..1) the share of the disaster over calm.
 * Returns colours as [r, g, b] in sRGB 0..1 and plain numbers.
 */
export function skyMix(kinds, k, out = {}) {
  const calm = SKIES.calm;
  const list = kinds.length ? kinds.map((x) => SKIES[x] || calm) : [calm];
  const avgColor = (key) => {
    let r = 0, g = 0, b = 0;
    for (const s of list) {
      const c = ch(s[key]);
      r += c[0];
      g += c[1];
      b += c[2];
    }
    const n = list.length;
    return [r / n / 1, g / n / 1, b / n / 1];
  };
  const avgNum = (key) => list.reduce((a, s) => a + s[key], 0) / list.length;
  const colorKeys = ['top', 'horizon', 'sun', 'hemiSky', 'hemiGround', 'fog', 'cloud', 'sea'];
  for (const key of colorKeys) {
    const d = avgColor(key);
    const c = ch(calm[key]);
    out[key] = [mixn(c[0], d[0], k), mixn(c[1], d[1], k), mixn(c[2], d[2], k)];
  }
  for (const key of ['sunI', 'hemiI', 'fogNear', 'fogFar', 'exposure']) out[key] = mixn(calm[key], avgNum(key), k);
  return out;
}

export { mixc };
