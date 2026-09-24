// api/index.js — fonction Vercel unique qui sert tous les handlers de api/_handlers/.
// Voir api/_utils/dispatch.js pour le pourquoi (limite de 12 fonctions du palier Hobby) et le comment.
import { dispatch } from './_utils/dispatch.js';

/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  await dispatch(req, res);
}
