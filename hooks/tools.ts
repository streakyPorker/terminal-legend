import type { EngineInterface } from 'claude-code'
import type { PolicyProposal } from '../types'
import { MODIFIER_STATS } from '../engine/modifiers'
import { BUILDING_IDS, GOOD_IDS, makeRngForWorld } from '../engine/data'
import { applyDecision, applyPolicy, clamp, clone } from '../engine/sim'
import { saveGame } from '../engine/save'
import { forecastWorld, inspectWorld, INSPECT_SECTIONS, type InspectOptions } from '../engine/inspect'
import { applyCheat, type CheatParams } from '../engine/cheat'
import { SITUATIONS, recordSituationProposal } from '../engine/situations'
import { countryTag } from '../view/format'
import {
  activeWorld,
  isDelegatedRun,
  patchUi,
  pendingOf,
  readProjectDoc,
  refreshStatus,
  setWorld,
} from './internal'
import { statusText } from './prompt'
import {
  advanceGame,
  auditOverreach,
  resolveEvent,
  startDelegated,
  startSecretary,
  stopDelegated,
} from './council'

// Full toolset per ADR 0001: misuse is caught by the prompt and audited
// afterwards, not prevented by withholding tools.
export const SECRETARY_TOOLS = [
  'mcp__terminal-legend__v3_status',
  'mcp__terminal-legend__v3_inspect',
  'mcp__terminal-legend__v3_forecast',
  'mcp__terminal-legend__v3_manual',
  'mcp__terminal-legend__v3_advance',
  'mcp__terminal-legend__v3_cheat',
  'mcp__terminal-legend__v3_action',
  'mcp__terminal-legend__v3_policy',
  'mcp__terminal-legend__v3_diplomacy',
  'mcp__terminal-legend__v3_situation',
  'mcp__terminal-legend__v3_event',
  'mcp__terminal-legend__v3_leader',
  'mcp__terminal-legend__v3_save',
] as const

// Every stance any registered situation accepts; the schema offers the union so
// the player can submit for a sample line as well as the opium crisis.
const SITUATION_STANCE_IDS = [
  ...new Set(SITUATIONS.flatMap(definition => definition.stances)),
]

// ---------------------------------------------------------------- tool specs

