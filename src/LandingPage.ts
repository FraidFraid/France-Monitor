import { getCurrentLanguage, onLanguageChange, setLanguage, t } from './services/i18n.ts';

// Dimensions intrinsèques des variantes 1440w générées par
// scripts/optimize-landing-images.py — utilisées comme attributs width/height
// pour réserver l'espace de mise en page (évite le layout shift) avant même
// que l'image ne soit chargée.
const LANDING_MAP_DIMS = { width: 1440, height: 836 } as const; // ratio source 5344x3104
const LANDING_HERO_DIMS = { width: 1440, height: 810 } as const; // ratio source 2560x1440

interface LandingPictureOptions {
  /** Nom de fichier sans extension (ex: "news-map") dans /landing/. */
  name: string;
  alt: string;
  /** Attribut sizes du <picture>, ajusté au conteneur réel dans la mise en page. */
  sizes: string;
  dims: { width: number; height: number };
  /**
   * Image visible dès le premier rendu (ex: le hero) : pas de lazy-loading,
   * priorité de récupération haute. Sinon : loading="lazy" + decoding="async".
   */
  priority?: boolean;
}

/** Construit un <picture> AVIF/WebP responsive (720w/1440w) pour une capture de la landing. */
function landingPicture({ name, alt, sizes, dims, priority = false }: LandingPictureOptions): string {
  const loadingAttrs = priority
    ? 'fetchpriority="high" decoding="async"'
    : 'loading="lazy" decoding="async"';
  return `
    <picture>
      <source
        type="image/avif"
        srcset="/landing/${name}-720w.avif 720w, /landing/${name}-1440w.avif 1440w"
        sizes="${sizes}"
      />
      <source
        type="image/webp"
        srcset="/landing/${name}-720w.webp 720w, /landing/${name}-1440w.webp 1440w"
        sizes="${sizes}"
      />
      <img
        src="/landing/${name}-1440w.webp"
        width="${dims.width}"
        height="${dims.height}"
        alt="${alt}"
        ${loadingAttrs}
      />
    </picture>
  `;
}

function setLandingMeta(): void {
  document.title = t('landing.metaTitle');

  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute('content', t('landing.metaDescription'));
  }

  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    ogTitle.setAttribute('content', t('landing.metaTitle'));
  }

  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (ogDescription) {
    ogDescription.setAttribute('content', t('landing.metaDescription'));
  }

  const twitterTitle = document.querySelector('meta[name="twitter:title"]');
  if (twitterTitle) {
    twitterTitle.setAttribute('content', t('landing.metaTitle'));
  }

  const twitterDescription = document.querySelector('meta[name="twitter:description"]');
  if (twitterDescription) {
    twitterDescription.setAttribute('content', t('landing.metaDescription'));
  }
}

let isLandingSubscribed = false;

