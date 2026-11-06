/** The panel's Feishu sign-in: explains what it creates, then shows lark-cli's verification URL as a QR code to scan. */
import { useEffect, useState } from 'react'
import type { FeishuSetupStatus } from './api.ts'
import { Button, Icon, Modal } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'

export function FeishuConnect() {
  const { t, call, notify, restart } = usePanel()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<FeishuSetupStatus>({ state: 'idle' })
  const begin = useAction(async () => { setStatus(await call('POST setup/feishu/begin')) })
  const cancel = useAction(async () => { setStatus(await call('POST setup/feishu/cancel')) })
  // While a sign-in is pending, ask lark-cli how it went; the effect below re-checks setup once it is ready.
  useEffect(() => {
    if (!open || status.state !== 'pending') return
    let stopped = false
    const timer = setInterval(() => { void (async () => {
      try { const next = await call('GET setup/feishu/status'); if (!stopped) setStatus(next) }
      catch { /* keep polling; the panel may still be restarting */ }
    })() }, 1500)
    return () => { stopped = true; clearInterval(timer) }
  }, [open, status.state, call])
  useEffect(() => {
    if (status.state !== 'ready') return
    notify(t('feishuConnectReady'))
    void call('POST setup/check').catch(() => {}).then(() => restart())
  }, [status.state, call, notify, restart, t])
  const close = () => {
    if (status.state === 'pending') void cancel.run()
    setStatus({ state: 'idle' })
    setOpen(false)
  }
  const footer = status.state === 'idle'
    ? <>
      <Button variant="ghost" onClick={close}>{t('cancel')}</Button>
      <Button variant="primary" disabled={begin.busy} onClick={() => { void begin.run() }}>{t('feishuConnectStart')}</Button>
    </>
    : status.state === 'pending' ? <Button variant="ghost" onClick={close}>{t('feishuConnectCancel')}</Button>
    : <>
      <Button variant="ghost" onClick={close}>{t('close')}</Button>
      {status.state === 'failed' && <Button variant="primary" disabled={begin.busy}
        onClick={() => { void begin.run() }}>{t('feishuConnectRetry')}</Button>}
    </>
  return <>
    <div className="dt-row-buttons">
      <Button variant="outline" size="sm" icon={<Icon name="external" size={14} />}
        onClick={() => { setStatus({ state: 'idle' }); setOpen(true) }}>{t('feishuConnect')}</Button>
    </div>
    <Modal open={open} onClose={close} title={t('feishuConnectTitle')} closeLabel={t('close')}
      description={status.state === 'idle' ? t('feishuConnectIntro') : undefined} footer={footer}>
      {status.state === 'pending' && <>
        {status.qr ? <img className="dt-qr" src={status.qr} alt={t('feishuConnectQrAlt')} width={220} height={220} />
          : <p className="dt-hint">{t('feishuConnectWaiting')}</p>}
        {status.url && <p className="dt-hint dt-clamp">{status.url}</p>}
      </>}
      {status.state === 'failed' && <p className="dt-error" role="status">{status.message ?? t('feishuConnectFailed')}</p>}
    </Modal>
  </>
}