export const TOOL_SPECS: {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}[] = [
  {
    name: 'v3_status',
    description:
      '终末传奇：读取当前世界状态（玩家国家、财政、人口、军力、科技、待决事件、战争；各国对比用 v3_inspect rankings）。在回答任何需要具体数字的问题前先调用它。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'v3_inspect',
    description:
      '终末传奇：只读明细查询。section 取 economy（GDP 分解/物价/缺口）、market（商品市场供需与对外贸易/伙伴）、fiscal（收支/债务/税率）、labor（失业分解/工资）、trade（分商品进出口/伙伴）、routes（贸易路线：商品/起止/等级/运量/利差）、buildings（建筑类型配方/造价/工程量/建造点与逐建筑经营利润/存量）、construction（建造力/队列/租金）、military（军力/战争）、pops（人口阶级结构/识字/生活水平/激进忠诚）、diplomacy（关系/盟友/对手/禁运/贸易张力/局势）、tech（科技等级/点数/研究率分解）、modifiers（生效修正：来源/stat/栈/值/到期）、rankings（列强五维排名数据；默认只给五维，可按需用 metrics 追加列）、log（最近编年史，可用 kind/country/limit 过滤）、history（近 12 个月序列）。遇到“为什么变了”先用它，不要读存档或源码。',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: [...INSPECT_SECTIONS],
          description: '缺省 economy。',
        },
        kind: {
          type: 'string',
          description: '仅 log 分区：按日志类型过滤（economy/diplomacy/war/tech/politics/leader/event/system）。',
        },
        country: {
          type: 'string',
          description:
            'log 分区：按国家 id 过滤日志；其他分区：查询该国的数据（缺省本国），如 country=GBR 看英国的财政与税率。',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: '仅 log 分区：返回的最近条数，缺省 20。',
        },
        metrics: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'construction',
              'privateCapital',
              'infrastructure',
              'loyalty',
              'quality',
              'manpower',
              'techPoints',
            ],
          },
          description:
            '仅 rankings 分区：按需追加的列（construction 建造力 / privateCapital 私人资本 / infrastructure 基建 / loyalty 忠诚 / quality 军队质量 / manpower 人力 / techPoints 科技点）。',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'v3_forecast',
    description:
      '终末传奇：预估下月现金流（收入、支出、净额、结算后国库、建造力分配与租金）。它是计划值，遇贸易/事件会偏移。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'v3_manual',
    description:
      '终末传奇：返回 GM 机制手册（docs/gm-handbook.md）全文，供查阅规则口径，无需打开文件。只读，不读存档。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'v3_advance',
    description:
      '终末传奇：批准并推进一个月（打开下一次御前会议）。months>1 启动后台托管并立即返回，遇待决事件、新的战争/战争结束、秘书越权即中断。会先让各国 AI 领袖做决策，再确定性模拟经济、人口、科技、外交与战争。仅玩家可调用；秘书调用会被审计。',
    inputSchema: {
      type: 'object',
      properties: {
        months: {
          type: 'integer',
          minimum: 1,
          maximum: 24,
          description: '推进的月数，默认 1。',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'v3_cheat',
    description:
      '终末传奇（天命）：修改玩家国家的金钱、科技点、建筑、关系、战争分数、日期，或触发事件、更换领袖、施加/撤销修正、立即完成国有建造队列。铁人模式下拒绝。action 取值：treasury（amount；可选 country 指定任意国家）、techPoints（amount）、navy（amount 艘，可为负）、building（building/count）、finishProjects（完成全部国有在建项目）、relations（country/amount）、warScore（country/amount）、date（year/month）、event（kind 可选）、leader（name/title/persona）、modifier（stat/stack/value/months/label 施加修正；可选 id 稳定标识）、removeModifier（按 id/label/stat 撤销天命修正）、clearModifiers（清空该国全部天命修正，可按 stat 过滤）、legitimacy（amount，直接改存量，可为负）、prices（value 为百分比，整体抬高或压低该国物价水平，0 清除，省略 country 则全球）、constructionEfficiency（value 为倍率，默认 1；同一点数完成多少倍工程量，省略 country 则全球）、demand（good / amount / flat / value 设定某国或全世界的商品需求：需求 = (模型值 + popFactor×amount + flat) × (1+value/100)；amount 是人均系数 x、flat 是每月常数 a、value 是百分比；三者可任意组合，省略 country 时作用于全世界；均为水平值，再次调用覆盖，传 0 清除）。treasury/techPoints/building/finishProjects/event/leader/modifier/removeModifier/clearModifiers/demand 均支持可选 country，缺省为玩家国（demand 省略 country 时作用于全世界）；relations/warScore 的 country 是对手方。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'treasury',
            'techPoints',
            'navy',
            'building',
            'finishProjects',
            'relations',
            'warScore',
            'date',
            'event',
            'leader',
            'modifier',
            'removeModifier',
            'clearModifiers',
            'demand',
            'legitimacy',
            'prices',
            'constructionEfficiency',
          ],
        },
        amount: { type: 'number' },
        building: {
          type: 'string',
          enum: [...BUILDING_IDS],
        },
        count: { type: 'integer', minimum: -20, maximum: 20 },
        country: { type: 'string' },
        good: {
          type: 'string',
          enum: [...GOOD_IDS],
          description: 'demand 时必填：要调整需求的商品。',
        },
        year: { type: 'integer', minimum: 1800, maximum: 2200 },
        month: { type: 'integer', minimum: 1, maximum: 12 },
        kind: { type: 'string' },
        name: { type: 'string' },
        title: { type: 'string' },
        persona: { type: 'string' },
        flat: {
          type: 'number',
          description: 'demand 时可选：每月常数项 a（不随人口缩放）。',
        },
        stat: { type: 'string', description: 'modifier 时必填，例如 production / income / radicals。' },
        stack: { type: 'string', enum: ['flat', 'percent', 'multiply'] },
        value: { type: 'number' },
        months: { type: 'integer', minimum: 0, maximum: 240 },
        label: { type: 'string' },
        id: { type: 'string' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_action',
    description:
      '终末传奇：对指定国家（缺省为玩家国）执行一项内政行动。action 取值：build（新建，需 building/count；可选 slots（x*y 的槽数，默认 1，每槽最多 30 座，各成一个队列条目）；可选 tier（1-based，默认 1 = I 级）；可选 position=head/tail/before/after，默认 tail，before 为 before/after 的锚点项目 id）、upgrade（升级存量，需 building/fromTier/toTier/count；fromTier/toTier 为 1-based 等级，如钢铁厂 I→II 为 1→2；count 无座数上限，**请求超过可升级存量时按最大量执行**（PT-107），只有在无可升级座数时才拒绝；可选 position/before）、cancel（取消国有项目，需 projectId 或 index（1-based 队列序号））、reorder（调整建造队列顺位，需 projectId 或 index，配 position/before）、tax（调整某一税基的税率，需 base（land=土地/profit=企业所得税/consumption=消费税/tariff=关税）与 rate；base=consumption 时可加 good（如 grain）只设该消费品的税率，未设的商品沿用统一税率；缺省 base 返回税菜单）、tariff（关税：rate 为进口税率，可选 exportRate 单独设出口税率；省略则进出口同率）、spending（支出，需 category/amount）、research（选择科技节点，需 tech=节点 id，如 industry-1；需前置与时代门槛满足）、conscript（征兵，需 amount）、law（法案，需 name）、route（贸易路线：op 取 open/raise/lower/close，需 good 与 partner）、rent（建造力分配优先级，需 enabled：true=私人项目先租国有建造点，false=国有项目优先；仅玩家可用）。country 可选，用于多国变更场景（如 AI 国家建造/加税）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'build',
            'upgrade',
            'cancel',
            'reorder',
            'tax',
            'tariff',
            'spending',
            'research',
            'conscript',
            'law',
            'route',
            'rent',
          ],
        },
        country: {
          type: 'string',
          description: '可选国家代码（如 GBR）；缺省为玩家国。用于对任意国家执行同一内政行动。',
        },
        projectId: { type: 'string', description: 'cancel/reorder 时的项目 id（与 index 二选一）。' },
        index: {
          type: 'integer',
          minimum: 1,
          description: 'cancel/reorder 时可用，建造队列中的 1-based 序号（见 v3_inspect construction）。',
        },
        position: {
          type: 'string',
          enum: ['head', 'tail', 'before', 'after'],
          description: 'build/reorder 时的落位（默认 tail）。',
        },
        before: {
          type: 'string',
          description: 'position 为 before/after 时的锚点项目 id。',
        },
        enabled: {
          type: 'boolean',
          description: 'rent 时必填：true = 私人项目优先拿建造点，false = 国有项目优先。',
        },
        building: {
          type: 'string',
          enum: [...BUILDING_IDS],
          description: 'build/upgrade 时必填。',
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 999,
          description: 'build 时最多 30 座（每槽上限，PT-112）；upgrade 时无座数上限，但不得超过来源等级未被预约的存量座数。',
        },
        slots: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description:
            'build 可选：同一单下的独立槽位数（默认 1），即 x*y 的 y。每槽各成一个队列条目、逐槽完工，总数 = count × slots。',
        },
        tier: {
          type: 'integer',
          minimum: 1,
          maximum: 5,
          description: 'build 时可选，目标等级（1-based）；省略时默认落在已解锁的最高等级（PT-117），写 1 可强制按 I 级新建；未解锁的等级会被拒绝。',
        },
        fromTier: {
          type: 'integer',
          minimum: 1,
          maximum: 5,
          description: 'upgrade 时必填，来源等级（1-based，1 = I 级）。',
        },
        toTier: {
          type: 'integer',
          minimum: 2,
          maximum: 5,
          description: 'upgrade 时必填，目标等级（1-based，须高于 fromTier 且已解锁）。',
        },
        rate: { type: 'number', minimum: 0, maximum: 60, description: '进口关税税率（tariff 时）或税基税率（tax 时，0..60）。' },
        base: {
          type: 'string',
          enum: ['land', 'profit', 'consumption', 'tariff'],
          description: 'tax 时必填：税基（land=土地税 / profit=企业所得税 / consumption=消费税 / tariff=关税）。缺省则返回税菜单。',
        },
        exportRate: {
          type: 'number',
          minimum: 0,
          maximum: 60,
          description: '出口关税税率（可选；省略则与进口同率）。',
        },
        category: {
          type: 'string',
          enum: ['army', 'navy', 'bureaucracy', 'education', 'welfare', 'construction'],
        },
        amount: { type: 'number', minimum: 0, maximum: 50 },
        tech: { type: 'string', description: 'research 时的科技节点 id（如 general-1850、industry-1）。' },
        op: {
          type: 'string',
          enum: ['open', 'raise', 'lower', 'close'],
          description: 'route 时必填：开通 / 提升 / 降低 / 关闭航线。',
        },
        good: { type: 'string', enum: [...GOOD_IDS], description: 'route 时必填，可贸易商品。' },
        partner: { type: 'string', description: 'route 时必填，伙伴国家 id（如 GBR）。' },
        name: {
          type: 'string',
          enum: [
            '教育改革',
            '福利改革',
            '自由贸易',
            '保护关税',
            '征兵制',
            '宗教宽容',
          ],
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_policy',
    description:
      '终末传奇：提交一项政策提议（缺省作用于玩家国，可用 country 指定任意国家）。政策由若干效果条目组成，每条把某个数值入口加上 buff/debuff；引擎校验单位与数值后按叠算规则结算，并消耗权威（默认 5，最多 40）。效果条目字段：stat（修正对象）、stack（flat/percent/multiply，默认 flat）、value、months（可选，持续月数）、label（可选）。flat 值按 stat 的原生单位：识字/市场接入/劳动份额/私人投资/消费倾向是 0–1 分数（+2 个百分点写 0.02，写 2 会被拒绝）；sol/legitimacy/radicals 等是 0–100。',
    inputSchema: {
      type: 'object',
      properties: {
        country: {
          type: 'string',
          description: '可选国家代码（如 GBR）；缺省为玩家国。',
        },
        name: { type: 'string', description: '政策名称，例如「重商主义」。' },
        description: { type: 'string' },
        authorityCost: { type: 'integer', minimum: 0, maximum: 40 },
        effects: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              stat: { type: 'string', enum: MODIFIER_STATS },
              stack: { type: 'string', enum: ['flat', 'percent', 'multiply'] },
              value: { type: 'number' },
              months: { type: 'integer', minimum: 1, maximum: 240 },
              label: { type: 'string' },
            },
            required: ['stat', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['name', 'effects'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_diplomacy',
    description:
      '终末传奇：执行外交行动。move 取值：improve（改善关系）、insult（交恶）、alliance（结盟）、rival（设为对手）、gift（赠礼）、loan（放贷：现在付出 amount 本金，对方按 months 期等额本息每月还款，rate 为年息百分数）、war（宣战）、peace（停战；本方获胜时可用 indemnityTotal/indemnityMonths 声明赔款总额与最长分期月数）、embargo（禁运，可选定商品与月数）、unembargo（解除禁运）、tension（就敏感商品施加贸易张力）、blockade（封锁：需已掌握对 target 的制海权（优势或完全控制）；可用 party 指定第三方（含中立国），否则封锁其与一切第三方的贸易，可用 good 限定商品；解除用 unblockade，参数相同）。country 是行动发起国（缺省玩家国），target 是对方国家代码，例如 GBR、RUS、QING。',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: '可选行动发起国代码；缺省为玩家国。' },
        target: { type: 'string', description: '目标国家代码，如 GBR。' },
        move: {
          type: 'string',
          enum: [
            'improve',
            'insult',
            'alliance',
            'rival',
            'gift',
            'loan',
            'war',
            'peace',
            'embargo',
            'unembargo',
            'tension',
            'blockade',
            'unblockade',
          ],
        },
        amount: {
          type: 'number',
          minimum: -10,
          maximum: 100000,
          description:
            'improve/gift 的幅度；tension 时用作关系张力（-10..10）；loan 时为本金（金）。',
        },
        rate: {
          type: 'number',
          minimum: 0,
          maximum: 30,
          description: 'loan 的年利率百分数（缺省 5），0 表示无息。',
        },
        good: {
          type: 'string',
          enum: [...GOOD_IDS],
          description: 'embargo/unembargo/tension 的商品；tension 仅限 opium/arms/grain。',
        },
        party: {
          type: 'string',
          description:
            'blockade/unblockade 的第三方国家代码（含中立国）；省略则封锁 target 与一切第三方的贸易。',
        },
        months: {
          type: 'number',
          minimum: 1,
          maximum: 240,
          description: 'embargo 的持续月数（缺省永久）；loan 的还款期数（缺省 120）。',
        },
        relationDelta: {
          type: 'number',
          minimum: -10,
          maximum: 10,
          description: 'tension 的关系张力（-10..10）。',
        },
        reason: { type: 'string', description: '宣战/禁运/张力的理由，可选。' },
        goal: {
          type: 'string',
          enum: ['reparations', 'openMarket', 'sphere', 'humiliation'],
          description: 'war 的战争目标，决定停战时的和约条款；缺省 reparations。',
        },
        indemnityTotal: {
          type: 'number',
          minimum: 0,
          maximum: 100000,
          description:
            'peace 且本方获胜时的赔款总额（金）；缺省为败方 GDP 的 10%，上限为败方 GDP 的 2 倍。败方自行决定一次付清多少、余款分几期。',
        },
        indemnityMonths: {
          type: 'number',
          minimum: 1,
          maximum: 240,
          description: 'peace 时允许的最长分期月数；缺省 60（5 年）。',
        },
      },
      required: ['target', 'move'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_situation',
    description:
      '终末传奇：就当前开启的局势（如鸦片危机）提交立场。action=submit 需要 stance（crackdown 禁烟 / compromise 妥协 / war 开战 / aid 求援 / neutral 观望）与 narrative（一句叙事）；action=abstain 表示弃权观望。提案只作仲裁上下文，不直接落账。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['submit', 'abstain'] },
        stance: { type: 'string', enum: SITUATION_STANCE_IDS },
        narrative: { type: 'string', description: '一句提案叙事，submit 时必填。' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_event',
    description:
      '终末传奇：处理待决事件。省略 eventId 时列出所有待决事件及其选项；给出 eventId 与 optionId 时执行该选项并返回结果。',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string' },
        optionId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'v3_leader',
    description:
      '终末传奇：记录玩家与某国领袖的一次交流，并调整该领袖的情绪与两国关系；同时暂停该国 12 个回合的后台 AI 决策，交给叙事者扮演。country 为国家代码。',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string' },
        message: { type: 'string', description: '玩家对这位领袖说的话或达成的约定。' },
        mood: { type: 'number', minimum: -30, maximum: 30, description: '情绪变化量。' },
        relation: {
          type: 'number',
          minimum: -30,
          maximum: 30,
          description: '两国关系变化量。',
        },
      },
      required: ['country', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_save',
    description: '终末传奇：保存当前游戏。可选 name 指定存档名。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'v3_play',
    description: '终末传奇：切换玩家扮演的国家。country 为国家代码，例如 FRA。',
    inputSchema: {
      type: 'object',
      properties: { country: { type: 'string' } },
      required: ['country'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_control',
    description:
      '终末传奇：控制当前这一局的运行。action=stop 会在当前月推进结束后打断正在进行的后台托管；action=save 写入存档。只对玩家国家生效，基本只读；秘书调用会被审计。',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['stop', 'save'] } },
      required: ['action'],
      additionalProperties: false,
    },
  },
]

type Args = Record<string, unknown>

// A plugin tool's result may be a string, an array, or undefined — not an
// object. The model reads the string as the tool's output.
const toolOk = (text: string) => ({ result: text })

// `{ deny }` is the tool.call refusal: the model receives the text as an
// errored result.
const toolFail = (text: string) => ({ deny: text })

// ---------------------------------------------------------------- tool.call handlers

export const handleV3Status = async ($: EngineInterface) => {
  try {
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。请让玩家先运行 /v3 new。')
    return toolOk(statusText(current.world))
  } catch (error) {
    return toolFail(`读取状态失败：${String(error)}`)
  }
}

export const handleV3Inspect = async ($: EngineInterface, e: any) => {
  try {
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。')
    const args = e as unknown as Args
    const section =
      typeof args.section === 'string' ? args.section : 'economy'
    const options: InspectOptions = {}
    if (typeof args.kind === 'string') options.kind = args.kind
    if (typeof args.country === 'string') options.country = args.country.toUpperCase()
    if (typeof args.limit === 'number') options.limit = args.limit
    if (Array.isArray(args.metrics)) options.metrics = args.metrics.map(String)
    return toolOk(inspectWorld(current.world, section, options))
  } catch (error) {
    return toolFail(`明细查询失败：${String(error)}`)
  }
}

export const handleV3Manual = async ($: EngineInterface) => {
  try {
    const text = await readProjectDoc($, 'docs/gm-handbook.md')
    return toolOk(text ?? manualFallback())
  } catch (error) {
    return toolFail(`读取手册失败：${String(error)}`)
  }
}

export const handleV3Forecast = async ($: EngineInterface) => {
  try {
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。')
    return toolOk(forecastWorld(current.world))
  } catch (error) {
    return toolFail(`预估失败：${String(error)}`)
  }
}

export const handleV3Advance = async ($: EngineInterface, e: any) => {
  try {
    if (e.agentId !== undefined && (await auditOverreach($, '推进时间'))) {
      return toolFail('秘书连续越权，推进时间的请求已被拒绝。')
    }
    const args = e as unknown as Args
    const months = clamp(Math.floor(Number(args.months ?? 1)), 1, 24)
    if (isDelegatedRun()) return toolFail('托管进行中，请等它结束。')
    if (months <= 1) return toolOk(await advanceGame($, 1, true))
    return toolOk(await startDelegated($, months))
  } catch (error) {
    return toolFail(`推进失败：${String(error)}`)
  }
}

export const handleV3Cheat = async ($: EngineInterface, e: any) => {
  try {
    if (e.agentId !== undefined && (await auditOverreach($, '使用天命'))) {
      return toolFail('秘书连续越权，天命的请求已被拒绝。')
    }
    // Read after the audit: the audit writes the incremented counter.
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。')
    const args = e as unknown as Args
    const params: CheatParams = { action: String(args.action ?? '') }
    for (const key of [
      'building',
      'count',
      'country',
      'good',
      'flat',
      'amount',
      'year',
      'month',
      'kind',
      'name',
      'title',
      'persona',
      'stat',
      'stack',
      'value',
      'months',
      'label',
      'id',
    ]) {
      const value = args[key]
      if (typeof value === 'string' || typeof value === 'number') params[key] = value
    }
    const world = clone(current.world)
    const result = applyCheat(world, params)
    if (!result.ok) return toolFail(result.text)
    await setWorld($, world)
    await saveGame($, world).catch(() => undefined)
    await refreshStatus($)
    await patchUi($, { notice: result.text })
    return toolOk(result.text)
  } catch (error) {
    return toolFail(`天命失败：${String(error)}`)
  }
}

export const handleV3Action = async ($: EngineInterface, e: any) => {
  try {
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。')
    const args = e as unknown as Args
    const world = clone(current.world)
    // Multi-country content: the GM may act for any power, not just the player.
    const countryId = String(args.country ?? world.playerId).toUpperCase()
    if (world.countries[countryId] === undefined) return toolFail(`未知国家 ${countryId}`)
    const params: Record<string, string | number | boolean | undefined> = {}
    for (const key of [
      'building',
      'count',
      'slots',
      'tier',
      'fromTier',
      'toTier',
      'rate',
      'base',
      'exportRate',
      'category',
      'amount',
      'tech',
      'name',
      'projectId',
      'index',
      'position',
      'before',
      'op',
      'good',
      'partner',
      'enabled',
    ]) {
      const value = args[key]
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        params[key] = value
      }
    }
    const result = applyDecision(
      world,
      {
        countryId,
        action: String(args.action ?? ''),
        params,
      },
      makeRngForWorld(world),
    )
    if (!result.ok) return toolFail(result.text)
    await setWorld($, world)
    await saveGame($, world).catch(() => undefined)
    await refreshStatus($)
    await patchUi($, { notice: result.text })
    return toolOk(result.text)
  } catch (error) {
    return toolFail(`行动失败：${String(error)}`)
  }
}

