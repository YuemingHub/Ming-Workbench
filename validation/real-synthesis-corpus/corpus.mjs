/**
 * Real synthesis validation corpus — non-technical, fuzzy human intents.
 *
 * Each case is an ordinary person's raw intent in plain language (Chinese,
 * matching the Workbench human-first prompts), followed by a boundary turn a
 * real person adds to narrow scope. Nothing here names a tech stack.
 *
 * `baselineSynthesis` is the grounded "what a correct synthesis must contain"
 * — authored strictly from the turns (never inventing resources). It is the
 * ground truth the human evaluation scores the real model against.
 *
 * `constraintChecklist.must` = the person's explicit asks; `mustNot` = explicit
 * boundaries. Used for intent fidelity / missing constraints / unnecessary
 * expansion scoring.
 *
 * `toolPath` is the real, self-contained artifact the bounded execution writes
 * when the Outcome is authorized (the grant double stands in for "a correct
 * harness agent that builds exactly the authorized artifact").
 */

import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const toolsDir = fileURLToPath(new URL('./tools/', import.meta.url))

const tool = (name) => readFileSync(join(toolsDir, name), 'utf8')

export const CORPUS = [
  {
    id: 'family-records',
    entry: '我只有一点模糊念头',
    title: '家里零碎事老忘，想记下来随时翻',
    turns: [
      '家里那些零碎的，孩子今天说了句啥、要买啥、提醒老人吃药，老忘。想弄个小东西记下来，翻出来就能看',
      '不用太复杂，就我和家里人能随手记一笔、随时翻看就行，别整成那种要注册要登录的',
      '现在就拿手机备忘录瞎记，记两天就乱',
    ],
    constraintChecklist: {
      must: ['记零碎家事（孩子说的、要买的、提醒老人吃药）', '随手记一笔、随时翻看', '不用注册登录'],
      mustNot: ['账号系统', '多设备同步', '复杂分类'],
    },
    baselineSynthesis: {
      desiredReality: '一个你和家人能随手记下零碎家事、随时翻看的小工具',
      strengths: ['你说清了痛点：家里零碎事老忘，手机备忘录记两天就乱', '你也说了边界：随手记、随时看，不要复杂和注册'],
      path: ['定最小结果：记一条加看列表，关掉再开还在', '做成一个打开就能用的单页', '先给你用起来'],
      recommendation: '一个能随手记一条家事、随时翻看列表、关掉再开记录还在的小工具',
    },
    toolPath: 'family-records.html',
    toolContent: () => tool('family-records.html'),
  },
  {
    id: 'reading-notes',
    entry: '我只有一点模糊念头',
    title: '看完书就忘，想把感想留下来',
    turns: [
      '一直想多看点书，但是看完就忘，过俩月跟没看过一样，想有点东西能留下',
      '不想搞得像上学交作业那样有压力，也不用什么打卡，就是看完能随手写两句感想，隔阵子能翻翻',
      '现在就是看完就算了，什么也没留下',
      '小说、随笔都看，就是想看完留个念想',
    ],
    constraintChecklist: {
      must: ['看完能留下点东西（感想）', '随手写、不费劲', '隔阵子能翻看'],
      mustNot: ['打卡', '作业/压力', '强制每日任务'],
    },
    baselineSynthesis: {
      desiredReality: '看完书能随手写两句感想、之后随时翻看的小工具',
      strengths: ['你说清了痛点：看完就忘，过俩月跟没看过一样，现在什么都不记', '你也说了边界：不要打卡、不要交作业的压力', '你也说了书类：小说、随笔都看，就是想留个念想'],
      path: ['定最小结果：记一本书加一句感想', '做成一个打开就能用的单页', '先给你用起来'],
      recommendation: '一个能记下读过的书和一句感想、之后随时翻看的小工具',
    },
    toolPath: 'reading-notes.html',
    toolContent: () => tool('reading-notes.html'),
  },
  {
    id: 'cat-care',
    entry: '我已经有一个想法',
    title: '养猫老忘喂食换水打疫苗，想要提醒',
    turns: [
      '家里养了只猫，我老忘喂食换水，上次差点忘了带它打疫苗。想有个东西能提醒我这些事',
      '不要太复杂，就是到点了能提醒我一声，最好手机上看就行，不用电脑',
      '现在全靠脑子记，也没设过闹钟',
      '一天喂两次，早上晚上各一次，到点手机上弹个通知就行',
    ],
    constraintChecklist: {
      must: ['提醒喂食、换水、疫苗这些日程', '到点提醒一声', '手机上能看'],
      mustNot: ['电脑端依赖', '复杂宠物档案/健康档案系统'],
    },
    baselineSynthesis: {
      desiredReality: '一个手机上能提醒你喂猫、换水、打疫苗的小工具',
      strengths: ['你说清了痛点：老忘喂食换水，差点漏掉疫苗，现在靠脑子记', '你也说了边界：到点提醒一声、手机上能看', '你也说了习惯：一天两次，早上晚上各一次'],
      path: ['定最小结果：记几条提醒（喂食/换水/疫苗）加到点提示', '做成一个手机打开就能用的单页', '先给你用起来'],
      recommendation: '一个能在手机上记下喂食、换水、疫苗提醒、到点提示的小工具',
    },
    toolPath: 'cat-care.html',
    toolContent: () => tool('cat-care.html'),
  },
  {
    id: 'photo-album',
    entry: '我已经有一个想法',
    title: '上万张照片里挑孩子的照片做相册',
    turns: [
      '手机里照片攒了得有上万张，想挑出孩子从小到大的照片做成一本相册，打印出来给老人看',
      '不想一张张手动挑，那得挑到猴年马月，能有办法按时间或者按人分一下最好',
      '手机相册自己会按人分，就是不全，还得自己补挑',
      '五六十张就够，老人翻着不累',
    ],
    constraintChecklist: {
      must: ['从大量照片中筛出孩子的照片', '做成一本相册（能打印）', '不用一张张手动挑'],
      mustNot: ['手工逐张挑选', '专业修图/剪辑功能'],
    },
    baselineSynthesis: {
      desiredReality: '一个能帮你从手机上万张照片里快速筛出孩子照片、排成一本可打印相册的小工具',
      strengths: ['你说清了目标：从上万张里挑出孩子照片做相册给老人', '你也说了边界：不一张张手动挑；手机相册按人分不全，得自己补挑', '你也说了规模：五六十张就够'],
      path: ['定最小结果：按时间/人脸把照片筛成候选', '把候选排成相册页面，可以打印', '先做出第一版给你看'],
      recommendation: '一个能按时间快速筛出孩子照片、排成可打印相册页的小工具',
    },
    toolPath: 'photo-album.html',
    toolContent: () => tool('photo-album.html'),
  },
  {
    id: 'community-order',
    entry: '我只有一点模糊念头',
    title: '小区团购跟单乱、容易错过',
    turns: [
      '小区里总有人发起团购，群里消息哗哗的，一不留神就错过了，想要个地方能把谁要买啥记清楚',
      '不用管收钱的事，钱还是各付各的，就是别让单子乱、别错过就行',
      '我是发起的人，想让大家在我开的单子上自己记一笔，谁要啥一眼就看到',
    ],
    constraintChecklist: {
      must: ['记清楚谁要买啥', '不刷屏、不遗漏', '钱各付各的'],
      mustNot: ['收款/账目/支付', '复杂订单流程'],
    },
    baselineSynthesis: {
      desiredReality: '一个能把小区团购单子记清楚、大家自己往上记、谁要买啥一目了然的小工具',
      strengths: ['你说清了痛点：群里消息乱，一不留神就错过', '你也说了边界：不碰收钱，各付各的', '你也说了用法：你发起单子，大家自己记一笔'],
      path: ['定最小结果：记一笔（谁、买啥、几份）', '做成一个打开就能看的单页', '先给你和邻居用起来'],
      recommendation: '一个能让邻居自己往上记、谁买啥一目了然不遗漏的团购单工具',
    },
    toolPath: 'community-order.html',
    toolContent: () => tool('community-order.html'),
  },
]

export function corpusCase(id) {
  return CORPUS.find((c) => c.id === id)
}
