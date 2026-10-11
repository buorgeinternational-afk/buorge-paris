import fs from 'node:fs';
import crypto from 'node:crypto';
fs.mkdirSync('.sites-runtime/private',{recursive:true});
const configPath='.sites-runtime/private/secrets.json';
const secrets=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{ADMIN_SETUP_TOKEN:crypto.randomBytes(24).toString('base64url'),STORE_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64')};
fs.writeFileSync(configPath,JSON.stringify(secrets));
fs.writeFileSync('.dev.vars',Object.entries(secrets).map(([k,v])=>`${k}="${v}"`).join('\n'));
fs.writeFileSync('.sites-runtime/private/admin-setup.txt',`BUORGE PARIS — PRIVATE ADMINISTRATOR SETUP\n\nOpen /admin/login on your private Site and sign in with your merchant ChatGPT account.\nEnter this one-time key:\n\n${secrets.ADMIN_SETUP_TOKEN}\n\nThe first successful use grants that account administrator access. Do not share this file.\nThis file is excluded from Git and the deployment archive.\n`);
process.stdout.write(JSON.stringify(secrets));
