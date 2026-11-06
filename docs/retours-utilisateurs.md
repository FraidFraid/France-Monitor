# Retours utilisateurs

Journal des retours reçus sur France Monitor, avec les pistes qu'ils ouvrent.
Un retour par section, le plus récent en haut.

---

## 05/11/2026 · Médecin

**Contexte** : outil partagé directement par message.

**Retour (verbatim)** :

> Je viens de prendre qq secondes: impressionnant!
> Ce qu'on aime bien en médecine c'est citer les sources pour être pertinent. Mais votre outil est top, c'est une vraie mine...
> Globalement, Si on pouvait avoir les lits disponibles d'hospitalisation, ce serait top...
> Est-ce que je peux diffuser votre outil?

**Ce qu'on en retient** :

- Perception très positive (« impressionnant », « une vraie mine »).
- **Citer les sources** : attente forte du monde médical. Vérifier que chaque donnée santé affiche clairement sa source officielle.
- **Lits d'hospitalisation disponibles** : besoin explicite.
- Diffusion autorisée : oui, réponse envoyée le 05/11/2026.

**Piste « lits disponibles », état des connaissances (05/11/2026)** :

- Aucune donnée ouverte en temps réel sur les lits libres en France.
- ROR (Répertoire opérationnel des ressources) : contient des disponibilités, accès réservé aux professionnels.
- SAE (DREES) : capacités annuelles par établissement (lits installés), pas de lits libres au jour le jour.
- SI-VIC (hospitalisations Covid) : arrêté, ne couvrait que le Covid.
- À étudier : capacités SAE comme socle, indicateurs de tension publiés par les ARS, accès éventuel au ROR via un partenariat.

**Étude du 06/11/2026** :

- Déjà dans l'app : panneau Hôpitaux (lits installés MCO, réanimation, soins intensifs, SAE + FINESS, note « aucune donnée ouverte d'occupation ») et Urgences (Odissé SpF, dont taux d'hospitalisation après passage, hebdomadaire).
- Lits libres en temps réel : uniquement dans le ROR (ANS), accès restreint par habilitation (cercle de confiance, API FHIR), non redistribuable sur un site public. SI-VIC arrêté en 2023. Aucun jeu « plan blanc » ou « tension hospitalière » sur data.gouv.
- Ajouts possibles : lits de soins critiques DREES par département (API Explore DREES), détection des plans blancs dans la presse et les communiqués ARS (événements, sans chiffres de lits).
- Voie longue : convention ANS, ARS ou DGOS pour des indicateurs agrégés par département.

**Statut** : étudié ; l'offre ouverte est déjà affichée, les lits libres restent hors données ouvertes.

**Demandes d'accès envoyées le 06/11/2026** (depuis fred.aubourg@gmail.com, sans citer le médecin) :

- ANS, programme ROR (ans-ror@esante.gouv.fr) : indicateur agrégé de tension en lits par département, quotidien, publiable.
- Enedis (formulaire de contact) : coupures en cours et prévues par commune, en flux exploitable.
- Préfecture du Gers (prefecture@gers.gouv.fr, à l'attention du directeur de cabinet et du SIDPC) : expérimentation de l'outil, sans demande de données.
- À faire : relancer la préfecture par téléphone quelques jours après l'envoi (demander le chef du SIDPC).
