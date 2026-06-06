import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { Flex, Text, IconButton } from '@radix-ui/themes'
import { Cross1Icon, CheckCircledIcon, CrossCircledIcon, InfoCircledIcon } from '@radix-ui/react-icons'

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

const typeConfig: Record<ToastType, { color: 'jade' | 'tomato' | 'indigo'; Icon: typeof CheckCircledIcon }> = {
  success: { color: 'jade', Icon: CheckCircledIcon },
  error: { color: 'tomato', Icon: CrossCircledIcon },
  info: { color: 'indigo', Icon: InfoCircledIcon },
}

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

  return (
    <ToastCtx.Provider value={{ success, error, info }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map(t => {
          const { color, Icon } = typeConfig[t.type]
          return (
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
                  background: `var(--${color}-3)`,
                  border: `1px solid var(--${color}-6)`,
                  borderRadius: 'var(--radius-3)',
                  padding: '12px 16px',
                  boxShadow: 'var(--shadow-3)',
                }}
              >
                <Icon style={{ color: `var(--${color}-9)`, flexShrink: 0 }} />
                <Text size="2">{t.message}</Text>
                <ToastPrimitive.Close asChild>
                  <IconButton size="1" variant="ghost" color={color}>
                    <Cross1Icon />
                  </IconButton>
                </ToastPrimitive.Close>
              </Flex>
            </ToastPrimitive.Root>
          )
        })}
        <ToastPrimitive.Viewport
          style={{
            position: 'fixed',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
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
