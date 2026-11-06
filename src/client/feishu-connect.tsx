/** The panel's Feishu sign-in: installs lark-cli when the deployment has none, then shows its verification URL as a QR code. */
import { useEffect, useState } from 'react'
import type { FeishuSetupStatus } from './api.ts'
import { Button, Icon, Modal } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'

export function FeishuConnect() {
  const { t, call, notify, restart } = usePanel()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<FeishuSetupStatus>({ state: 'idle' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const begin = useAction(async () => { setStatus(await call('POST setup/feishu/begin')) })
  const restrict = useAction(async () => { setStatus(await call('POST setup/feishu/restrict')) })
  const cancel = useAction(async () => { setStatus(await call('POST setup/feishu/cancel')) })
  // An install, a sign-in and a restriction all report through setup/feishu/status, so the modal polls while one is in flight.
  useEffect(() => {
    if (!open || (status.state !== 'installing' && status.state !== 'pending' && status.state !== 'restricting')) return
    let stopped = false
    const timer = setInterval(() => { void (async () => {
      try { const next = await call('GET setup/feishu/status'); if (!stopped) setStatus(next) }
      catch { /* keep polling; the panel may still be restarting */ }
    })() }, 1500)
    return () => { stopped = true; clearInterval(timer) }
  }, [open, status.state, call])
  // A finished sign-in names the CLI and its configuration directory; saving both lets setup call that CLI from now on.
  useEffect(() => {
    if (status.state !== 'ready' || saved || saving || !status.cli) return
    setSaving(true)
    void (async () => {
      try {
        const settings = await call('GET settings')
        const source = settings.sources.find(item => item.id === 'feishu')
        await call('PUT settings/:block', { block: 'source:feishu',
          body: { value: { enabled: true, config: { ...source?.value.config, cli: status.cli, configDir: status.configDir } },
            revision: source?.revision ?? 0 } })
        setSaved(true)
        notify(t('feishuConnectReady'))
        await call('POST setup/check').catch(() => {})
        restart()
      } catch (failure) {
        setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) })
      } finally { setSaving(false) }
    })()
  }, [status, saved, saving, call, notify, restart, t])
  const close = () => {
    if (status.state === 'pending' || status.state === 'installing' || status.state === 'identity' || status.state === 'restricting') void cancel.run()
    setStatus({ state: 'idle' })
    setOpen(false)
  }
  const footer = status.state === 'idle'
    ? <>
      <Button variant="ghost" onClick={close}>{t('cancel')}</Button>
      <Button variant="primary" disabled={begin.busy} onClick={() => { void begin.run() }}>{t('feishuConnectStart')}</Button>
    </>
    : status.state === 'identity'
      ? <>
        <Button variant="ghost" onClick={close}>{t('cancel')}</Button>
        <Button variant="primary" disabled={restrict.busy} onClick={() => { void restrict.run() }}>{t('feishuConnectRestrict')}</Button>
      </>
    : status.state === 'installing' || status.state === 'pending' || status.state === 'restricting'
      ? <Button variant="ghost" onClick={close}>{t('feishuConnectCancel')}</Button>
    : <>
      <Button variant="ghost" onClick={close}>{t('close')}</Button>
      {status.state === 'failed' && <Button variant="primary" disabled={begin.busy}
        onClick={() => { void begin.run() }}>{t('feishuConnectRetry')}</Button>}
    </>
  return <>
    <div className="dt-row-buttons">
      <Button variant="outline" size="sm" icon={<Icon name="external" size={14} />}
        onClick={() => { setStatus({ state: 'idle' }); setSaved(false); setOpen(true) }}>{t('feishuConnect')}</Button>
    </div>
    <Modal open={open} onClose={close} title={t('feishuConnectTitle')} closeLabel={t('close')}
      description={status.state === 'idle' ? t('feishuConnectIntro') : undefined} footer={footer}>
      {status.state === 'installing' && <p className="dt-hint" role="status">{t('feishuConnectInstalling')}</p>}
      {status.state === 'pending' && <>
        {status.qr ? <img className="dt-qr" src={status.qr} alt={t('feishuConnectQrAlt')} width={220} height={220} />
          : <p className="dt-hint">{t('feishuConnectWaiting')}</p>}
        {status.url && <p className="dt-hint dt-clamp">{status.url}</p>}
      </>}
      {status.state === 'identity' && <p className="dt-error" role="alert">{t('feishuConnectIdentity')}</p>}
      {status.state === 'restricting' && <p className="dt-hint" role="status">{t('feishuConnectRestricting')}</p>}
      {status.state === 'ready' && <p className="dt-hint" role="status">{saved ? t('feishuConnectSaved') : t('feishuConnectSaving')}</p>}
      {status.state === 'failed' && <p className="dt-error" role="status">{status.message ?? t('feishuConnectFailed')}</p>}
    </Modal>
  </>
}