export const handleV3Policy = async ($: EngineInterface, e: any) => {
  try {
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。')
    const args = e as unknown as Args
    const rawEffects = (args as { effects?: unknown }).effects
    const proposal: PolicyProposal = {
      name: String(args.name ?? ''),
      description: typeof args.description === 'string' ? args.description : undefined,
      authorityCost:
        typeof args.authorityCost === 'number' ? args.authorityCost : undefined,
      effects: Array.isArray(rawEffects)
        ? (rawEffects as PolicyProposal['effects'])
        : [],
    }
    const world = clone(current.world)
    const countryId = String(args.country ?? world.playerId).toUpperCase()
    if (world.countries[countryId] === undefined) return toolFail(`未知国家 ${countryId}`)
    const result = applyPolicy(world, countryId, proposal)
    if (!result.ok) return toolFail(result.text)
    await setWorld($, world)
    await saveGame($, world).catch(() => undefined)
    await refreshStatus($)
    await patchUi($, { notice: result.text })
    return toolOk(result.text)
  } catch (error) {
    return toolFail(`政策失败：${String(error)}`)
  }
}

export const handleV3Diplomacy = async ($: EngineInterface, e: any) => {
  try {
    const args = e as unknown as Args
    const move = String(args.move ?? '')
    if (e.agentId !== undefined && (move === 'war' || move === 'peace')) {
      const blocked = await auditOverreach($, move === 'war' ? '宣战' : '停战')
      if (blocked) return toolFail('秘书连续越权，宣战/停战的请求已被拒绝。')
    }
    // Read after the audit: the audit writes the incremented counter.
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。')
    const world = clone(current.world)
    const params: Record<string, string | number | boolean | undefined> = {
      target: String(args.target ?? '').toUpperCase(),
      move,
    }
    if (typeof args.amount === 'number') params.amount = args.amount
    if (typeof args.good === 'string') params.good = args.good
    if (typeof args.party === 'string') params.party = args.party
    if (typeof args.months === 'number') params.months = args.months
    if (typeof args.rate === 'number') params.rate = args.rate
    if (typeof args.relationDelta === 'number') params.relationDelta = args.relationDelta
    if (typeof args.reason === 'string') params.reason = args.reason
    if (typeof args.goal === 'string') params.goal = args.goal
    if (typeof args.indemnityTotal === 'number') {
      params.indemnityTotal = args.indemnityTotal
    }
    if (typeof args.indemnityMonths === 'number') {
      params.indemnityMonths = args.indemnityMonths
    }
    const actorId = String(args.country ?? world.playerId).toUpperCase()
    if (world.countries[actorId] === undefined) return toolFail(`未知国家 ${actorId}`)
    const result = applyDecision(
      world,
      { countryId: actorId, action: 'diplomacy', params },
      makeRngForWorld(world),
    )
    if (!result.ok) return toolFail(result.text)
    await setWorld($, world)
    await saveGame($, world).catch(() => undefined)
    await refreshStatus($)
    await patchUi($, { notice: result.text })
    return toolOk(result.text)
  } catch (error) {
    return toolFail(`外交行动失败：${String(error)}`)
  }
}

