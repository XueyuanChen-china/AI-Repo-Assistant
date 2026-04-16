/**
 * 两个数字相加
 * @param a - 第一个数字
 * @param b - 第二个数字
 * @returns 两数之和
 */
export function add(a: number, b: number) {
  return a + b
}

/**
 * 两个数字相乘
 * @param a - 第一个数字
 * @param b - 第二个数字
 * @returns 两数之积
 */
export function multiply(a: number, b: number) {
  return a * b
}

/**
 * 格式化数学结果
 * @param label - 结果标签
 * @param value - 数值
 * @returns 格式化后的字符串
 */
export function formatMathResult(label: string, value: number) {
  return `${label}: ${value}`
}