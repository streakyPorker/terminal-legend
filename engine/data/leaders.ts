import type { Country, Leader } from '../../types'
import type { Rng } from '../rng'

/**
 * Builds a seed `Leader` (memory starts empty). Internal to the seed layer —
 * re-exported only to `./countries.ts`, deliberately NOT part of the `./data`
 * barrel's public surface (it was a private helper in the old `data.ts`).
 */
export const leader = (
  name: string,
  title: string,
  age: number,
  persona: string,
  traits: string[],
  agenda: string,
  mood = 0,
): Leader => ({ name, title, age, persona, traits, agenda, mood, memory: [] })

const SUCCESSORS: Record<
  string,
  { name: string; age: number; persona: string; traits: string[]; agenda: string }[]
> = {
  QING: [
    {
      name: '爱新觉罗·奕詝',
      age: 25,
      persona: '敏感而多思的年轻皇帝，在改革与守旧之间摇摆，急于证明自己。',
      traits: ['谨慎', '改革'],
      agenda: '整饬吏治、应对西夷叩关',
    },
    {
      name: '爱新觉罗·载淳',
      age: 18,
      persona: '在宫廷斗争中长大的幼主，对权臣既依赖又戒备。',
      traits: ['保守', '猜忌'],
      agenda: '稳住宫廷与地方督抚',
    },
  ],
  GBR: [
    {
      name: '阿尔伯特·爱德华',
      age: 28,
      persona: '善于社交、热衷外交的继承人，相信帝国的秩序靠舰队与条约维系。',
      traits: ['外交', '海权'],
      agenda: '维系欧洲均势与全球航线',
    },
    {
      name: '乔治·弗雷德里克',
      age: 32,
      persona: '沉稳的海军派王储，对工业与劳工问题同样敏感。',
      traits: ['稳健', '海权'],
      agenda: '扩大海军优势，安抚工业城市',
    },
  ],
  FRA: [
    {
      name: '路易-拿破仑·波拿巴',
      age: 30,
      persona: '野心勃勃的波拿巴继承者，梦想恢复帝国的荣光。',
      traits: ['扩张', '民粹'],
      agenda: '打破维也纳体系，争取欧陆霸权',
    },
    {
      name: '弗朗索瓦·基佐',
      age: 45,
      persona: '冷静的资产阶级政治家，相信秩序、财产与渐进改革。',
      traits: ['务实', '保守'],
      agenda: '稳定财政与议会秩序',
    },
  ],
  PRU: [
    {
      name: '腓特烈·威廉四世',
      age: 35,
      persona: '浪漫而矛盾的国王，既想改革又畏惧革命。',
      traits: ['保守', '犹豫'],
      agenda: '在专制与立宪之间寻找平衡',
    },
    {
      name: '威廉一世',
      age: 40,
      persona: '铁一般的军人国王，坚信普鲁士的命运系于陆军。',
      traits: ['军事', '秩序'],
      agenda: '扩军、统一德意志',
    },
  ],
  RUS: [
    {
      name: '亚历山大二世',
      age: 25,
      persona: '受过良好教育的改革者，试图在专制框架内完成现代化。',
      traits: ['改革', '务实'],
      agenda: '废除农奴制、推进工业化',
    },
    {
      name: '亚历山大三世',
      age: 28,
      persona: '强硬的反动派，认为一切改革都会动摇帝国。',
      traits: ['专制', '保守'],
      agenda: '镇压异见、强化中央集权',
    },
  ],
  AUS: [
    {
      name: '弗朗茨·约瑟夫一世',
      age: 20,
      persona: '勤勉而固执的年轻皇帝，背负着多民族帝国的沉重包袱。',
      traits: ['保守', '维稳'],
      agenda: '维持帝国完整与维也纳体系',
    },
    {
      name: '卡尔大公',
      age: 35,
      persona: '有军事才能的皇族，主张以武力压制民族主义。',
      traits: ['军事', '保守'],
      agenda: '强化陆军、镇压分离主义',
    },
  ],
  USA: [
    {
      name: '马丁·范布伦',
      age: 45,
      persona: '精明的政党操盘手，优先考虑联邦稳定与商业利益。',
      traits: ['务实', '贸易'],
      agenda: '维持联邦、避免卷入欧洲战争',
    },
    {
      name: '约翰·泰勒',
      age: 40,
      persona: '坚定的州权派，对扩张与奴隶制问题态度强硬。',
      traits: ['扩张', '民粹'],
      agenda: '向西部与南方扩张',
    },
  ],
  JAP: [
    {
      name: '德川家定',
      age: 30,
      persona: '体弱而内向的将军，幕府内部派系开始公开角力。',
      traits: ['保守', '犹豫'],
      agenda: '维持锁国与幕府权威',
    },
    {
      name: '德川家茂',
      age: 22,
      persona: '年轻的将军，面对黑船与倒幕浪潮不得不做出选择。',
      traits: ['谨慎', '改革'],
      agenda: '在开国与攘夷之间周旋',
    },
  ],
  OTT: [
    {
      name: '阿卜杜勒-迈吉德一世',
      age: 22,
      persona: '受过西式教育的苏丹，决心把坦志麦特改革推进到底。',
      traits: ['改革', '求生'],
      agenda: '现代化军队与行政、抵御俄国',
    },
    {
      name: '阿卜杜勒-阿齐兹',
      age: 30,
      persona: '性格刚愎的苏丹，试图用海军与外交挽回帝国颓势。',
      traits: ['强硬', '防御'],
      agenda: '重建舰队、守住海峡',
    },
  ],
  SPA: [
    {
      name: '伊莎贝拉二世',
      age: 18,
      persona: '在宫廷阴谋中长大的女王，性格任性而缺乏安全感。',
      traits: ['内斗', '守成'],
      agenda: '保住王位与殖民地',
    },
    {
      name: '卡洛斯王子',
      age: 35,
      persona: '以正统王位继承者自居的强硬派，得到保守派与教会的支持。',
      traits: ['保守', '强硬'],
      agenda: '推翻自由派政府、恢复旧秩序',
    },
  ],
}

export function successorFor(country: Country, rng: Rng): Leader {
  const pool = SUCCESSORS[country.id] ?? []
  const picked = pool.length > 0 ? rng.pick(pool) : undefined
  return {
    name: picked?.name ?? `${country.adjective}新君`,
    title: country.leader.title,
    age: picked?.age ?? 30 + rng.int(25),
    persona: picked?.persona ?? '一位在动荡中继位的新领袖，尚未证明自己。',
    traits: picked?.traits ?? ['谨慎', '未知'],
    mood: rng.range(-10, 10),
    agenda: picked?.agenda ?? '巩固权力，应对继承危机',
    memory: [`继位于${country.leader.name}之后`],
  }
}
