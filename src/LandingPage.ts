const LANDING_META_DESCRIPTION =
  "France Monitor cartographie en temps réel les signaux publics critiques en France : actualités géolocalisées, énergie, santé, défense, météo et réseaux.";

function setLandingMeta(): void {
  document.title = 'France Monitor - Cartographie OSINT en temps réel pour la France';

  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute('content', LANDING_META_DESCRIPTION);
  }

  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    ogTitle.setAttribute('content', 'France Monitor - Cartographie OSINT en temps réel pour la France');
  }

  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (ogDescription) {
    ogDescription.setAttribute('content', LANDING_META_DESCRIPTION);
  }

  const twitterTitle = document.querySelector('meta[name="twitter:title"]');
  if (twitterTitle) {
    twitterTitle.setAttribute('content', 'France Monitor - Cartographie OSINT en temps réel pour la France');
  }

  const twitterDescription = document.querySelector('meta[name="twitter:description"]');
  if (twitterDescription) {
    twitterDescription.setAttribute('content', LANDING_META_DESCRIPTION);
  }
}

export function renderLandingPage(container: HTMLElement): void {
  document.documentElement.classList.add('fm-landing-mode');
  document.body.classList.add('fm-landing-mode');
  setLandingMeta();

  container.innerHTML = `
    <div class="landing-shell">
      <div class="landing-backdrop"></div>
      <header class="landing-header">
        <a class="landing-brand" href="/" aria-label="France Monitor">
          <img class="landing-brand__logo" src="/icon.svg" alt="" />
          <span class="landing-brand__text">
            <span class="landing-brand__france">France</span><span class="landing-brand__monitor">Monitor</span>
          </span>
        </a>
        <nav class="landing-nav" aria-label="Navigation landing page">
          <a href="#produit">Produit</a>
          <a href="#modules">Modules</a>
          <a href="#captures">Captures</a>
        </nav>
        <a class="landing-button landing-button--ghost" href="/?view=app#live">Ouvrir la carte</a>
      </header>

      <main class="landing-main">
        <section class="landing-hero" id="produit">
          <div class="landing-hero__copy">
            <div class="landing-chip-row">
              <span class="landing-chip landing-chip--accent">Veille OSINT France</span>
              <span class="landing-chip">Temps réel</span>
              <span class="landing-chip">Sources publiques</span>
            </div>
            <h1>Voir la France comme un système vivant, pas comme une liste de flux.</h1>
            <p class="landing-lead">
              France Monitor agrège des signaux publics hétérogènes et les projette sur une même carte:
              actualités géolocalisées, énergie, santé, météo, transports, défense et réseaux.
            </p>
            <div class="landing-actions">
              <a class="landing-button" href="/?view=app#live">Entrer dans le dashboard</a>
              <a class="landing-button landing-button--ghost" href="#captures">Voir les captures</a>
            </div>
            <ul class="landing-metrics" aria-label="Principes produit">
              <li><strong>1 carte</strong><span>pour relier signaux, lieux et infrastructures.</span></li>
              <li><strong>Modules spécialisés</strong><span>nucléaire, Ecowatt, santé, télécoms, défense, météo.</span></li>
              <li><strong>Lecture rapide</strong><span>panneaux, codes couleur et niveaux de tension lisibles.</span></li>
            </ul>
          </div>
          <div class="landing-hero__visual">
            <div class="landing-hero-card">
              <img src="/landing/hero-overview.png" alt="Vue générale de France Monitor avec carte nationale et panneau nucléaire." />
            </div>
            <div class="landing-floating-note landing-floating-note--top">
              <span class="landing-note-label">Vue d'ensemble</span>
              <strong>Carte nationale + panneaux contextuels</strong>
            </div>
            <div class="landing-floating-note landing-floating-note--bottom">
              <span class="landing-note-dot"></span>
              <span>Conserve le vocabulaire visuel du produit réel</span>
            </div>
          </div>
        </section>

        <section class="landing-section">
          <div class="landing-section__heading">
            <span class="landing-eyebrow">Pourquoi ça parle</span>
            <h2>Une interface de monitoring, présentée sans dilution marketing.</h2>
            <p>
              La landing reprend les codes de l'application: fond sombre, panneaux latéraux, badges d'état,
              hiérarchie dense mais lisible. Le but n'est pas de maquiller le produit, mais de le rendre désirable
              en montrant les meilleurs cas d'usage.
            </p>
          </div>
          <div class="landing-value-grid">
            <article class="landing-value-card">
              <span class="landing-value-card__index">01</span>
              <h3>Actualités géolocalisées</h3>
              <p>Les flux PQR deviennent des clusters spatiaux exploitables à l'échelle d'un territoire.</p>
            </article>
            <article class="landing-value-card">
              <span class="landing-value-card__index">02</span>
              <h3>Infrastructures critiques</h3>
              <p>Électricité, gaz, cloud, câbles, défense: chaque couche garde son langage et son niveau de détail.</p>
            </article>
            <article class="landing-value-card">
              <span class="landing-value-card__index">03</span>
              <h3>Lecture situationnelle</h3>
              <p>Les signaux faibles et les alertes fortes peuvent être lus dans le même cadre cartographique.</p>
            </article>
          </div>
        </section>

        <section class="landing-section" id="modules">
          <div class="landing-section__heading">
            <span class="landing-eyebrow">Modules</span>
            <h2>Quelques vues qui racontent le mieux le produit.</h2>
          </div>
          <div class="landing-feature-grid">
            <article class="landing-feature-card landing-feature-card--wide">
              <div class="landing-feature-card__media">
                <img src="/landing/news-map.png" alt="Carte des actualités géolocalisées de France Monitor avec clusters de couleur." />
              </div>
              <div class="landing-feature-card__body">
                <span class="landing-tag">Actualités</span>
                <h3>Les flux deviennent une géographie.</h3>
                <p>
                  Au lieu d'une colonne d'articles, la landing montre la couche la plus immédiatement parlante:
                  des clusters d'événements hiérarchisés par gravité, directement ancrés sur la carte.
                </p>
              </div>
            </article>

            <article class="landing-feature-card">
              <div class="landing-feature-card__media">
                <img src="/landing/ecowatt-map.png" alt="Vue Ecowatt du réseau électrique français avec régions colorées et flux frontaliers." />
              </div>
              <div class="landing-feature-card__body">
                <span class="landing-tag">Énergie</span>
                <h3>Le système électrique se lit d'un coup d'oeil.</h3>
                <p>Les zones de tension et les échanges frontaliers donnent une lecture immédiate du rapport de force énergétique.</p>
              </div>
            </article>

            <article class="landing-feature-card">
              <div class="landing-feature-card__media">
                <img src="/landing/health-map.png" alt="Vue santé nationale avec stress hospitalier et indicateurs de vigilance." />
              </div>
              <div class="landing-feature-card__body">
                <span class="landing-tag">Santé</span>
                <h3>Un baromètre public plus incarné.</h3>
                <p>Stress hospitalier, urgences, pharmacovigilance et déserts médicaux se combinent dans une lecture unique.</p>
              </div>
            </article>

            <article class="landing-feature-card">
              <div class="landing-feature-card__media">
                <img src="/landing/defense-map.png" alt="Vue défense avec activité militaire, brouillage GPS et proximité des câbles sous-marins." />
              </div>
              <div class="landing-feature-card__body">
                <span class="landing-tag">Souveraineté</span>
                <h3>Défense, brouillage et câbles dans la même scène.</h3>
                <p>La couche la plus dense devient lisible grâce au contraste, aux symboles et aux panneaux de synthèse latéraux.</p>
              </div>
            </article>

            <article class="landing-feature-card">
              <div class="landing-feature-card__media">
                <img src="/landing/cloud-map.png" alt="Vue cloud et IXP centrée sur Paris avec statut des datacenters et points d'échange." />
              </div>
              <div class="landing-feature-card__body">
                <span class="landing-tag">Réseaux</span>
                <h3>Le cloud français traité comme une infrastructure physique.</h3>
                <p>Datacenters, IXP et incidents opérationnels sont replacés sur la carte, sans perdre le contexte national.</p>
              </div>
            </article>
          </div>
        </section>

        <section class="landing-section landing-section--gallery" id="captures">
          <div class="landing-section__heading">
            <span class="landing-eyebrow">Captures</span>
            <h2>Des écrans réels, pas des mockups.</h2>
            <p>
              Les visuels viennent directement de l'application. La landing ne réinvente pas l'UI:
              elle la cadre mieux, hiérarchise les messages et met en avant les écrans les plus expressifs.
            </p>
          </div>
          <div class="landing-gallery">
            <figure class="landing-gallery__item landing-gallery__item--large">
              <img src="/landing/hero-overview.png" alt="Capture large de France Monitor centrée sur la carte nationale." />
            </figure>
            <figure class="landing-gallery__item">
              <img src="/landing/news-map.png" alt="Capture du module d'actualités géolocalisées." />
            </figure>
            <figure class="landing-gallery__item">
              <img src="/landing/ecowatt-map.png" alt="Capture du module Ecowatt." />
            </figure>
            <figure class="landing-gallery__item">
              <img src="/landing/defense-map.png" alt="Capture du module défense." />
            </figure>
            <figure class="landing-gallery__item">
              <img src="/landing/health-map.png" alt="Capture du module santé." />
            </figure>
            <figure class="landing-gallery__item">
              <img src="/landing/cloud-map.png" alt="Capture du module cloud et IXP." />
            </figure>
          </div>
        </section>

        <section class="landing-cta">
          <div>
            <span class="landing-eyebrow">Accès direct</span>
            <h2>La V1 est en ligne, directement accessible.</h2>
            <p>Entrez dans l'interface complète et explorez France Monitor en conditions réelles.</p>
          </div>
          <a class="landing-button" href="/?view=app#live">Ouvrir France Monitor</a>
        </section>
      </main>
    </div>
  `;
}
