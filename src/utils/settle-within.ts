/**
 * settle-within.ts — Borne l'attente d'une promesse sans l'annuler.
 *
 * Rend la valeur de `promise` si elle se règle dans `ms`, sinon `fallback` ; un rejet
 * donne aussi `fallback`. La promesse continue : ses autres consommateurs (ex. le panneau
 * qui affiche les événements) reçoivent le résultat quand il arrive.
 */
export function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
