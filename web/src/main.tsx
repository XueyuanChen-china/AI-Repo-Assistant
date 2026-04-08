import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './styles/app.css'

// main.tsx 是 React 应用真正“挂到页面上”的地方。
// 可以把它理解成“把 App 组件插到 index.html 的 #root 里”。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
