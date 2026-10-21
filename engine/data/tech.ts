export const TECHS = [
  { level: 1, name: '传统农业', cost: 60 },
  { level: 2, name: '农业改良', cost: 140 },
  { level: 3, name: '蒸汽机', cost: 240 },
  { level: 4, name: '铁路时代', cost: 380 },
  { level: 5, name: '机械化生产', cost: 560 },
  { level: 6, name: '钢铁工业', cost: 780 },
  { level: 7, name: '电力应用', cost: 1040 },
  { level: 8, name: '化学工业', cost: 1340 },
  { level: 9, name: '内燃机', cost: 1680 },
  { level: 10, name: '无线电时代', cost: 2060 },
]

export function techCost(level: number): number {
  const row = TECHS.find(tech => tech.level === level)
  return row?.cost ?? 60 + (level - 1) * 120
}

export function techName(level: number): string {
  return TECHS.find(tech => tech.level === level)?.name ?? `未知科技 ${level}`
}
