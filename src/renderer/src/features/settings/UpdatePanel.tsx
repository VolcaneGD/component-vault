import { useEffect, useState } from 'react';
import type { AppLanguage, UpdateSnapshot } from '../../../../shared/contracts';
import { t } from '../../i18n';

export const UpdatePanel = ({ language }: { language: AppLanguage }) => {
  const [status, setStatus] = useState<UpdateSnapshot>({ state: 'idle', currentVersion: '…' });
  useEffect(() => {
    const api = window.componentVault;
    if (!api.getUpdateStatus || !api.onUpdateStatus) {
      setStatus({ state: 'unsupported', currentVersion: '…' });
      return;
    }
    void api.getUpdateStatus().then(setStatus).catch(() => setStatus({ state: 'error', currentVersion: '…' }));
    return api.onUpdateStatus(setStatus);
  }, []);
  const check = () => void window.componentVault.checkForUpdates?.().then(setStatus).catch(() => setStatus(current => ({ ...current, state: 'error' })));
  const download = () => void window.componentVault.downloadUpdate?.().then(setStatus).catch(() => setStatus(current => ({ ...current, state: 'error' })));
  const message = status.state === 'checking' ? t(language, 'checkingForUpdates')
    : status.state === 'available' ? t(language, 'updateAvailable').replace('{version}', status.availableVersion ?? '')
    : status.state === 'downloading' ? `${t(language, 'downloadingUpdate')} ${status.percent ?? 0}%`
    : status.state === 'downloaded' ? t(language, 'updateReady')
    : status.state === 'not-available' ? t(language, 'noUpdatesAvailable')
    : status.state === 'unsupported' ? t(language, 'manualUpdateOnly')
    : status.state === 'error' ? t(language, 'updateFailed') : '';
  const action = status.state === 'available' ? <button type="button" className="button button--primary" onClick={download}>{t(language, 'downloadUpdate')}</button>
    : status.state === 'downloaded' ? <button type="button" className="button button--primary" onClick={() => void window.componentVault.installUpdate?.()}>{t(language, 'restartAndInstall')}</button>
    : status.state === 'unsupported' ? null
    : <button type="button" className="button button--secondary" disabled={status.state === 'checking' || status.state === 'downloading'} onClick={check}>{status.state === 'error' ? t(language, 'retryUpdate') : t(language, 'checkForUpdates')}</button>;
  return <section className="settings-update" aria-labelledby="settings-update-title">
    <h3 id="settings-update-title">{t(language, 'updates')}</h3>
    <p>{t(language, 'currentVersion')}: {status.currentVersion}</p>
    <p role="status" aria-live="polite">{message}</p>
    {status.state === 'downloading' && <progress max="100" value={status.percent ?? 0} />}
    {action}
  </section>;
};
