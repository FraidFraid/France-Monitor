// api/_lib/rte-iip-agent.js : agent HTTPS réservé à l'hôte RTE IIP (iip.cloud-rte-france.com).
// Le serveur de RTE n'envoie pas son certificat intermédiaire (GlobalSign GCC R46 OV TLS CA 2025) : sans lui, Node refuse la chaîne
// (UNABLE_TO_VERIFY_LEAF_SIGNATURE). On l'ajoute aux racines de Node pour cet hôte seulement : vérification stricte conservée,
// jamais de rejectUnauthorized: false ni de réglage TLS global. Le certificat public est dans api/_lib/certs/ (livré avec api/).
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { Agent } from 'undici';

export const IIP_HOST = 'iip.cloud-rte-france.com';

// Lecture paresseuse : ce module est aussi importé (via outages-power.js) par des jeux d'essai jsdom, où import.meta.url n'est pas un fichier.
let pem = null;
/** Certificat intermédiaire (PEM, en-tête de commentaires compris). */
export function iipIntermediatePem() {
  pem ??= readFileSync(new URL('./certs/globalsign-gcc-r46-ov-tls-ca-2025.pem', import.meta.url), 'utf8');
  return pem;
}

/** Racines de Node + intermédiaire manquant. */
export function iipCa() {
  return [...rootCertificates, iipIntermediatePem()];
}

let dispatcher = null;

/** Agent undici (connexions réutilisées) à passer à fetch() pour les URL de l'hôte IIP. */
export function iipDispatcher() {
  dispatcher ??= new Agent({ connect: { ca: iipCa() } });
  return dispatcher;
}