export const handleV3Situation = async ($: EngineInterface, e: any) => {
  try {
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。')
    const world = clone(current.world)
    // The secretary may propose only under diplomacy authorisation (plan §4.2);
    // war and peace stay the player's, which the diplomacy handler audits.
    if (e.agentId !== undefined && !world.secretary.delegation.diplomacy) {
      return toolFail('外交未授权，秘书不能提交局势提案。')
    }
    const args = e as unknown as Args
    const action = String(args.action ?? 'submit')
    const stance = action === 'abstain' ? 'neutral' : String(args.stance ?? '')
    const narrative = action === 'abstain' ? '弃权观望' : String(args.narrative ?? '')
    const result = recordSituationProposal(world, world.playerId, stance, narrative)
    if (!result.ok) return toolFail(result.text)
    await setWorld($, world)
    await saveGame($, world).catch(() => undefined)
    await refreshStatus($)
    await patchUi($, { notice: result.text })
    return toolOk(result.text)
  } catch (error) {
    return toolFail(`局势提案失败：${String(error)}`)
  }
}

export const handleV3Event = async ($: EngineInterface, e: any) => {
  try {
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。')
    const args = e as unknown as Args
    const eventId = typeof args.eventId === 'string' ? args.eventId : ''
    if (eventId === '') {
      const pending = pendingOf(current.world)
      if (pending.length === 0) return toolOk('没有待处理事件。')
      return toolOk(
        pending
          .map(
            event =>
              `[${event.id}] ${event.title}：${event.text}\n选项：${event.options.map(option => `${option.id}=${option.label}`).join(' / ')}`,
          )
          .join('\n\n'),
      )
    }
    const optionId = typeof args.optionId === 'string' ? args.optionId : ''
    if (optionId === '') return toolFail('需要 optionId 才能处理事件。')
    const text = await resolveEvent($, eventId, optionId)
    return toolOk(text)
  } catch (error) {
    return toolFail(`事件处理失败：${String(error)}`)
  }
}

