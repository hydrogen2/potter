import jingzhou from './jingzhou-shipiao.json'
import ziye from './ziye-shipiao.json'
import xishi from './xishi.json'
import gaopan from './gaopan.json'
import duoqiu from './duoqiu.json'
import liufang from './liufang.json'
import chawan from './chawan.json'

/** The archive. Order = display order. */
export const SPECS = [jingzhou, ziye, xishi, duoqiu, liufang, gaopan, chawan]
export const SPEC_BY_ID = Object.fromEntries(SPECS.map((s) => [s.id, s]))
