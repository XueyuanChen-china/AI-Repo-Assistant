import type { ChatRequest, ChatResponse, DiffPreview, RepoFile, RepoNode } from '@ai-repo-assistant/shared'

export const mockRepoRoot = 'demo-repo'

export const mockRepoNodes: RepoNode[] = [
  {
    id: 'src',
    name: 'src',
    path: 'src',
    type: 'directory',
    children: [
      {
        id: 'src/pages',
        name: 'pages',
        path: 'src/pages',
        type: 'directory',
        children: [
          {
            id: 'src/pages/LoginPage.tsx',
            name: 'LoginPage.tsx',
            path: 'src/pages/LoginPage.tsx',
            type: 'file',
            language: 'tsx',
          },
          {
            id: 'src/pages/Dashboard.tsx',
            name: 'Dashboard.tsx',
            path: 'src/pages/Dashboard.tsx',
            type: 'file',
            language: 'tsx',
          },
        ],
      },
      {
        id: 'src/components',
        name: 'components',
        path: 'src/components',
        type: 'directory',
        children: [
          {
            id: 'src/components/BookingTable.tsx',
            name: 'BookingTable.tsx',
            path: 'src/components/BookingTable.tsx',
            type: 'file',
            language: 'tsx',
          },
        ],
      },
      {
        id: 'src/lib',
        name: 'lib',
        path: 'src/lib',
        type: 'directory',
        children: [
          {
            id: 'src/lib/apiClient.ts',
            name: 'apiClient.ts',
            path: 'src/lib/apiClient.ts',
            type: 'file',
            language: 'ts',
          },
        ],
      },
    ],
  },
  {
    id: 'package.json',
    name: 'package.json',
    path: 'package.json',
    type: 'file',
    language: 'json',
  },
]

const loginBefore = `import { useState } from 'react'
import { login } from '../lib/apiClient'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)

    await login({ email, password })
    setIsSubmitting(false)
  }

  return (
    <form className="login-card" onSubmit={handleSubmit}>
      <input value={email} onChange={(event) => setEmail(event.target.value)} />
      <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <button disabled={isSubmitting}>{isSubmitting ? 'Signing in...' : 'Sign in'}</button>
    </form>
  )
}
`

const loginAfter = `import { useState } from 'react'
import { login } from '../lib/apiClient'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setErrorMessage('')

    try {
      await login({ email, password })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Login failed, please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="login-card" onSubmit={handleSubmit}>
      <input value={email} onChange={(event) => setEmail(event.target.value)} />
      <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      <button disabled={isSubmitting}>{isSubmitting ? 'Signing in...' : 'Sign in'}</button>
    </form>
  )
}
`

export const mockRepoFiles: Record<string, RepoFile> = {
  'src/pages/LoginPage.tsx': {
    path: 'src/pages/LoginPage.tsx',
    language: 'tsx',
    content: loginBefore,
  },
  'src/pages/Dashboard.tsx': {
    path: 'src/pages/Dashboard.tsx',
    language: 'tsx',
    content: `export function Dashboard() {
  return (
    <section>
      <h1>Today's arrivals</h1>
      <p>Use the booking table to confirm late check-ins.</p>
    </section>
  )
}
`,
  },
  'src/components/BookingTable.tsx': {
    path: 'src/components/BookingTable.tsx',
    language: 'tsx',
    content: `type Booking = {
  id: string
  guestName: string
  status: 'arriving' | 'checked-in' | 'cancelled'
}

export function BookingTable({ bookings }: { bookings: Booking[] }) {
  return (
    <table>
      <tbody>
        {bookings.map((booking) => (
          <tr key={booking.id}>
            <td>{booking.guestName}</td>
            <td>{booking.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
`,
  },
  'src/lib/apiClient.ts': {
    path: 'src/lib/apiClient.ts',
    language: 'ts',
    content: `type LoginPayload = {
  email: string
  password: string
}

export async function login(payload: LoginPayload) {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error('Invalid email or password.')
  }

  return response.json()
}
`,
  },
  'package.json': {
    path: 'package.json',
    language: 'json',
    content: `{
  "name": "hotel-web",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
`,
  },
}

export function getMockFile(filePath: string) {
  return mockRepoFiles[filePath] ?? null
}

export function findFirstFilePath(nodes: RepoNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'file') {
      return node.path
    }

    if (node.children?.length) {
      const nestedMatch = findFirstFilePath(node.children)
      if (nestedMatch) {
        return nestedMatch
      }
    }
  }

  return null
}

export function buildMockDiffPreview(): DiffPreview {
  return {
    path: 'src/pages/LoginPage.tsx',
    title: 'Add visible login error handling',
    summary: 'Introduce an error state so failed login requests surface a message in the form.',
    before: loginBefore,
    after: loginAfter,
  }
}

export function buildMockChatResponse(input: ChatRequest): ChatResponse {
  const now = new Date().toISOString()
  const selectedContext =
    input.selectedPaths.length > 0
      ? `I grounded the answer in: ${input.selectedPaths.join(', ')}`
      : 'No files were selected, so this reply stays high-level.'

  const shouldSuggestDiff = /login|error|diff|修改|提示|报错/i.test(input.message)

  const responseText = shouldSuggestDiff
    ? `${selectedContext}\n\nThe mocked backend suggests updating the login form with an explicit error state and a visible message block. This keeps the Day 1 flow focused on explain + preview before we move to real file edits.`
    : `${selectedContext}\n\nFor Day 1, the assistant is intentionally mocked. In the real version, this is where a repo-grounded answer about file ownership, data flow, and change locations would appear.`

  return {
    reply: {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: responseText,
      createdAt: now,
    },
    diffPreviews: shouldSuggestDiff ? [buildMockDiffPreview()] : [],
    pendingSuggestions: shouldSuggestDiff
      ? [
          {
            targetPath: 'src/pages/LoginPage.tsx',
            updatedContent: loginAfter,
            summary: 'Introduce an error state so failed login requests surface a message in the form.',
          },
        ]
      : [],
    contextMeta: {
      usedContextPaths: input.selectedPaths,
      truncatedPaths: [],
      totalCharacters: 0,
    },
  }
}
