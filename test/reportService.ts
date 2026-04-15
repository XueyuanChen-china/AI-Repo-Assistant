import { add, formatMathResult, multiply } from './mathHelpers'

export function buildDailyReport(base: number, extra: number) {
  const total = add(base, extra)
  const doubled = multiply(total, 2)

  return {
    totalText: formatMathResult('total', total),
    doubledText: formatMathResult('doubled', doubled),
  }
}