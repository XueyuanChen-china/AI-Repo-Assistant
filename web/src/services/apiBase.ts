function normalizeBaseUrl(value: string | undefined) {
  if (!value) {
    return ''
  }

  return value.endsWith('/') ? value.slice(0, -1) : value
}

// 本地开发时 VITE_API_BASE_URL 可以留空，继续使用 Vite 的 /api 代理。
// 线上部署时把它配置成 Render 后端地址，例如：
// https://ai-repo-assistant.onrender.com
export const apiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL)

export function withApiBase(path: string) {
  if (!apiBaseUrl) {
    return path
  }

  return `${apiBaseUrl}${path}`
}