export const handleV3Leader = async ($: EngineInterface, e: any) => {
  try {
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。')
    const args = e as unknown as Args
    const world = clone(current.world)
    const countryId = String(args.country ?? '').toUpperCase()
    const country = world.countries[countryId]
    if (country === undefined) return toolFail(`未知国家 ${countryId}`)
    const message = String(args.message ?? '').slice(0, 400)
    const player = world.countries[world.playerId]
    const speaker = player === undefined ? '玩家' : countryTag(player)
    country.leader.memory.push(`${speaker}：${message}`)
    if (country.leader.memory.length > 8) country.leader.memory.shift()
    if (typeof args.mood === 'number') {
      country.leader.mood = clamp(country.leader.mood + args.mood, -100, 100)
    }
    if (typeof args.relation === 'number' && player !== undefined) {
      const forward = country.diplo.relations[player.id] ?? 0
      country.diplo.relations[player.id] = clamp(forward + args.relation, -100, 100)
      const back = player.diplo.relations[country.id] ?? 0
      player.diplo.relations[country.id] = clamp(back + args.relation * 0.8, -100, 100)
    }
    world.ai.suspended[countryId] = world.tick + 12
    await setWorld($, world)
    await saveGame($, world).catch(() => undefined)
    await refreshStatus($)
    const sheet = [
      `${country.flag}${country.name} · ${country.leader.title}${country.leader.name}`,
      `人格：${country.leader.persona}`,
      `特质：${country.leader.traits.join('、')}`,
      `议程：${country.leader.agenda}`,
      `情绪：${Math.round(country.leader.mood)}`,
      `记忆：${country.leader.memory.slice(-4).join('；')}`,
    ]
    return toolOk(sheet.join('\n'))
  } catch (error) {
    return toolFail(`领袖交流失败：${String(error)}`)
  }
}

