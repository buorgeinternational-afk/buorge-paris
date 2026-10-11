'use client';
import { useState } from 'react';
import { api } from './client';
export default function Recovery({ kind, fr, go, refresh }: any) { const [message, setMessage] = useState(''), [busy, setBusy] = useState(false); const t = (a: string, b: string) => fr ? b : a; return <main className="section prose"><p className="eyebrow">LE CERCLE BUORGE</p><h1>{kind === 'recover' ? t('Your discovery awaits.', 'Votre découverte vous attend.') : t('Your preferences matter.', 'Vos préférences comptent.')}</h1><p>{kind === 'recover' ? t('Restore the available fragrances from your saved bag. Prices and availability will be checked again.', 'Retrouvez les parfums disponibles de votre panier. Les prix et disponibilités seront vérifiés.') : t('You can stop promotional email and WhatsApp messages. Essential order updates remain separate.', 'Vous pouvez arrêter les messages promotionnels par e-mail et WhatsApp. Le suivi essentiel des commandes reste distinct.')}</p><button className="btn" disabled={busy} onClick={async () => { setBusy(true); try {
    await api(kind === 'recover' ? 'recover' : 'unsubscribe', { token: new URLSearchParams(location.search).get('token') });
    if (kind === 'recover') {
        await refresh();
        go('/cart');
    }
    else
        setMessage(t('You have been unsubscribed from promotional messages.', 'Vous êtes désabonné des messages promotionnels.'));
}
catch (e: any) {
    setMessage(e.message);
}
finally {
    setBusy(false);
} }}>{kind === 'recover' ? t('Restore my bag', 'Retrouver mon panier') : t('Unsubscribe', 'Me désabonner')}</button>{message && <p role="status">{message}</p>}</main>; }