export function renderLandingPage(container: HTMLElement): void {
  document.documentElement.classList.add('fm-landing-mode');
  document.body.classList.add('fm-landing-mode');
  setLandingMeta();

  const language = getCurrentLanguage();
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
        <nav class="landing-nav" aria-label="${t('landing.navAria')}">
          <a href="#produit">${t('landing.nav.product')}</a>
          <a href="#modules">${t('landing.nav.modules')}</a>
          <a href="#captures">${t('landing.nav.captures')}</a>
          <a href="/sources-quality">Sources & qualité</a>
        </nav>
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="header-language-toggle" role="group" aria-label="${t('app.languageSwitcher')}">
            <button class="header-language-toggle__btn ${language === 'fr' ? 'is-active' : ''}" type="button" data-language="fr">FR</button>
            <button class="header-language-toggle__btn ${language === 'en' ? 'is-active' : ''}" type="button" data-language="en">EN</button>
          </div>
          <a class="landing-button landing-button--ghost" href="/?view=app#live">${t('landing.openMap')}</a>
        </div>
      </header>

      <main class="landing-main">
        <section class="landing-hero" id="produit">
          <div class="landing-hero__copy">
            <div class="landing-chip-row">
              <span class="landing-chip landing-chip--accent">${t('landing.chips.osint')}</span>
              <span class="landing-chip">${t('landing.chips.realtime')}</span>
              <span class="landing-chip">${t('landing.chips.publicSources')}</span>
            </div>
            <h1>${t('landing.heroTitle')}</h1>
            <p class="landing-lead">
              ${t('landing.heroLead')}
            </p>
            <div class="landing-actions">
              <a class="landing-button" href="/?view=app#live">${t('landing.enterDashboard')}</a>
              <a class="landing-button landing-button--ghost" href="#captures">${t('landing.seeCaptures')}</a>
            </div>
            <ul class="landing-metrics" aria-label="${t('landing.metricsAria')}">
              <li><strong>${t('landing.metrics.mapTitle')}</strong><span>${t('landing.metrics.mapBody')}</span></li>
              <li><strong>${t('landing.metrics.modulesTitle')}</strong><span>${t('landing.metrics.modulesBody')}</span></li>
              <li><strong>${t('landing.metrics.readingTitle')}</strong><span>${t('landing.metrics.readingBody')}</span></li>
            </ul>
          </div>
          <div class="landing-hero__visual">
            <div class="landing-hero-card">
              ${landingPicture({
                name: 'hero-overview',
                alt: 'Vue générale de France Monitor avec carte nationale et panneau nucléaire.',
                sizes: '(max-width: 1120px) 100vw, 720px',
                dims: LANDING_HERO_DIMS,
                priority: true,
              })}
            </div>
            <div class="landing-floating-note landing-floating-note--top">
              <span class="landing-note-label">${t('landing.overviewLabel')}</span>
              <strong>${t('landing.overviewTitle')}</strong>
            </div>
            <div class="landing-floating-note landing-floating-note--bottom">
              <span class="landing-note-dot"></span>
              <span>${t('landing.overviewBody')}</span>
            </div>
          </div>
        </section>

        <section class="landing-section">
          <div class="landing-section__heading">
            <span class="landing-eyebrow">${t('landing.whyEyebrow')}</span>
            <h2>${t('landing.whyTitle')}</h2>
            <p>
              ${t('landing.whyBody')}
            </p>
          </div>
          <div class="landing-value-grid">
            <article class="landing-value-card">
              <span class="landing-value-card__index">01</span>
              <h3>${t('landing.valueCards.geoTitle')}</h3>
              <p>${t('landing.valueCards.geoBody')}</p>
            </article>
            <article class="landing-value-card">
              <span class="landing-value-card__index">02</span>
              <h3>${t('landing.valueCards.infraTitle')}</h3>
              <p>${t('landing.valueCards.infraBody')}</p>
            </article>
            <article class="landing-value-card">
              <span class="landing-value-card__index">03</span>
              <h3>${t('landing.valueCards.situationalTitle')}</h3>
              <p>${t('landing.valueCards.situationalBody')}</p>
            </article>
          </div>
        </section>

        <section class="landing-section" id="modules">
          <div class="landing-section__heading">
            <span class="landing-eyebrow">${t('landing.modulesEyebrow')}</span>
            <h2>${t('landing.modulesTitle')}</h2>
          </div>
          <div class="landing-feature-grid">
            <article class="landing-feature-card landing-feature-card--wide">
              <div class="landing-feature-card__media">
                ${landingPicture({
                  name: 'news-map',
                  alt: 'Carte des actualités géolocalisées de France Monitor avec clusters de couleur.',
                  sizes: '(max-width: 1120px) 100vw, 1380px',
                  dims: LANDING_MAP_DIMS,
                })}
              </div>
              <div class="landing-feature-card__body">
                <span class="landing-tag">${t('landing.features.newsTag')}</span>
                <h3>${t('landing.features.newsTitle')}</h3>
                <p>${t('landing.features.newsBody')}</p>
              </div>
            </article>

            <article class="landing-feature-card">
              <div class="landing-feature-card__media">
                ${landingPicture({
                  name: 'ecowatt-map',
                  alt: 'Vue Ecowatt du réseau électrique français avec régions colorées et flux frontaliers.',
                  sizes: '(max-width: 1120px) 100vw, 681px',
                  dims: LANDING_MAP_DIMS,
                })}
              </div>
              <div class="landing-feature-card__body">
                <span class="landing-tag">${t('landing.features.energyTag')}</span>
                <h3>${t('landing.features.energyTitle')}</h3>
                <p>${t('landing.features.energyBody')}</p>
              </div>
            </article>

            <article class="landing-feature-card">
              <div class="landing-feature-card__media">
                ${landingPicture({
                  name: 'health-map',
                  alt: 'Vue santé nationale avec stress hospitalier et indicateurs de vigilance.',
                  sizes: '(max-width: 1120px) 100vw, 681px',
                  dims: LANDING_MAP_DIMS,
                })}
              </div>
              <div class="landing-feature-card__body">
                <span class="landing-tag">${t('landing.features.healthTag')}</span>
                <h3>${t('landing.features.healthTitle')}</h3>
                <p>${t('landing.features.healthBody')}</p>
              </div>
            </article>

            <article class="landing-feature-card">
              <div class="landing-feature-card__media">
                ${landingPicture({
                  name: 'defense-map',
                  alt: 'Vue défense avec activité militaire, brouillage GPS et proximité des câbles sous-marins.',
                  sizes: '(max-width: 1120px) 100vw, 681px',
                  dims: LANDING_MAP_DIMS,
                })}
              </div>
              <div class="landing-feature-card__body">
                <span class="landing-tag">${t('landing.features.sovereigntyTag')}</span>
                <h3>${t('landing.features.sovereigntyTitle')}</h3>
                <p>${t('landing.features.sovereigntyBody')}</p>
              </div>
            </article>

            <article class="landing-feature-card">
              <div class="landing-feature-card__media">
                ${landingPicture({
                  name: 'cloud-map',
                  alt: "Vue cloud et IXP centrée sur Paris avec statut des datacenters et points d'échange.",
                  sizes: '(max-width: 1120px) 100vw, 681px',
                  dims: LANDING_MAP_DIMS,
                })}
              </div>
              <div class="landing-feature-card__body">
                <span class="landing-tag">${t('landing.features.networksTag')}</span>
                <h3>${t('landing.features.networksTitle')}</h3>
                <p>${t('landing.features.networksBody')}</p>
              </div>
            </article>
          </div>
        </section>

        <section class="landing-section landing-section--gallery" id="captures">
          <div class="landing-section__heading">
            <span class="landing-eyebrow">${t('landing.capturesEyebrow')}</span>
            <h2>${t('landing.capturesTitle')}</h2>
            <p>
              ${t('landing.capturesBody')}
            </p>
          </div>
          <div class="landing-gallery">
            <figure class="landing-gallery__item landing-gallery__item--large">
              ${landingPicture({
                name: 'hero-overview',
                alt: 'Capture large de France Monitor centrée sur la carte nationale.',
                sizes: '(max-width: 1120px) 100vw, 900px',
                dims: LANDING_HERO_DIMS,
              })}
            </figure>
            <figure class="landing-gallery__item">
              ${landingPicture({
                name: 'news-map',
                alt: "Capture du module d'actualités géolocalisées.",
                sizes: '(max-width: 1120px) 50vw, 440px',
                dims: LANDING_MAP_DIMS,
              })}
            </figure>
            <figure class="landing-gallery__item">
              ${landingPicture({
                name: 'ecowatt-map',
                alt: 'Capture du module Ecowatt.',
                sizes: '(max-width: 1120px) 50vw, 440px',
                dims: LANDING_MAP_DIMS,
              })}
            </figure>
            <figure class="landing-gallery__item">
              ${landingPicture({
                name: 'defense-map',
                alt: 'Capture du module défense.',
                sizes: '(max-width: 1120px) 50vw, 440px',
                dims: LANDING_MAP_DIMS,
              })}
            </figure>
            <figure class="landing-gallery__item">
              ${landingPicture({
                name: 'health-map',
                alt: 'Capture du module santé.',
                sizes: '(max-width: 1120px) 50vw, 440px',
                dims: LANDING_MAP_DIMS,
              })}
            </figure>
            <figure class="landing-gallery__item">
              ${landingPicture({
                name: 'cloud-map',
                alt: 'Capture du module cloud et IXP.',
                sizes: '(max-width: 1120px) 50vw, 440px',
                dims: LANDING_MAP_DIMS,
              })}
            </figure>
          </div>
        </section>

        <section class="landing-cta">
          <div>
            <span class="landing-eyebrow">${t('landing.ctaEyebrow')}</span>
            <h2>${t('landing.ctaTitle')}</h2>
            <p>${t('landing.ctaBody')}</p>
          </div>
          <a class="landing-button" href="/?view=app#live">${t('landing.openApp')}</a>
        </section>
      </main>
    </div>
  `;

  container.querySelectorAll<HTMLButtonElement>('[data-language]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextLanguage = button.dataset.language;
      if (nextLanguage === 'fr' || nextLanguage === 'en') {
        void setLanguage(nextLanguage);
      }
    });
  });

  if (!isLandingSubscribed) {
    isLandingSubscribed = true;
    onLanguageChange(() => renderLandingPage(container));
  }
}