export const handleV3Save = async ($: EngineInterface, e: any) => {
  try {
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。')
    const args = e as unknown as Args
    const name = typeof args.name === 'string' ? args.name : undefined
    if (current.world.ironman && name !== undefined) {
      return toolFail('铁人模式只保留自动存档，不能命名存档。')
    }
    const path = await saveGame($, current.world, name)
    return toolOk(`已保存到 ${path}`)
  } catch (error) {
    return toolFail(`保存失败：${String(error)}`)
  }
}

export const handleV3Control = async ($: EngineInterface, e: any) => {
  try {
    if (e.agentId !== undefined && (await auditOverreach($, '控制托管'))) {
      return toolFail('秘书连续越权，控制托管的请求已被拒绝。')
    }
    const args = e as unknown as Args
    const action = String(args.action ?? '')
    if (action === 'stop') return toolOk(stopDelegated($))
    if (action === 'save') {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const path = await saveGame($, current.world)
      return toolOk(`已保存到 ${path}`)
    }
    return toolFail(`未知的 v3_control 动作 ${action}`)
  } catch (error) {
    return toolFail(`控制失败：${String(error)}`)
  }
}

export const handleV3Play = async ($: EngineInterface, e: any) => {
  try {
    if (isDelegatedRun()) return toolFail('托管进行中，请等它结束再切换国家。')
    const current = await activeWorld($)
    if (current === undefined) return toolFail('还没有进行中的游戏。')
    const args = e as unknown as Args
    const target = String(args.country ?? '').toUpperCase()
    const world = clone(current.world)
    const result = applyDecision(
      world,
      { countryId: world.playerId, action: 'play', params: { country: target } },
      makeRngForWorld(world),
    )
    if (!result.ok) return toolFail(result.text)
    await setWorld($, world)
    await saveGame($, world).catch(() => undefined)
    await refreshStatus($)
    return toolOk(result.text)
  } catch (error) {
    return toolFail(`切换国家失败：${String(error)}`)
  }
}

function manualFallback(): string {
  return [
    '（未找到 docs/gm-handbook.md；以下为工具与分区速查）',
    '工具：v3_status / v3_inspect / v3_forecast / v3_manual / v3_advance / v3_action / v3_policy / v3_diplomacy / v3_situation / v3_event / v3_leader / v3_play / v3_save / v3_cheat / v3_control',
    `v3_inspect 分区（section）：${INSPECT_SECTIONS.join(' / ')}`,
    '规则：查询状态只走 MCP 工具，绝不读取 .terminal-legend/save.json。',
  ].join('\n')
}
