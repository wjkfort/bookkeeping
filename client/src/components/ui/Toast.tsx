import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { Flex, Text, IconButton } from '@radix-ui/themes'
import { Cross1Icon } from '@radix-ui/react-icons'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastContextType {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastCtx = createContext<ToastContextType | null>(null)

let toastId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }, [])

  const success = useCallback((msg: string) => addToast(msg, 'success'), [addToast])
  const error = useCallback((msg: string) => addToast(msg, 'error'), [addToast])
  const info = useCallback((msg: string) => addToast(msg, 'info'), [addToast])

  const colorMap: Record<ToastType, 'green' | 'red' | 'blue'> = {
    success: 'green',
    error: 'red',
    info: 'blue',
  }

  return (
    <ToastCtx.Provider value={{ success, error, info }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map(t => (
          <ToastPrimitive.Root
            key={t.id}
            open
            onOpenChange={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
            asChild
          >
            <Flex
              align="center"
              gap="2"
              style={{
                background: `var(--${colorMap[t.type]}-3)`,
                border: `1px solid var(--${colorMap[t.type]}-6)`,
                borderRadius: 'var(--radius-3)',
                padding: '12px 16px',
                boxShadow: 'var(--shadow-3)',
              }}
            >
              <Text size="2">{t.message}</Text>
              <ToastPrimitive.Close asChild>
                <IconButton size="1" variant="ghost" color="gray">
                  <Cross1Icon />
                </IconButton>
              </ToastPrimitive.Close>
            </Flex>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            zIndex: 9999,
            maxWidth: 360,
          }}
        />
      </ToastPrimitive.Provider>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
