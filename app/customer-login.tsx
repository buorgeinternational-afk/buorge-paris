'use client';
import { useState } from 'react';
import { api } from './client';
export default function CustomerLogin({ fr, go, refresh, configured }: any) { const [mode, setMode] = useState('email'), [contact, setContact] = useState(''), [code, setCode] = useState(''), [sent, setSent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''); const t = (a: string, b: string) => fr ? b : a; const payload = () => mode === 'email' ? { email: contact.trim() } : { phone: '+91' + contact.replace(/\D/g, '').slice(-10) }; return <main className="section prose"><p className="eyebrow">LE CERCLE BUORGE</p><h1>{t('Welcome to the maison.', 'Bienvenue à la maison.')}</h1><p>{t('A simple code. A world of discovery.', 'Un simple code. Un monde à découvrir.')}</p>{!configured && <div className="notice">{t('Phone and email verification: configuration required. Use secure ChatGPT sign-in below, or continue as a guest.', 'Vérification par téléphone et e-mail : configuration requise. Utilisez la connexion ChatGPT ci-dessous ou commandez sans compte.')}</div>}<div className="login-methods"><button className={'small-btn ' + (mode === 'email' ? 'chosen' : '')} onClick={() => { setMode('email'); setSent(false); }}>{t('Email', 'E-mail')}</button><button className={'small-btn ' + (mode === 'phone' ? 'chosen' : '')} onClick={() => { setMode('phone'); setSent(false); }}>{t('Mobile number', 'Numéro mobile')}</button></div><form style={{ maxWidth: 420 }} onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try {
    if (sent) {
        await api('auth/verify', { ...payload(), token: code });
        await refresh();
        go('/account');
    }
    else {
        await api('auth/send', payload());
        setSent(true);
    }
}
catch (e: any) {
    setError(e.message);
}
finally {
    setBusy(false);
} }}><label>{mode === 'email' ? t('Email address', 'Adresse e-mail') : t('Indian mobile number (+91)', 'Numéro mobile indien (+91)')}<input required type={mode === 'email' ? 'email' : 'tel'} value={contact} onChange={e => setContact(e.target.value)} readOnly={sent}/></label>{sent && <><label>{t('Verification code', 'Code de vérification')}<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" value={code} onChange={e => setCode(e.target.value)}/></label><p className="muted">{t('Check your email or SMS for the code.', 'Consultez votre e-mail ou SMS pour obtenir le code.')}</p><button type="button" className="text-button" onClick={() => setSent(false)}>{t('Request a new code', 'Demander un nouveau code')}</button></>}{error && <div className="notice" role="alert">{error}</div>}<button className="btn full" disabled={busy || !configured}>{busy ? t('Please wait…', 'Veuillez patienter…') : sent ? t('Verify & continue', 'Vérifier et continuer') : t('Send code', 'Envoyer le code')}</button></form><p><a className="underlink" href={'/signin-with-chatgpt?return_to=/' + (fr ? 'fr' : 'en') + '/account'} target="_top">{t('Continue with ChatGPT', 'Continuer avec ChatGPT')}</a></p><button className="text-button" onClick={() => go('/shop')}>{t('Continue as a guest →', 'Continuer sans compte →')}</button></main>; }
