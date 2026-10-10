import { useState, useCallback, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ToastCtx } from './toastContext'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { Flex, Text, IconButton } from '@radix-ui/themes'
import './Toast.css'
import { Cross1Icon, CheckCircledIcon, CrossCircledIcon, InfoCircledIcon } from '@radix-ui/react-icons'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  type: ToastType
}

let toastId = 0

const typeConfig: Record<ToastType, { Icon: typeof CheckCircledIcon }> = {
  success: { Icon: CheckCircledIcon },
  error: { Icon: CrossCircledIcon },
  info: { Icon: InfoCircledIcon },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t: translate } = useTranslation()
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
          const { Icon } = typeConfig[t.type]
          return (
            <ToastPrimitive.Root
              key={t.id}
              open
              role="status"
              aria-live="polite"
              onOpenChange={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
              asChild
            >
              <Flex align="center" gap="3" className={`app-toast app-toast--${t.type}`}>
                <Icon className="app-toast-icon" />
                <Text size="2" className="app-toast-message">{t.message}</Text>
                <ToastPrimitive.Close asChild>
                  <IconButton size="1" variant="ghost" className="app-toast-close" aria-label={translate("common.closeNotification")}>
                    <Cross1Icon />
                  </IconButton>
                </ToastPrimitive.Close>
              </Flex>
            </ToastPrimitive.Root>
          )
        })}
        <ToastPrimitive.Viewport className="app-toast-viewport" />
      </ToastPrimitive.Provider>
    </ToastCtx.Provider>
  )
}
