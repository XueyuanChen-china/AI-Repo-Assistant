import { add, formatMathResult, multiply } from './mathHelpers'

/**
 * 生成每日报告
 * @param base 基础值
 * @param extra 额外值
 * @returns 包含总计和翻倍结果的报告对象
 */
export function buildDailyReport(base: number, extra: number) {
  const total = add(base, extra)
  const doubled = multiply(total, 2)

  return {
    totalText: formatMathResult('total', total),
    doubledText: formatMathResult('doubled', doubled),
  }
}