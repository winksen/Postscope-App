import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/hooks/use-theme'

const THEME_KEY = 'postscope-theme'

function applyInitialTheme() {
  const root = document.documentElement
  const storedTheme = localStorage.getItem(THEME_KEY) as 'light' | 'dark' | 'system' | null
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const shouldUseDark = storedTheme === 'dark' || (storedTheme !== 'light' && prefersDark)
  root.classList.toggle('dark', shouldUseDark)
}

applyInitialTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
