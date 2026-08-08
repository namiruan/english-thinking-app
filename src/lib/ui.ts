// 카테고리/라벨 이름 → 안정적인 색상(hue). 뱃지 색 구분용.
export function catHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
