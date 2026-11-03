import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { ReleaseUpdate } from '../../update/checkUpdate'

type Props = {
  update: ReleaseUpdate
  onDismiss: () => void
}

export function UpdateBanner({ update, onDismiss }: Props) {
  const [updating, setUpdating] = useState(false)
  const isNative = Capacitor.isNativePlatform()
  const downloadHref = update.apkUrl ?? update.htmlUrl

  const handleWebReload = async () => {
    setUpdating(true)
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        for (const reg of registrations) {
          await reg.update()
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          }
          await reg.unregister()
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch {
      // Ignorar fallo de almacenamiento y proceder a recargar
    }
    window.location.reload()
  }

  return (
    <aside className="update-banner" role="status">
      <p className="update-banner-text">
        Hay una actualización disponible: <strong>{update.tagName}</strong>
        {update.name && update.name !== update.tagName ? (
          <>
            {' '}
            · {update.name}
          </>
        ) : null}
        . {isNative ? 'Instalá el APK nuevo desde GitHub Releases.' : 'Actualizá la aplicación web para aplicar los últimos cambios.'}
      </p>
      <div className="row gap wrap">
        {isNative ? (
          <a className="button primary" href={downloadHref} target="_blank" rel="noreferrer">
            Descargar actualización
          </a>
        ) : (
          <button
            type="button"
            className="button primary"
            disabled={updating}
            onClick={() => void handleWebReload()}
          >
            {updating ? 'Actualizando…' : 'Actualizar web'}
          </button>
        )}
        <a className="button ghost" href={update.htmlUrl} target="_blank" rel="noreferrer">
          Ver cambios
        </a>
        {!isNative && update.apkUrl ? (
          <a className="button ghost" href={update.apkUrl} target="_blank" rel="noreferrer">
            Descargar APK (Android)
          </a>
        ) : null}
        <button type="button" className="ghost" onClick={onDismiss}>
          Más tarde
        </button>
      </div>
    </aside>
  )
}
