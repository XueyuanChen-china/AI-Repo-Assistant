import { useEffect, useState } from 'react'

import { FolderPickerWorkspacePage } from './pages/FolderPickerWorkspacePage'
import { IntroPage } from './pages/IntroPage'

const INTRO_STORAGE_KEY = 'ai-repo-assistant.intro-seen'

function readIntroSeen() {
  if (typeof window === 'undefined') {
    return true
  }

  try {
    return window.localStorage.getItem(INTRO_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export default function App() {
  const [hasSeenIntro, setHasSeenIntro] = useState(() => readIntroSeen())

  useEffect(() => {
    if (!hasSeenIntro || typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(INTRO_STORAGE_KEY, 'true')
  }, [hasSeenIntro])

  if (!hasSeenIntro) {
    return <IntroPage onEnterWorkspace={() => setHasSeenIntro(true)} />
  }

  return <FolderPickerWorkspacePage />
}
