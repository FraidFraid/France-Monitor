// src/services/oil.fixture.ts
// Extraits réels du 16/10/2026 : chapitre pétrole des Chiffres clés de l'énergie (SDES, édition 2026, données 2025)
// et tableau « Provenance du pétrole brut importé » de l'Insee (paru le 21/05/2026, colonnes 2021 à 2025 provisoire).

export const SDES_PETROLE_2026_HTML = `"contenu">


<div id="_idContainer112" class="Bloc-de-texte-standard">
			<h1 class="h1">Pétrole</h1>
			<h2 class="h2">Importations de pétrole brut* par origine<br><span class="h2-noir">TOTAL\u00a0: 46,9\u00a0Mtep en 2025, soit 546\u00a0TWh</span>
</h2>
			<div class="image"><a href="./image/importations-petrole-brut-origine-2026-cgdd.svg" data-fancybox="images"><img class="image" src="./image/importations-petrole-brut-origine-2026-cgdd.svg" alt=""></a></div>
			<p class="source-graph">(p) = provisoire.<br>* Y compris de faibles quantités de condensats à destination du raffinage et de la pétrochimie, d’additifs oxygénés (non issus de biomasse) et d’autres produits à distiller, à partir de 1990.<br><sup>1</sup> Algérie, Égypte, Lybie, Maroc, Tunisie.<br><sup>2</sup> Danemark, Norvège, Pays-Bas et Royaume-Uni.<br><sup>3</sup
e la consommation nationale de pétrole.</p>
			<p class="paragraphe paragraphe-esp">Au 1<sup>er</sup>\u00a0janvier 2026, les réserves de pétrole brut (5,0\u00a0Mtep) de la France représentent environ un\u00a0mois de consommation nationale.</p>
			<p class="ancre ancre2" id="ancre2"> </p>
			<h2 class="h2">Importations et exportations de produits pétroliers raffinés, production nette de produits finis des raffineries</h2>
			<div class="image"><a href="./image/importations-exportations-produits-petroliers-2026-cgdd.svg" data-fancybox="images"><img class="image" src="./image/importations-exportations-produits-petroliers-2026-cgdd.svg" alt=""></a></div>
			<p class="source-graph">(p) = provisoire.<br>Champ : jusqu’à l’année 2010 incluse, le périmètre géographique est la France métropolitaine. À\u00a0partir\u00a0de\u00a02011, il inclut en out
entre 2021 (33,2\u00a0Mtep) et 2025 (17,0\u00a0Mtep, soit 197\u00a0TWh). Cette amélioration du solde s’explique par une\u00a0diminution des importations de produits raffinés (45,8\u00a0Mtep en 2021 contre 34,5\u00a0Mtep en 2025) couplée à une augmentation des exportations de ces produits (12,6\u00a0Mtep en 2021 contre 17,5\u00a0Mtep en\u00a02025).</p>
			<p class="ancre ancre3" id="ancre3"> </p>
			<h2 class="h2">Consommation de produits raffinés* par secteur<br><span class="h2-noir">TOTAL : 60 Mtep en 2025 soit 700</span>\u00a0<span class="h2-noir">TWh</span>
</h2>
			<div class="image"><a href="./image/consommation-produits-raffines-secteur-2026-cgdd.svg" data-fancybox="images"><img class="image" src="./image/consommation-produits-raffines-secteur-2026-cgdd.svg" alt=""></a></div>
			<p class="source-graph">* Hors biocarburants et soutes maritimes et aérien
oduits (12,6\u00a0Mtep en 2021 contre 17,5\u00a0Mtep en\u00a02025).</p>
			<p class="ancre ancre3" id="ancre3"> </p>
			<h2 class="h2">Consommation de produits raffinés* par secteur<br><span class="h2-noir">TOTAL : 60 Mtep en 2025 soit 700</span>\u00a0<span class="h2-noir">TWh</span>
</h2>
			<div class="image"><a href="./image/consommation-produits-raffines-secteur-2026-cgdd.svg" data-fancybox="images"><img class="image" src="./image/consommation-produits-raffines-secteur-2026-cgdd.svg" alt=""></a></div>
			<p class="source-graph">* Hors biocarburants et soutes maritimes et aériennes internationales.<br>** Les consommations des armées sont comptabilisées ici au sein du secteur tertiaire.<br>(p) = provisoire.<br>Champ : jusqu’à l’année 2010 incluse, le périmètre géographique est la France métropolitaine. À\u00a0partir\u00a0de\u00a02011, il inc`;

