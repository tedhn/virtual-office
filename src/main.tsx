import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import '@stream-io/video-react-sdk/dist/css/styles.css'
import './index.css'
import App from './App.tsx'

/**
 * The chrome follows the reader's system preference.
 *
 * `index.css` has carried a full `.dark` palette, and a `dark:` variant keyed on a `.dark`
 * class, since the day the project was scaffolded — and nothing ever set that class, so
 * every carefully written `dark:` utility in the app was dead. This is what makes them
 * render. `next-themes` was already a dependency (the toaster reads it), and it also keeps
 * up with a preference that changes while the tab is open.
 *
 * Note what it does not theme: the Floor. That is one dark surface in either theme — see
 * the palette comment in `index.css` — so nothing about it is keyed on this class.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* `storageKey` is next-themes' own default, written out because `index.html` settles
        the theme before this mounts and has to name the same key. Two places, one string. */}
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="theme"
      disableTransitionOnChange
    >
      <App />
    </ThemeProvider>
  </StrictMode>,
)
