import dashipiao from './gu-jingzhou-dashipiao.json'
import xiangming from './gu-jingzhou-xiangming-shipiao.json'
import shipiao from './shipiao-default.json'
import xishi from './xishi.json'
import gaopan from './gaopan.json'
import duoqiu from './duoqiu.json'
import chawan from './chawan.json'

/** The archive. Order = display order. */
export const SPECS = [dashipiao, xiangming, shipiao, xishi, duoqiu, gaopan, chawan]
export const SPEC_BY_ID = Object.fromEntries(SPECS.map((s) => [s.id, s]))