export const INSEE_ORIGINES_2026_HTML = `<table id="produit-tableau-figure1" class="tableau-produit" style="">
<caption>Provenance du pétrole brut importé en France (en millions de tonnes)</caption>
<thead>
<tr class="">
<th class="" scope="col">Provenance</th>
<th class="" scope="col">2021</th>
<th class="" scope="col">2022</th>
<th class="" scope="col">2023</th>
<th class="" scope="col">2024</th>
<th class="" scope="col">2025 (p)</th>
<th class="" scope="col">2025 (p)&nbsp;(en&nbsp;%)</th>
</tr>
</thead>
<tbody>
<tr class="">
<th class="ligne " scope="row">Afrique</th>
<td class="nombre ">12,6</td>
<td class="nombre ">14,9</td>
<td class="nombre ">17,7</td>
<td class="nombre ">17,0</td>
<td class="nombre ">16,8</td>
<td class="nombre ">36,6</td>
</tr>
<tr class="">
<th class="ligne ventilation " scope="row">&nbsp;&nbsp;&nbsp;&nbsp;dont :</th>
<td class="nombre ventilation " colspan="6"></td>
</tr>
<tr class="">
<th class="ligne ventilation " scope="row">&nbsp;&nbsp;&nbsp;&nbsp;Algérie</th>
<td class="nombre ventilation ">3,9</td>
<td class="nombre ventilation ">3,7</td>
<td class="nombre ventilation ">4,4</td>
<td class="nombre ventilation ">4,2</td>
<td class="nombre ventilation ">4,3</td>
<td class="nombre ventilation ">9,4</td>
</tr>
<tr class="">
<th class="ligne ventilation " scope="row">&nbsp;&nbsp;&nbsp;&nbsp;Libye</th>
<td class="nombre ventilation ">3,4</td>
<td class="nombre ventilation ">2,6</td>
<td class="nombre ventilation ">4,0</td>
<td class="nombre ventilation ">3,3</td>
<td class="nombre ventilation ">4,3</td>
<td class="nombre ventilation ">9,4</td>
</tr>
<tr class="">
<th class="ligne ventilation " scope="row">&nbsp;&nbsp;&nbsp;&nbsp;Nigéria</th>
<td class="nombre ventilation ">3,9</td>
<td class="nombre ventilation ">4,1</td>
<td class="nombre ventilation ">5,6</td>
<td class="nombre ventilation ">5,3</td>
<td class="nombre ventilation ">5,5</td>
<td class="nombre ventilation ">11,9</td>
</tr>
<tr class="">
<th class="ligne " scope="row">Amérique du Nord</th>
<td class="nombre ">4,8</td>
<td class="nombre ">6,5</td>
<td class="nombre ">7,9</td>
<td class="nombre ">10,5</td>
<td class="nombre ">10,6</td>
<td class="nombre ">23,1</td>
</tr>
<tr class="">
<th class="ligne ventilation " scope="row">&nbsp;&nbsp;&nbsp;&nbsp;dont États-Unis</th>
<td class="nombre ventilation ">4,4</td>
<td class="nombre ventilation ">6,1</td>
<td class="nombre ventilation ">7,6</td>
<td class="nombre ventilation ">10,1</td>
<td class="nombre ventilation ">10,1</td>
<td class="nombre ventilation ">22,0</td>
</tr>
<tr class="">
<th class="ligne " scope="row">URSS/ex-URSS</th>
<td class="nombre ">7,7</td>
<td class="nombre ">7,9</td>
<td class="nombre ">5,8</td>
<td class="nombre ">5,7</td>
<td class="nombre ">7,2</td>
<td class="nombre ">15,6</td>
</tr>
<tr class="">
<th class="ligne ventilation " scope="row">&nbsp;&nbsp;&nbsp;&nbsp;dont :</th>
<td class="nombre ventilation " colspan="6"></td>
</tr>
<tr class="">
<th class="ligne ventilation " scope="row">&nbsp;&nbsp;&nbsp;&nbsp;Kazakhstan</th>
<td class="nombre ventilation ">4,5</td>
<td class="nombre ventilation ">5,6</td>
<td class="nombre ventilation ">5,5</td>
<td class="nombre ventilation ">5,4</td>
<td class="nombre ventilation ">6,8</td>
<td class="nombre ventilation ">14,9</td>
</tr>
<tr class="">
<th class="ligne ventilation " scope="row">&nbsp;&nbsp;&nbsp;&nbsp;Russie</th>
<td class="nombre ventilation ">3,0</td>
<td class="nombre ventilation ">2,1</td>
<td class="nombre ventilation ">0,0</td>
<td class="nombre ventilation ">0,0</td>
<td class="nombre ventilation ">0,0</td>
<td class="nombre ventilation ">0,0</td>
</tr>
<tr class="">
<th class="ligne " scope="row">Mer du Nord</th>
<td class="nombre ">3,5</td>
<td class="nombre ">4,5</td>
<td class="nombre ">4,2</td>
<td class="nombre ">4,4</td>
<td class="nombre ">4,7</td>
<td class="nombre ">10,2</td>
</tr>
<tr class="">
<th class="ligne ventilation " scope="row">&nbsp;&nbsp;&nbsp;&nbsp;dont Norvège</th>
<td class="nombre ventilation ">2,3</td>
<td class="nombre ventilation ">3,3</td>
<td class="nombre ventilation ">3,3</td>
<td class="nombre ventilation ">3,5</td>
<td class="nombre ventilation ">4,4</td>
<td class="nombre ventilation ">9,6</td>
</tr>
<tr class="">
<th class="ligne " scope="row">Moyen-Orient</th>
<td class="nombre ">5,0</td>
<td class="nombre ">6,3</td>
<td class="nombre ">7,8</td>
<td class="nombre ">5,3</td>
<td class="nombre ">4,6</td>
<td class="nombre ">10,1</td>
</tr>
<tr class="">
<th class="ligne ventilation " scope="row">&nbsp;&nbsp;&nbsp;&nbsp;dont Arabie saoudite</th>
<td class="nombre ventilation ">2,6</td>
<td class="nombre ventilation ">3,3</td>
<td class="nombre ventilation ">3,4</td>
<td class="nombre ventilation ">1,4</td>
<td class="nombre ventilation ">1,1</td>
<td class="nombre ventilation ">2,4</td>
</tr>
<tr class="">
<th class="ligne " scope="row">Autres</th>
<td class="nombre ">0,4</td>
<td class="nombre ">1,1</td>
<td class="nombre ">2,0</td>
<td class="nombre ">1,7</td>
<td class="nombre ">2,0</td>
<td class="nombre ">4,4</td>
</tr>
<tr class="">
<th class="ligne total " scope="row">Importations totales</th>
<td class="nombre total ">34,0</td>
<td class="nombre total ">41,2</td>
<td class="nombre total ">45,5</td>
<td class="nombre total ">44,6</td>
<td class="nombre total ">45,9</td>
<td class="nombre total ">100,0</td>
</tr>
<tr class="">
<th class="ligne ventilation " scope="row">&nbsp;&nbsp;&nbsp;&nbsp;dont Opep¹</th>
<td class="nombre ventilation ">16,6</td>
<td class="nombre ventilation ">17,0</td>
<td class="nombre ventilation ">22,3</td>
<td class="nombre ventilation ">18,3</td>
<td class="nombre ventilation ">19,0</td>
<td class="nombre ventilation ">41,4</td>
</tr>
</tbody>
</table>`;
