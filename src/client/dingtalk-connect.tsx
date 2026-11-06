/** The panel's DingTalk sign-in: scan once to create and bind the app, then save its credentials into the Source. */
import { useEffect, useState } from 'react'
import type { DingTalkSetupStatus } from '../app/dingtalk-setup.ts'
import { Button, Icon, Modal } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { QrCode } from './scan.tsx'
import { ExternalLink } from './widgets.tsx'

const POLL_MS = 3000
export function DingTalkConnect() {
  const { t, call, notify, restart } = usePanel()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<DingTalkSetupStatus>({ state: 'idle' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const close = () => { if (status.state === 'pending') void call('POST setup/dingtalk/cancel').catch(() => {}); setStatus({ state: 'idle' }); setOpen(false) }
  // Poll DingTalk while an attempt waits for the scan; the backend asks the registration endpoint.
  useEffect(() => {
    if (!open || status.state !== 'pending') return
    let stopped = false
    const timer = setInterval(() => { void (async () => {
      try { const next = await call('GET setup/dingtalk/status'); if (!stopped) setStatus(next) } catch { /* keep polling */ }
    })() }, POLL_MS)
    return () => { stopped = true; clearInterval(timer) }
  }, [open, status.state, call])
  // Once DingTalk returns the new app, save its credentials into the Source and let the plugin reconnect.
  useEffect(() => {
    if (status.state !== 'ready' || saved || saving || !status.appKey || !status.appSecret) return
    setSaving(true)
    void (async () => {
      try {
        const settings = await call('GET settings')
        const source = settings.sources.find(item => item.id === 'dingtalk')
        await call('PUT settings/:block', { block: 'source:dingtalk',
          body: { value: { enabled: true, config: { ...source?.value.config, appKey: status.appKey, appSecret: status.appSecret } },
            revision: source?.revision ?? 0 } })
        setSaved(true)
        notify(t('dingtalkConnectSaved'))
        await call('POST setup/check').catch(() => {})
        restart()
      } catch (failure) {
        setStatus({ state: 'failed', message: failure instanceof Error ? failure.message : String(failure) })
      } finally { setSaving(false) }
    })()
  }, [status, saved, saving, call, notify, restart, t])
  return <>
    <Button variant="outline" size="sm" icon={<Icon name="external" size={14} />} onClick={() => { setStatus({ state: 'idle' }); setSaved(false); setOpen(true) }}>
      {t('dingtalkConnect')}</Button>
    <Modal open={open} onClose={close} title={t('dingtalkConnectTitle')} closeLabel={t('close')}
      description={status.state === 'idle' ? t('dingtalkConnectIntro') : undefined}
      footer={<>
        {status.state !== 'pending' && <Button variant="ghost" onClick={close}>{t('close')}</Button>}
        {status.state === 'pending' && <Button variant="ghost" onClick={close}>{t('dingtalkConnectCancel')}</Button>}
        {status.state === 'idle' && <Button variant="primary" onClick={() => { void call('POST setup/dingtalk/begin').then(setStatus) }}>{t('dingtalkConnectStart')}</Button>}
        {status.state === 'failed' && <Button variant="primary" onClick={() => { void call('POST setup/dingtalk/begin').then(setStatus) }}>{t('feishuConnectRetry')}</Button>}
      </>}>
      {status.state === 'idle' && <div className="dt-scan-side">
        <p className="dt-scan-url">{t('dingtalkScanUrl')}<ExternalLink
          href="https://open-dev.dingtalk.com/fe/appcreate">open-dev.dingtalk.com</ExternalLink></p>
        <ol className="dt-scan-steps">{[t('dingtalkStep1'), t('dingtalkStep2'), t('dingtalkStep3')].map((step, index) => <li
          key={index}>{step}</li>)}</ol>
      </div>}
      {status.state === 'pending' && (status.url ? <div className="dt-scan-body">
        <QrCode url={status.url} label={t('dingtalkConnectQrAlt')} />
        <div className="dt-scan-side"><p className="dt-hint">{t('dingtalkConnectWaiting')}</p></div>
      </div> : <p className="dt-hint">{t('loading')}</p>)}
      {status.state === 'ready' && <>
        <p className="dt-hint" role="status">{saved ? t('dingtalkConnectSaved') : t('dingtalkConnectSaving')}</p>
        {status.verified === false && <p className="dt-error" role="alert">{t('dingtalkVerifyFailed', { error: status.verifyError ?? '' })}</p>}
        <ol className="dt-scan-steps">
          <li>{t('dingtalkNextPublish')}</li>
          <li>{t('dingtalkNextRobot')}</li>
          <li>{t('dingtalkNextGroup')}</li>
        </ol>
        <button type="button" className="dt-textlink"
          onClick={() => { void call('POST setup/dingtalk/check').then(setStatus) }}>{t('dingtalkRecheck')}</button>
      </>}
      {status.state === 'failed' && <p className="dt-error" role="alert">{status.message ?? t('dingtalkConnectFailed')}</p>}
    </Modal>
  </>
}
