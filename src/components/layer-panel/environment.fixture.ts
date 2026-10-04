// src/components/layer-panel/environment.fixture.ts : jeux d'essai des vues, des coquilles et de la carte Environnement (spec
// 2026-10-04 environnement ; contrats § 3.3). Valeurs réelles du dimanche 4 octobre 2026, construites par le code du serveur
// (tâches 3 à 8) à partir des réponses enregistrées : carte et textes Météo-France de 10 h 00 (heure de Paris) et archive des
// 30 derniers jours ; tronçons Vigicrues et stations Hub'Eau (mesures postérieures à 10 h 10 retirées, séries de 48 h éclaircies
// à une mesure par demi-heure pour trois stations, deux heures pour les autres) ; détections FIRMS et météo des forêts du 03/10 ;
// manifeste et colonne radar de production ; communes autour du Porge (Gironde). Chaque export est une fonction qui rend une copie
// neuve : un test peut la modifier sans toucher les autres.
import type { FireImpactsResponse, FiresResponse, FloodsResponse, RadarColumnResult, VigilanceResponse } from '../../types/index.ts';
import type { Radar2dManifest } from '../../services/radar-2d.ts';

/** 4 octobre 2026, 10 h 10 à Paris (08:10Z) : heure des relevés de la spec. */
export const ENV_FIXTURE_NOW = Date.parse('2026-10-04T10:10:00+02:00');

const copy = <T>(v: T): T => structuredClone(v);

const VIGILANCE: VigilanceResponse = {
  "updateTime": "2026-10-04T08:00:12Z",
  "textsUpdateTime": "2026-10-04T08:00:12Z",
  "periods": [
    {
      "echeance": "J",
      "begin": "2026-10-04T08:00:00Z",
      "end": "2026-10-04T22:00:00Z",
      "maxColor": 3,
      "comment": "Un nouvel épisode pluvio-orageux actif est attendu sur les Pyrénées-orientales et l'Aude.",
      "departments": [{"code": "11", "name": "Aude", "color": 3, "phenomena": [{"id": "2", "color": 3, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T14:00:00Z", "color": 3}, {"from": "2026-10-04T14:00:00Z", "to": "2026-10-04T18:00:00Z", "color": 2}, {"from": "2026-10-04T18:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"id": "3", "color": 2, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T18:00:00Z", "color": 2}, {"from": "2026-10-04T18:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}]}, {"code": "66", "name": "Pyrénées-Orientales", "color": 3, "phenomena": [{"id": "2", "color": 3, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T14:00:00Z", "color": 3}, {"from": "2026-10-04T14:00:00Z", "to": "2026-10-04T16:00:00Z", "color": 2}, {"from": "2026-10-04T16:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"id": "3", "color": 2, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T16:00:00Z", "color": 2}, {"from": "2026-10-04T16:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"id": "4", "color": 2, "slots": []}]}, {"code": "13", "name": "Bouches-du-Rhône", "color": 2, "phenomena": [{"id": "3", "color": 2, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T17:00:00Z", "color": 1}, {"from": "2026-10-04T17:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 2}]}]}, {"code": "30", "name": "Gard", "color": 2, "phenomena": [{"id": "3", "color": 2, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T17:00:00Z", "color": 1}, {"from": "2026-10-04T17:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 2}]}]}, {"code": "65", "name": "Hautes-Pyrénées", "color": 2, "phenomena": [{"id": "3", "color": 2, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T12:00:00Z", "color": 1}, {"from": "2026-10-04T12:00:00Z", "to": "2026-10-04T18:00:00Z", "color": 2}, {"from": "2026-10-04T18:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}]}, {"code": "34", "name": "Hérault", "color": 2, "phenomena": [{"id": "2", "color": 2, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T09:00:00Z", "color": 1}, {"from": "2026-10-04T09:00:00Z", "to": "2026-10-04T16:00:00Z", "color": 2}, {"from": "2026-10-04T16:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"id": "3", "color": 2, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T09:00:00Z", "color": 1}, {"from": "2026-10-04T09:00:00Z", "to": "2026-10-04T20:00:00Z", "color": 2}, {"from": "2026-10-04T20:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}]}, {"code": "64", "name": "Pyrénées-Atlantiques", "color": 2, "phenomena": [{"id": "3", "color": 2, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T12:00:00Z", "color": 1}, {"from": "2026-10-04T12:00:00Z", "to": "2026-10-04T18:00:00Z", "color": 2}, {"from": "2026-10-04T18:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}]}],
      "greenDepartments": 89,
      "coast": [{"code": "0610", "departement": "06", "name": "Alpes-Maritimes, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "1110", "departement": "11", "name": "Aude, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "1310", "departement": "13", "name": "Bouches-du-Rhône, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "1410", "departement": "14", "name": "Calvados, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "1710", "departement": "17", "name": "Charente-Maritime, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "2210", "departement": "22", "name": "Côtes-d'Armor, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "2910", "departement": "29", "name": "Finistère, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "2A10", "departement": "2A", "name": "Corse-du-Sud, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "2B10", "departement": "2B", "name": "Haute-Corse, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "3010", "departement": "30", "name": "Gard, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "3310", "departement": "33", "name": "Gironde, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "3410", "departement": "34", "name": "Hérault, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "3510", "departement": "35", "name": "Ille-et-Vilaine, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "4010", "departement": "40", "name": "Landes, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "4410", "departement": "44", "name": "Loire-Atlantique, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "5010", "departement": "50", "name": "Manche, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "5610", "departement": "56", "name": "Morbihan, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "5910", "departement": "59", "name": "Nord, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "6210", "departement": "62", "name": "Pas-de-Calais, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "6410", "departement": "64", "name": "Pyrénées-Atlantiques, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "6610", "departement": "66", "name": "Pyrénées-Orientales, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "7610", "departement": "76", "name": "Seine-Maritime, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "8010", "departement": "80", "name": "Somme, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "8310", "departement": "83", "name": "Var, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}, {"code": "8510", "departement": "85", "name": "Vendée, littoral", "color": 1, "slots": [{"from": "2026-10-04T08:00:00Z", "to": "2026-10-04T22:00:00Z", "color": 1}]}],
      "counts": [{"color": 2, "count": 5}, {"color": 3, "count": 2}],
      "perPhenomenon": [{"id": "2", "anyColor": 3, "counts": [{"color": 2, "count": 1}, {"color": 3, "count": 2}]}, {"id": "3", "anyColor": 7, "counts": [{"color": 2, "count": 7}]}, {"id": "4", "anyColor": 1, "counts": [{"color": 2, "count": 1}]}]
    },
    {
      "echeance": "J1",
      "begin": "2026-10-04T22:00:00Z",
      "end": "2026-10-05T22:00:00Z",
      "maxColor": 2,
      "comment": null,
      "departments": [{"code": "11", "name": "Aude", "color": 2, "phenomena": [{"id": "2", "color": 2, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T02:00:00Z", "color": 1}, {"from": "2026-10-05T02:00:00Z", "to": "2026-10-05T11:00:00Z", "color": 2}, {"from": "2026-10-05T11:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"id": "3", "color": 2, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T02:00:00Z", "color": 1}, {"from": "2026-10-05T02:00:00Z", "to": "2026-10-05T11:00:00Z", "color": 2}, {"from": "2026-10-05T11:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}]}, {"code": "13", "name": "Bouches-du-Rhône", "color": 2, "phenomena": [{"id": "3", "color": 2, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T02:00:00Z", "color": 2}, {"from": "2026-10-05T02:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}]}, {"code": "2A", "name": "Corse-du-Sud", "color": 2, "phenomena": [{"id": "3", "color": 2, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T14:00:00Z", "color": 1}, {"from": "2026-10-05T14:00:00Z", "to": "2026-10-05T19:00:00Z", "color": 2}, {"from": "2026-10-05T19:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}]}, {"code": "30", "name": "Gard", "color": 2, "phenomena": [{"id": "3", "color": 2, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T02:00:00Z", "color": 2}, {"from": "2026-10-05T02:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}]}, {"code": "2B", "name": "Haute-Corse", "color": 2, "phenomena": [{"id": "3", "color": 2, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T14:00:00Z", "color": 1}, {"from": "2026-10-05T14:00:00Z", "to": "2026-10-05T19:00:00Z", "color": 2}, {"from": "2026-10-05T19:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}]}, {"code": "66", "name": "Pyrénées-Orientales", "color": 2, "phenomena": [{"id": "2", "color": 2, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T02:00:00Z", "color": 1}, {"from": "2026-10-05T02:00:00Z", "to": "2026-10-05T11:00:00Z", "color": 2}, {"from": "2026-10-05T11:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"id": "3", "color": 2, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T02:00:00Z", "color": 1}, {"from": "2026-10-05T02:00:00Z", "to": "2026-10-05T11:00:00Z", "color": 2}, {"from": "2026-10-05T11:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"id": "4", "color": 2, "slots": []}]}],
      "greenDepartments": 90,
      "coast": [{"code": "0610", "departement": "06", "name": "Alpes-Maritimes, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "1110", "departement": "11", "name": "Aude, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "1310", "departement": "13", "name": "Bouches-du-Rhône, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "1410", "departement": "14", "name": "Calvados, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "1710", "departement": "17", "name": "Charente-Maritime, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "2210", "departement": "22", "name": "Côtes-d'Armor, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "2910", "departement": "29", "name": "Finistère, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "2A10", "departement": "2A", "name": "Corse-du-Sud, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "2B10", "departement": "2B", "name": "Haute-Corse, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "3010", "departement": "30", "name": "Gard, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "3310", "departement": "33", "name": "Gironde, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "3410", "departement": "34", "name": "Hérault, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "3510", "departement": "35", "name": "Ille-et-Vilaine, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "4010", "departement": "40", "name": "Landes, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "4410", "departement": "44", "name": "Loire-Atlantique, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "5010", "departement": "50", "name": "Manche, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "5610", "departement": "56", "name": "Morbihan, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "5910", "departement": "59", "name": "Nord, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "6210", "departement": "62", "name": "Pas-de-Calais, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "6410", "departement": "64", "name": "Pyrénées-Atlantiques, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "6610", "departement": "66", "name": "Pyrénées-Orientales, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "7610", "departement": "76", "name": "Seine-Maritime, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "8010", "departement": "80", "name": "Somme, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "8310", "departement": "83", "name": "Var, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}, {"code": "8510", "departement": "85", "name": "Vendée, littoral", "color": 1, "slots": [{"from": "2026-10-04T22:00:00Z", "to": "2026-10-05T22:00:00Z", "color": 1}]}],
      "counts": [{"color": 2, "count": 6}],
      "perPhenomenon": [{"id": "2", "anyColor": 2, "counts": [{"color": 2, "count": 2}]}, {"id": "3", "anyColor": 6, "counts": [{"color": 2, "count": 6}]}, {"id": "4", "anyColor": 1, "counts": [{"color": 2, "count": 1}]}]
    }
  ],
  "bulletins": [
    {
      "scope": "national",
      "domainId": "FRA",
      "domainName": "France",
      "items": [{"kind": "situation", "phenomenon": null, "hazard": "tous aléas", "echeance": "J", "color": 3, "paragraphs": [{"heading": "Faits nouveaux", "text": ["Néant."]}, {"heading": "Situation générale", "text": ["Un nouveau système pluvio-orageux actif en provenance d'Espagne remonte sur le sud du Languedoc-Roussillon. Ces nouvelles remontées pluvieuses et orageuses vont durer jusqu'en fin de journée, engendrant de forts cumuls de pluie."]}]}, {"kind": "suivi", "phenomenon": "2", "hazard": "Pluie", "echeance": "J", "color": 3, "paragraphs": [{"heading": "Qualification", "text": ["Épisode pluvio-orageux nécessitant une attention particulière du fait de la possibilité de cumuls de précipitations importants sur de courtes périodes."]}, {"heading": "Observations notables", "text": ["Les premières précipitations se sont mises en place par le sud sur les Pyrénées Orientales et l'Aude. Les averses sont parfois accompagnées d'orages, notamment sur le littoral des Pyrénées Orientales.", "On relèves depuis le début des précipitations, 15 à 30 mm sur le Roussillon et les Corbières, localement jusqu'à 60 mm sur les Albères/la côte Vermeille."]}, {"heading": "Évolution prévue", "text": ["Le vaste système orageux qui concerne depuis samedi soir le nord-est de l'Espagne, remonte pour impacter les Pyrénées-Orientales et l'Aude. Des remontées pluvieuses se mettent en place et arrosent les deux départements tout au long de la journée avant de perdre en intensité en fin de journée.", "Au cours de cet épisode, on attend d'importantes intensités pluvieuses, de l'ordre de 50 à 80 mm en quelques heures. Sur l'ensemble de la journée, les cumuls pourraient atteindre 80 à 120 mm, notamment sur une large moitié est des deux départements, et des valeurs ponctuellement de l'ordre de 150 à 180 mm, préférentiellement dès les premiers reliefs (Corbières, Fenouillèdes, Albères...)"]}]}]
    },
    {
      "scope": "zonal",
      "domainId": "ZDF_NORD",
      "domainName": "Défense Nord",
      "items": []
    },
    {
      "scope": "zonal",
      "domainId": "ZDF_EST",
      "domainName": "Défense Est",
      "items": []
    },
    {
      "scope": "zonal",
      "domainId": "ZDF_OUEST",
      "domainName": "Défense Ouest",
      "items": []
    },
    {
      "scope": "zonal",
      "domainId": "ZDF_PARIS",
      "domainName": "Défense Paris",
      "items": []
    },
    {
      "scope": "zonal",
      "domainId": "ZDF_SUD",
      "domainName": "Défense Sud",
      "items": [{"kind": "situation", "phenomenon": null, "hazard": "tous aléas", "echeance": "J", "color": 3, "paragraphs": [{"heading": "Arc méditerranéen et/ou Corse", "text": []}, {"heading": "Faits nouveaux", "text": ["Néant."]}, {"heading": "Situation générale", "text": ["Remontées pluvieuses et orageuses qui concernent le sud du Languedoc Roussillon jusqu'en fin de journée au moins. Elles pourront être à l'origine de cumuls de pluie importants."]}]}, {"kind": "suivi", "phenomenon": "2", "hazard": "Pluie", "echeance": "J", "color": 3, "paragraphs": [{"heading": "Arc méditerranéen et/ou Corse", "text": []}, {"heading": "Qualification", "text": ["Épisode pluvio-orageux nécessitant une attention particulière du fait de la possibilité de cumuls importants en peu de temps."]}, {"heading": "Départements en Vigilance Orange Pluie", "text": ["Pyrénées-Orientales (66), Aude (11)"]}, {"heading": "Observations notables", "text": ["Les premières précipitations se sont mises en place par le sud sur les Pyrénées Orientales et l'Aude. Les averses sont parfois accompagnées d'orages, notamment sur le littoral des Pyrénées Orientales.", "On relèves depuis le début des précipitations, 15 à 30 mm sur le Roussillon et les Corbières, localement jusqu'à 60 mm sur les Albères/la côte Vermeille."]}, {"heading": "Évolution prévue", "text": ["Dès cette fin de nuit de samedi à dimanche, le système orageux qui a concerné ce samedi le nord-est de l'Espagne remonte et impacte les Pyrénées Orientales ainsi que l'Aude. Des remontées pluvieuses arrosent les deux départements tout au long de la journée avant de perdre en intensité en fin de journée. On attend des intensités de 10 à 20 mm/h temporairement 20 à 50 mm/h.", "Sur l'ensemble de la journée, les cumuls pourraient atteindre 80 à 120 mm, notamment sur une large moitié est des deux départements, et des valeurs ponctuellement de 150 à 180 mm, préférentiellement dès les premiers reliefs (Corbières, Fenouillèdes, Albères...)."]}]}]
    },
    {
      "scope": "zonal",
      "domainId": "ZDF_SUD_EST",
      "domainName": "Défense Sud-Est",
      "items": []
    },
    {
      "scope": "zonal",
      "domainId": "ZDF_SUD_OUEST",
      "domainName": "Défense Sud-Ouest",
      "items": []
    },
    {
      "scope": "departemental",
      "domainId": "11",
      "domainName": "Aude",
      "items": [{"kind": "situation", "phenomenon": null, "hazard": "tous aléas", "echeance": "J", "color": 3, "paragraphs": [{"heading": "Faits nouveaux", "text": ["Néant."]}, {"heading": "Situation générale", "text": ["Remontées pluvieuses et orageuses qui concernent le sud du Languedoc Roussillon jusqu'en fin de journée au moins. Elles pourront être à l'origine de cumuls de pluie importants."]}]}, {"kind": "suivi", "phenomenon": "2", "hazard": "Pluie", "echeance": "J", "color": 3, "paragraphs": [{"heading": "Qualification", "text": ["Épisode pluvio-orageux nécessitant une attention particulière du fait de la possibilité de cumuls importants en peu de temps."]}, {"heading": "Observations notables", "text": ["Les premières précipitations se sont mises en place par le sud sur les Pyrénées Orientales et l'Aude. Les averses sont parfois accompagnées d'orages, notamment sur le littoral des Pyrénées Orientales.", "On relèves depuis le début des précipitations, 15 à 30 mm sur le Roussillon et les Corbières, localement jusqu'à 60 mm sur les Albères/la côte Vermeille."]}, {"heading": "Évolution prévue", "text": ["Dès cette fin de nuit de samedi à dimanche, le système orageux qui a concerné ce samedi le nord-est de l'Espagne remonte et impacte les Pyrénées Orientales ainsi que l'Aude. Des remontées pluvieuses arrosent les deux départements tout au long de la journée avant de perdre en intensité en fin de journée. On attend des intensités de 10 à 20 mm/h temporairement 20 à 50 mm/h.", "Sur l'ensemble de la journée, les cumuls pourraient atteindre 80 à 120 mm, notamment sur une large moitié est des deux départements, et des valeurs ponctuellement de 150 à 180 mm, préférentiellement dès les premiers reliefs (Corbières, Fenouillèdes, Albères...)."]}]}]
    },
    {
      "scope": "departemental",
      "domainId": "66",
      "domainName": "Pyrénées-Orientales",
      "items": [{"kind": "situation", "phenomenon": null, "hazard": "tous aléas", "echeance": "J", "color": 3, "paragraphs": [{"heading": "Faits nouveaux", "text": ["Néant."]}, {"heading": "Situation générale", "text": ["Remontées pluvieuses et orageuses qui concernent le sud du Languedoc Roussillon jusqu'en fin de journée au moins. Elles pourront être à l'origine de cumuls de pluie importants."]}]}, {"kind": "suivi", "phenomenon": "2", "hazard": "Pluie", "echeance": "J", "color": 3, "paragraphs": [{"heading": "Qualification", "text": ["Épisode pluvio-orageux nécessitant une attention particulière du fait de la possibilité de cumuls importants en peu de temps."]}, {"heading": "Observations notables", "text": ["Les premières précipitations se sont mises en place par le sud sur les Pyrénées Orientales et l'Aude. Les averses sont parfois accompagnées d'orages, notamment sur le littoral des Pyrénées Orientales.", "On relèves depuis le début des précipitations, 15 à 30 mm sur le Roussillon et les Corbières, localement jusqu'à 60 mm sur les Albères/la côte Vermeille."]}, {"heading": "Évolution prévue", "text": ["Dès cette fin de nuit de samedi à dimanche, le système orageux qui a concerné ce samedi le nord-est de l'Espagne remonte et impacte les Pyrénées Orientales ainsi que l'Aude. Des remontées pluvieuses arrosent les deux départements tout au long de la journée avant de perdre en intensité en fin de journée. On attend des intensités de 10 à 20 mm/h temporairement 20 à 50 mm/h.", "Sur l'ensemble de la journée, les cumuls pourraient atteindre 80 à 120 mm, notamment sur une large moitié est des deux départements, et des valeurs ponctuellement de 150 à 180 mm, préférentiellement dès les premiers reliefs (Corbières, Fenouillèdes, Albères...)."]}]}]
    }
  ],
  "history": {
    "days": [
      {"date": "2026-09-05", "jaune": 10, "orange": 7, "rouge": 0, "publications": 2},
      {"date": "2026-09-06", "jaune": 34, "orange": 6, "rouge": 0, "publications": 3},
      {"date": "2026-09-07", "jaune": 24, "orange": 6, "rouge": 0, "publications": 2},
      {"date": "2026-09-08", "jaune": 48, "orange": 0, "rouge": 0, "publications": 3},
      {"date": "2026-09-09", "jaune": 16, "orange": 0, "rouge": 0, "publications": 3},
      {"date": "2026-09-10", "jaune": 7, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-11", "jaune": 0, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-12", "jaune": 1, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-13", "jaune": 9, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-14", "jaune": 0, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-15", "jaune": 0, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-16", "jaune": 6, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-17", "jaune": 1, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-18", "jaune": 4, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-19", "jaune": 2, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-20", "jaune": 0, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-21", "jaune": 0, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-22", "jaune": 0, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-23", "jaune": 0, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-24", "jaune": 0, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-25", "jaune": 0, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-26", "jaune": 0, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-27", "jaune": 0, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-28", "jaune": 26, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-09-29", "jaune": 6, "orange": 2, "rouge": 0, "publications": 4},
      {"date": "2026-09-30", "jaune": 63, "orange": 4, "rouge": 2, "publications": 7},
      {"date": "2026-10-01", "jaune": 16, "orange": 0, "rouge": 0, "publications": 3},
      {"date": "2026-10-02", "jaune": 10, "orange": 0, "rouge": 0, "publications": 2},
      {"date": "2026-10-03", "jaune": 18, "orange": 2, "rouge": 0, "publications": 5},
      {"date": "2026-10-04", "jaune": 5, "orange": 2, "rouge": 0, "publications": 2}
    ],
    "since": "2026-09-05"
  },
  "readAt": "2026-10-04T08:05:00Z",
  "errors": []
};

/** Vigilance du 04/10 à 10 h : J orange (66, 11), jaune (13, 30, 34, 64, 65) ; J1 jaune (66, 11, 13, 30, 2A, 2B) ; 25 domaines littoraux verts. */
export function VIGILANCE_FIXTURE(): VigilanceResponse { return copy(VIGILANCE); }

const FLOODS: FloodsResponse = {
  "readAt": "2026-10-04T08:05:00Z",
  "total": 337,
  "counts": {
    "vert": 333,
    "jaune": 4,
    "orange": 0,
    "rouge": 0
  },
  "sections": [
    {
      "id": "MO12",
      "name": "Têt",
      "level": 2,
      "territory": {"code": "21", "name": "Méditerranée Ouest", "url": "https://www.vigicrues.gouv.fr/territoire/21"},
      "path": [[[2.369602999999433, 42.58782099999868], [2.374479999998804, 42.595693999995774], [2.377472000004463, 42.597535999998115]]],
      "stations": [{"code": "Y046401001", "name": "Vinca", "lat": 42.657988931, "lon": 2.544186844, "lastAt": "2026-10-04T08:00:00Z", "heightM": 22.29, "flowM3s": null, "change1hM": 0.0, "heightSeries": [{"at": "2026-10-02T09:45:00Z", "value": 22.281}, {"at": "2026-10-02T10:15:00Z", "value": 22.281}, {"at": "2026-10-02T10:45:00Z", "value": 22.281}, {"at": "2026-10-02T11:15:00Z", "value": 22.281}, {"at": "2026-10-02T11:45:00Z", "value": 22.281}, {"at": "2026-10-02T12:15:00Z", "value": 22.28}, {"at": "2026-10-02T12:45:00Z", "value": 22.283}, {"at": "2026-10-02T13:15:00Z", "value": 22.281}, {"at": "2026-10-02T13:45:00Z", "value": 22.28}, {"at": "2026-10-02T14:15:00Z", "value": 22.28}, {"at": "2026-10-02T14:45:00Z", "value": 22.28}, {"at": "2026-10-02T15:15:00Z", "value": 22.281}, {"at": "2026-10-02T15:45:00Z", "value": 22.281}, {"at": "2026-10-02T16:15:00Z", "value": 22.281}, {"at": "2026-10-02T16:45:00Z", "value": 22.281}, {"at": "2026-10-02T17:15:00Z", "value": 22.281}, {"at": "2026-10-02T17:45:00Z", "value": 22.281}, {"at": "2026-10-02T18:15:00Z", "value": 22.281}, {"at": "2026-10-02T18:45:00Z", "value": 22.281}, {"at": "2026-10-02T19:15:00Z", "value": 22.281}, {"at": "2026-10-02T19:45:00Z", "value": 22.281}, {"at": "2026-10-02T20:15:00Z", "value": 22.281}, {"at": "2026-10-02T20:45:00Z", "value": 22.281}, {"at": "2026-10-02T21:15:00Z", "value": 22.281}, {"at": "2026-10-02T21:45:00Z", "value": 22.281}, {"at": "2026-10-02T22:15:00Z", "value": 22.281}, {"at": "2026-10-02T22:45:00Z", "value": 22.281}, {"at": "2026-10-02T23:15:00Z", "value": 22.281}, {"at": "2026-10-02T23:45:00Z", "value": 22.281}, {"at": "2026-10-03T00:15:00Z", "value": 22.281}, {"at": "2026-10-03T00:45:00Z", "value": 22.281}, {"at": "2026-10-03T01:15:00Z", "value": 22.281}, {"at": "2026-10-03T01:45:00Z", "value": 22.281}, {"at": "2026-10-03T02:15:00Z", "value": 22.281}, {"at": "2026-10-03T02:45:00Z", "value": 22.281}, {"at": "2026-10-03T03:15:00Z", "value": 22.281}, {"at": "2026-10-03T03:45:00Z", "value": 22.281}, {"at": "2026-10-03T04:15:00Z", "value": 22.281}, {"at": "2026-10-03T04:45:00Z", "value": 22.281}, {"at": "2026-10-03T05:15:00Z", "value": 22.281}, {"at": "2026-10-03T05:45:00Z", "value": 22.281}, {"at": "2026-10-03T06:15:00Z", "value": 22.281}, {"at": "2026-10-03T06:45:00Z", "value": 22.281}, {"at": "2026-10-03T07:15:00Z", "value": 22.281}, {"at": "2026-10-03T07:45:00Z", "value": 22.281}, {"at": "2026-10-03T08:15:00Z", "value": 22.281}, {"at": "2026-10-03T08:45:00Z", "value": 22.281}, {"at": "2026-10-03T09:15:00Z", "value": 22.281}, {"at": "2026-10-03T09:45:00Z", "value": 22.281}, {"at": "2026-10-03T10:15:00Z", "value": 22.281}, {"at": "2026-10-03T10:45:00Z", "value": 22.281}, {"at": "2026-10-03T11:15:00Z", "value": 22.28}, {"at": "2026-10-03T11:45:00Z", "value": 22.281}, {"at": "2026-10-03T12:15:00Z", "value": 22.28}, {"at": "2026-10-03T12:45:00Z", "value": 22.28}, {"at": "2026-10-03T13:15:00Z", "value": 22.28}, {"at": "2026-10-03T13:45:00Z", "value": 22.28}, {"at": "2026-10-03T14:15:00Z", "value": 22.281}, {"at": "2026-10-03T14:45:00Z", "value": 22.28}, {"at": "2026-10-03T15:15:00Z", "value": 22.281}, {"at": "2026-10-03T15:45:00Z", "value": 22.281}, {"at": "2026-10-03T16:15:00Z", "value": 22.281}, {"at": "2026-10-03T16:45:00Z", "value": 22.281}, {"at": "2026-10-03T17:15:00Z", "value": 22.281}, {"at": "2026-10-03T17:45:00Z", "value": 22.281}, {"at": "2026-10-03T18:15:00Z", "value": 22.281}, {"at": "2026-10-03T18:45:00Z", "value": 22.281}, {"at": "2026-10-03T19:15:00Z", "value": 22.281}, {"at": "2026-10-03T19:45:00Z", "value": 22.282}, {"at": "2026-10-03T20:15:00Z", "value": 22.282}, {"at": "2026-10-03T20:45:00Z", "value": 22.282}, {"at": "2026-10-03T21:30:00Z", "value": 22.282}, {"at": "2026-10-03T22:00:00Z", "value": 22.283}, {"at": "2026-10-03T22:30:00Z", "value": 22.283}, {"at": "2026-10-03T23:00:00Z", "value": 22.283}, {"at": "2026-10-03T23:30:00Z", "value": 22.284}, {"at": "2026-10-04T00:00:00Z", "value": 22.284}, {"at": "2026-10-04T00:30:00Z", "value": 22.284}, {"at": "2026-10-04T01:00:00Z", "value": 22.284}, {"at": "2026-10-04T01:30:00Z", "value": 22.285}, {"at": "2026-10-04T02:00:00Z", "value": 22.285}, {"at": "2026-10-04T02:30:00Z", "value": 22.286}, {"at": "2026-10-04T03:00:00Z", "value": 22.286}, {"at": "2026-10-04T03:30:00Z", "value": 22.286}, {"at": "2026-10-04T04:00:00Z", "value": 22.287}, {"at": "2026-10-04T04:30:00Z", "value": 22.287}, {"at": "2026-10-04T05:00:00Z", "value": 22.287}, {"at": "2026-10-04T05:30:00Z", "value": 22.288}, {"at": "2026-10-04T06:00:00Z", "value": 22.288}, {"at": "2026-10-04T06:30:00Z", "value": 22.289}, {"at": "2026-10-04T07:00:00Z", "value": 22.29}, {"at": "2026-10-04T07:30:00Z", "value": 22.29}, {"at": "2026-10-04T08:00:00Z", "value": 22.29}], "flowSeries": []}, {"code": "Y042401001", "name": "Serdinya", "lat": 42.56587183, "lon": 2.315815332, "lastAt": "2026-10-04T08:00:00Z", "heightM": 0.164, "flowM3s": 2.19, "change1hM": 0.012, "heightSeries": [{"at": "2026-10-02T09:45:00Z", "value": 0.276}, {"at": "2026-10-02T10:15:00Z", "value": 0.276}, {"at": "2026-10-02T10:45:00Z", "value": 0.292}, {"at": "2026-10-02T11:15:00Z", "value": 0.266}, {"at": "2026-10-02T11:45:00Z", "value": 0.283}, {"at": "2026-10-02T12:15:00Z", "value": 0.281}, {"at": "2026-10-02T12:45:00Z", "value": 0.309}, {"at": "2026-10-02T13:15:00Z", "value": 0.314}, {"at": "2026-10-02T13:45:00Z", "value": 0.321}, {"at": "2026-10-02T14:15:00Z", "value": 0.289}, {"at": "2026-10-02T14:45:00Z", "value": 0.301}, {"at": "2026-10-02T15:15:00Z", "value": 0.318}, {"at": "2026-10-02T15:45:00Z", "value": 0.312}, {"at": "2026-10-02T16:15:00Z", "value": 0.309}, {"at": "2026-10-02T16:45:00Z", "value": 0.293}, {"at": "2026-10-02T17:15:00Z", "value": 0.317}, {"at": "2026-10-02T17:45:00Z", "value": 0.3}, {"at": "2026-10-02T18:15:00Z", "value": 0.311}, {"at": "2026-10-02T18:45:00Z", "value": 0.288}, {"at": "2026-10-02T19:15:00Z", "value": 0.281}, {"at": "2026-10-02T19:45:00Z", "value": 0.305}, {"at": "2026-10-02T20:15:00Z", "value": 0.303}, {"at": "2026-10-02T20:45:00Z", "value": 0.287}, {"at": "2026-10-02T21:15:00Z", "value": 0.272}, {"at": "2026-10-02T21:45:00Z", "value": 0.309}, {"at": "2026-10-02T22:15:00Z", "value": 0.316}, {"at": "2026-10-02T22:45:00Z", "value": 0.305}, {"at": "2026-10-02T23:15:00Z", "value": 0.308}, {"at": "2026-10-02T23:45:00Z", "value": 0.314}, {"at": "2026-10-03T00:15:00Z", "value": 0.305}, {"at": "2026-10-03T00:45:00Z", "value": 0.277}, {"at": "2026-10-03T01:15:00Z", "value": 0.314}, {"at": "2026-10-03T01:45:00Z", "value": 0.309}, {"at": "2026-10-03T02:15:00Z", "value": 0.311}, {"at": "2026-10-03T02:45:00Z", "value": 0.302}, {"at": "2026-10-03T03:15:00Z", "value": 0.301}, {"at": "2026-10-03T03:45:00Z", "value": 0.263}, {"at": "2026-10-03T04:15:00Z", "value": 0.038}, {"at": "2026-10-03T04:45:00Z", "value": 0.06}, {"at": "2026-10-03T05:15:00Z", "value": 0.04}, {"at": "2026-10-03T05:45:00Z", "value": 0.017}, {"at": "2026-10-03T06:15:00Z", "value": 0.246}, {"at": "2026-10-03T06:45:00Z", "value": 0.316}, {"at": "2026-10-03T07:15:00Z", "value": 0.326}, {"at": "2026-10-03T07:45:00Z", "value": 0.462}, {"at": "2026-10-03T08:15:00Z", "value": 0.408}, {"at": "2026-10-03T08:45:00Z", "value": 0.343}, {"at": "2026-10-03T09:15:00Z", "value": 0.333}, {"at": "2026-10-03T09:45:00Z", "value": 0.275}, {"at": "2026-10-03T10:15:00Z", "value": 0.281}, {"at": "2026-10-03T10:45:00Z", "value": 0.278}, {"at": "2026-10-03T11:15:00Z", "value": 0.269}, {"at": "2026-10-03T11:45:00Z", "value": 0.276}, {"at": "2026-10-03T12:15:00Z", "value": 0.291}, {"at": "2026-10-03T12:45:00Z", "value": 0.296}, {"at": "2026-10-03T13:15:00Z", "value": 0.292}, {"at": "2026-10-03T13:45:00Z", "value": 0.257}, {"at": "2026-10-03T14:15:00Z", "value": 0.245}, {"at": "2026-10-03T14:45:00Z", "value": 0.283}, {"at": "2026-10-03T15:15:00Z", "value": 0.279}, {"at": "2026-10-03T15:45:00Z", "value": 0.288}, {"at": "2026-10-03T16:15:00Z", "value": 0.288}, {"at": "2026-10-03T16:45:00Z", "value": 0.298}, {"at": "2026-10-03T17:15:00Z", "value": 0.288}, {"at": "2026-10-03T17:45:00Z", "value": 0.286}, {"at": "2026-10-03T18:15:00Z", "value": 0.293}, {"at": "2026-10-03T18:45:00Z", "value": 0.294}, {"at": "2026-10-03T19:15:00Z", "value": 0.307}, {"at": "2026-10-03T19:45:00Z", "value": 0.305}, {"at": "2026-10-03T20:15:00Z", "value": 0.304}, {"at": "2026-10-03T20:45:00Z", "value": 0.307}, {"at": "2026-10-03T21:30:00Z", "value": 0.266}, {"at": "2026-10-03T22:00:00Z", "value": 0.303}, {"at": "2026-10-03T22:30:00Z", "value": 0.306}, {"at": "2026-10-03T23:00:00Z", "value": 0.282}, {"at": "2026-10-03T23:30:00Z", "value": 0.292}, {"at": "2026-10-04T00:00:00Z", "value": 0.269}, {"at": "2026-10-04T00:30:00Z", "value": 0.309}, {"at": "2026-10-04T01:00:00Z", "value": 0.255}, {"at": "2026-10-04T01:30:00Z", "value": 0.247}, {"at": "2026-10-04T02:00:00Z", "value": 0.228}, {"at": "2026-10-04T02:45:00Z", "value": 0.229}, {"at": "2026-10-04T03:15:00Z", "value": 0.215}, {"at": "2026-10-04T03:45:00Z", "value": 0.166}, {"at": "2026-10-04T04:15:00Z", "value": 0.176}, {"at": "2026-10-04T04:45:00Z", "value": 0.254}, {"at": "2026-10-04T05:15:00Z", "value": 0.11}, {"at": "2026-10-04T05:45:00Z", "value": 0.168}, {"at": "2026-10-04T06:15:00Z", "value": 0.149}, {"at": "2026-10-04T06:45:00Z", "value": 0.17}, {"at": "2026-10-04T07:15:00Z", "value": 0.165}, {"at": "2026-10-04T07:45:00Z", "value": 0.191}, {"at": "2026-10-04T08:00:00Z", "value": 0.164}], "flowSeries": [{"at": "2026-10-02T09:45:00Z", "value": 3.02}, {"at": "2026-10-02T10:15:00Z", "value": 3.02}, {"at": "2026-10-02T10:45:00Z", "value": 3.19}, {"at": "2026-10-02T11:15:00Z", "value": 2.92}, {"at": "2026-10-02T11:45:00Z", "value": 3.1}, {"at": "2026-10-02T12:15:00Z", "value": 3.07}, {"at": "2026-10-02T12:45:00Z", "value": 3.38}, {"at": "2026-10-02T13:15:00Z", "value": 3.44}, {"at": "2026-10-02T13:45:00Z", "value": 3.52}, {"at": "2026-10-02T14:15:00Z", "value": 3.16}, {"at": "2026-10-02T14:45:00Z", "value": 3.29}, {"at": "2026-10-02T15:15:00Z", "value": 3.49}, {"at": "2026-10-02T15:45:00Z", "value": 3.42}, {"at": "2026-10-02T16:15:00Z", "value": 3.38}, {"at": "2026-10-02T16:45:00Z", "value": 3.2}, {"at": "2026-10-02T17:15:00Z", "value": 3.48}, {"at": "2026-10-02T17:45:00Z", "value": 3.28}, {"at": "2026-10-02T18:15:00Z", "value": 3.41}, {"at": "2026-10-02T18:45:00Z", "value": 3.15}, {"at": "2026-10-02T19:15:00Z", "value": 3.07}, {"at": "2026-10-02T19:45:00Z", "value": 3.34}, {"at": "2026-10-02T20:15:00Z", "value": 3.31}, {"at": "2026-10-02T20:45:00Z", "value": 3.14}, {"at": "2026-10-02T21:15:00Z", "value": 2.98}, {"at": "2026-10-02T21:45:00Z", "value": 3.38}, {"at": "2026-10-02T22:15:00Z", "value": 3.46}, {"at": "2026-10-02T22:45:00Z", "value": 3.34}, {"at": "2026-10-02T23:15:00Z", "value": 3.37}, {"at": "2026-10-02T23:45:00Z", "value": 3.44}, {"at": "2026-10-03T00:15:00Z", "value": 3.34}, {"at": "2026-10-03T00:45:00Z", "value": 3.03}, {"at": "2026-10-03T01:15:00Z", "value": 3.44}, {"at": "2026-10-03T01:45:00Z", "value": 3.38}, {"at": "2026-10-03T02:15:00Z", "value": 3.41}, {"at": "2026-10-03T02:45:00Z", "value": 3.3}, {"at": "2026-10-03T03:15:00Z", "value": 3.29}, {"at": "2026-10-03T03:45:00Z", "value": 2.89}, {"at": "2026-10-03T04:15:00Z", "value": 1.51}, {"at": "2026-10-03T04:45:00Z", "value": 1.63}, {"at": "2026-10-03T05:15:00Z", "value": 1.52}, {"at": "2026-10-03T05:45:00Z", "value": 1.4}, {"at": "2026-10-03T06:15:00Z", "value": 2.72}, {"at": "2026-10-03T06:45:00Z", "value": 3.46}, {"at": "2026-10-03T07:15:00Z", "value": 3.58}, {"at": "2026-10-03T07:45:00Z", "value": 5.54}, {"at": "2026-10-03T08:15:00Z", "value": 4.68}, {"at": "2026-10-03T08:45:00Z", "value": 3.79}, {"at": "2026-10-03T09:15:00Z", "value": 3.67}, {"at": "2026-10-03T09:45:00Z", "value": 3.01}, {"at": "2026-10-03T10:15:00Z", "value": 3.07}, {"at": "2026-10-03T10:45:00Z", "value": 3.04}, {"at": "2026-10-03T11:15:00Z", "value": 2.95}, {"at": "2026-10-03T11:45:00Z", "value": 3.02}, {"at": "2026-10-03T12:15:00Z", "value": 3.18}, {"at": "2026-10-03T12:45:00Z", "value": 3.24}, {"at": "2026-10-03T13:15:00Z", "value": 3.19}, {"at": "2026-10-03T13:45:00Z", "value": 2.83}, {"at": "2026-10-03T14:15:00Z", "value": 2.71}, {"at": "2026-10-03T14:45:00Z", "value": 3.1}, {"at": "2026-10-03T15:15:00Z", "value": 3.05}, {"at": "2026-10-03T15:45:00Z", "value": 3.15}, {"at": "2026-10-03T16:15:00Z", "value": 3.15}, {"at": "2026-10-03T16:45:00Z", "value": 3.26}, {"at": "2026-10-03T17:15:00Z", "value": 3.15}, {"at": "2026-10-03T17:45:00Z", "value": 3.13}, {"at": "2026-10-03T18:15:00Z", "value": 3.2}, {"at": "2026-10-03T18:45:00Z", "value": 3.21}, {"at": "2026-10-03T19:15:00Z", "value": 3.36}, {"at": "2026-10-03T19:45:00Z", "value": 3.34}, {"at": "2026-10-03T20:15:00Z", "value": 3.33}, {"at": "2026-10-03T20:45:00Z", "value": 3.36}, {"at": "2026-10-03T21:30:00Z", "value": 2.92}, {"at": "2026-10-03T22:00:00Z", "value": 3.31}, {"at": "2026-10-03T22:30:00Z", "value": 3.35}, {"at": "2026-10-03T23:00:00Z", "value": 3.08}, {"at": "2026-10-03T23:30:00Z", "value": 3.19}, {"at": "2026-10-04T00:00:00Z", "value": 2.95}, {"at": "2026-10-04T00:30:00Z", "value": 3.38}, {"at": "2026-10-04T01:00:00Z", "value": 2.81}, {"at": "2026-10-04T01:30:00Z", "value": 2.73}, {"at": "2026-10-04T02:00:00Z", "value": 2.55}, {"at": "2026-10-04T02:45:00Z", "value": 2.56}, {"at": "2026-10-04T03:15:00Z", "value": 2.48}, {"at": "2026-10-04T03:45:00Z", "value": 2.21}, {"at": "2026-10-04T04:15:00Z", "value": 2.26}, {"at": "2026-10-04T04:45:00Z", "value": 2.8}, {"at": "2026-10-04T05:15:00Z", "value": 1.9}, {"at": "2026-10-04T05:45:00Z", "value": 2.22}, {"at": "2026-10-04T06:15:00Z", "value": 2.11}, {"at": "2026-10-04T06:45:00Z", "value": 2.23}, {"at": "2026-10-04T07:15:00Z", "value": 2.2}, {"at": "2026-10-04T07:45:00Z", "value": 2.35}, {"at": "2026-10-04T08:00:00Z", "value": 2.19}]}, {"code": "Y044501001", "name": "Catllar", "lat": 42.632397662, "lon": 2.422030898, "lastAt": "2026-10-04T08:00:00Z", "heightM": 1.736, "flowM3s": 0.079, "change1hM": 0.003, "heightSeries": [{"at": "2026-10-04T06:15:00Z", "value": 1.726}, {"at": "2026-10-04T06:30:00Z", "value": 1.727}, {"at": "2026-10-04T06:45:00Z", "value": 1.73}, {"at": "2026-10-04T07:00:00Z", "value": 1.733}, {"at": "2026-10-04T07:15:00Z", "value": 1.733}, {"at": "2026-10-04T07:30:00Z", "value": 1.734}, {"at": "2026-10-04T07:45:00Z", "value": 1.735}, {"at": "2026-10-04T08:00:00Z", "value": 1.736}], "flowSeries": [{"at": "2026-10-04T06:15:00Z", "value": 0.062}, {"at": "2026-10-04T06:30:00Z", "value": 0.063}, {"at": "2026-10-04T06:45:00Z", "value": 0.068}, {"at": "2026-10-04T07:00:00Z", "value": 0.073}, {"at": "2026-10-04T07:15:00Z", "value": 0.073}, {"at": "2026-10-04T07:30:00Z", "value": 0.075}, {"at": "2026-10-04T07:45:00Z", "value": 0.077}, {"at": "2026-10-04T08:00:00Z", "value": 0.079}]}]
    },
    {
      "id": "MO11",
      "name": "Agly",
      "level": 2,
      "territory": {"code": "21", "name": "Méditerranée Ouest", "url": "https://www.vigicrues.gouv.fr/territoire/21"},
      "path": [[[2.498566419805307, 42.81398009129761], [2.500576024093696, 42.812899668215124], [2.501548008470165, 42.81164072924995]], [[2.719000696767996, 42.77885390772763], [2.724199309082157, 42.77955343673931], [2.732666725721409, 42.776737699180906]]],
      "stations": [{"code": "Y062402001", "name": "St-Paul-de-Fenouillet", "lat": 42.799945613, "lon": 2.497396359, "lastAt": "2026-10-04T08:00:00Z", "heightM": 1.188, "flowM3s": 0.559, "change1hM": 0.096, "heightSeries": [{"at": "2026-10-04T06:15:00Z", "value": 1.044}, {"at": "2026-10-04T06:30:00Z", "value": 1.048}, {"at": "2026-10-04T06:45:00Z", "value": 1.064}, {"at": "2026-10-04T07:00:00Z", "value": 1.092}, {"at": "2026-10-04T07:15:00Z", "value": 1.121}, {"at": "2026-10-04T07:30:00Z", "value": 1.169}, {"at": "2026-10-04T07:45:00Z", "value": 1.195}, {"at": "2026-10-04T08:00:00Z", "value": 1.188}], "flowSeries": [{"at": "2026-10-04T06:15:00Z", "value": 0.391}, {"at": "2026-10-04T06:30:00Z", "value": 0.395}, {"at": "2026-10-04T06:45:00Z", "value": 0.411}, {"at": "2026-10-04T07:00:00Z", "value": 0.442}, {"at": "2026-10-04T07:15:00Z", "value": 0.475}, {"at": "2026-10-04T07:30:00Z", "value": 0.534}, {"at": "2026-10-04T07:45:00Z", "value": 0.568}, {"at": "2026-10-04T08:00:00Z", "value": 0.559}]}, {"code": "Y063402001", "name": "Barrage de Caramany", "lat": 42.743583217, "lon": 2.588189325, "lastAt": "2026-10-04T08:00:00Z", "heightM": 0.89, "flowM3s": null, "change1hM": 0.01, "heightSeries": [{"at": "2026-10-04T06:15:00Z", "value": 0.88}, {"at": "2026-10-04T06:30:00Z", "value": 0.88}, {"at": "2026-10-04T06:45:00Z", "value": 0.88}, {"at": "2026-10-04T07:00:00Z", "value": 0.88}, {"at": "2026-10-04T07:15:00Z", "value": 0.89}, {"at": "2026-10-04T07:30:00Z", "value": 0.89}, {"at": "2026-10-04T07:45:00Z", "value": 0.89}, {"at": "2026-10-04T08:00:00Z", "value": 0.89}], "flowSeries": []}]
    },
    {
      "id": "MO16",
      "name": "Réart",
      "level": 2,
      "territory": {"code": "21", "name": "Méditerranée Ouest", "url": "https://www.vigicrues.gouv.fr/territoire/21"},
      "path": [[[2.829775665907757, 42.59618070610693], [2.835356590264669, 42.59811307541971], [2.843494644383464, 42.594707073395156]], [[2.737398253049479, 42.60116754442601], [2.739504224806967, 42.60124910051734], [2.744393105364377, 42.603304676900976]]],
      "stations": [{"code": "Y033400101", "name": "Saleilles", "lat": 42.653230994, "lon": 2.926916199, "lastAt": "2026-10-04T08:00:00Z", "heightM": 2.024, "flowM3s": 0, "change1hM": 0.003, "heightSeries": [{"at": "2026-10-02T09:45:00Z", "value": 1.923}, {"at": "2026-10-02T10:15:00Z", "value": 1.923}, {"at": "2026-10-02T10:45:00Z", "value": 1.923}, {"at": "2026-10-02T11:15:00Z", "value": 1.922}, {"at": "2026-10-02T11:45:00Z", "value": 1.923}, {"at": "2026-10-02T12:15:00Z", "value": 1.922}, {"at": "2026-10-02T12:45:00Z", "value": 1.922}, {"at": "2026-10-02T13:15:00Z", "value": 1.923}, {"at": "2026-10-02T13:45:00Z", "value": 1.922}, {"at": "2026-10-02T14:15:00Z", "value": 1.923}, {"at": "2026-10-02T14:45:00Z", "value": 1.923}, {"at": "2026-10-02T15:15:00Z", "value": 1.921}, {"at": "2026-10-02T15:45:00Z", "value": 1.922}, {"at": "2026-10-02T16:15:00Z", "value": 1.923}, {"at": "2026-10-02T16:45:00Z", "value": 1.921}, {"at": "2026-10-02T17:15:00Z", "value": 1.921}, {"at": "2026-10-02T17:45:00Z", "value": 1.922}, {"at": "2026-10-02T18:15:00Z", "value": 1.922}, {"at": "2026-10-02T18:45:00Z", "value": 1.923}, {"at": "2026-10-02T19:15:00Z", "value": 1.923}, {"at": "2026-10-02T19:45:00Z", "value": 1.923}, {"at": "2026-10-02T20:15:00Z", "value": 1.922}, {"at": "2026-10-02T20:45:00Z", "value": 1.923}, {"at": "2026-10-02T21:15:00Z", "value": 1.921}, {"at": "2026-10-02T21:45:00Z", "value": 1.922}, {"at": "2026-10-02T22:15:00Z", "value": 1.923}, {"at": "2026-10-02T22:45:00Z", "value": 1.922}, {"at": "2026-10-02T23:15:00Z", "value": 1.923}, {"at": "2026-10-02T23:45:00Z", "value": 1.922}, {"at": "2026-10-03T00:15:00Z", "value": 1.923}, {"at": "2026-10-03T00:45:00Z", "value": 1.922}, {"at": "2026-10-03T01:15:00Z", "value": 1.923}, {"at": "2026-10-03T01:45:00Z", "value": 1.923}, {"at": "2026-10-03T02:15:00Z", "value": 1.922}, {"at": "2026-10-03T02:45:00Z", "value": 1.921}, {"at": "2026-10-03T03:15:00Z", "value": 1.923}, {"at": "2026-10-03T03:45:00Z", "value": 1.921}, {"at": "2026-10-03T04:15:00Z", "value": 1.923}, {"at": "2026-10-03T04:45:00Z", "value": 1.923}, {"at": "2026-10-03T05:15:00Z", "value": 1.923}, {"at": "2026-10-03T05:45:00Z", "value": 1.922}, {"at": "2026-10-03T06:15:00Z", "value": 1.923}, {"at": "2026-10-03T06:45:00Z", "value": 1.923}, {"at": "2026-10-03T07:15:00Z", "value": 1.923}, {"at": "2026-10-03T07:45:00Z", "value": 1.923}, {"at": "2026-10-03T08:15:00Z", "value": 1.924}, {"at": "2026-10-03T08:45:00Z", "value": 1.925}, {"at": "2026-10-03T09:15:00Z", "value": 1.923}, {"at": "2026-10-03T09:45:00Z", "value": 1.923}, {"at": "2026-10-03T10:15:00Z", "value": 1.923}, {"at": "2026-10-03T10:45:00Z", "value": 1.923}, {"at": "2026-10-03T11:15:00Z", "value": 1.924}, {"at": "2026-10-03T11:45:00Z", "value": 1.922}, {"at": "2026-10-03T12:15:00Z", "value": 1.923}, {"at": "2026-10-03T12:45:00Z", "value": 1.923}, {"at": "2026-10-03T13:15:00Z", "value": 1.922}, {"at": "2026-10-03T13:45:00Z", "value": 1.923}, {"at": "2026-10-03T14:15:00Z", "value": 1.923}, {"at": "2026-10-03T14:45:00Z", "value": 1.921}, {"at": "2026-10-03T15:15:00Z", "value": 1.922}, {"at": "2026-10-03T15:45:00Z", "value": 1.923}, {"at": "2026-10-03T16:15:00Z", "value": 1.922}, {"at": "2026-10-03T16:45:00Z", "value": 1.923}, {"at": "2026-10-03T17:15:00Z", "value": 1.922}, {"at": "2026-10-03T17:45:00Z", "value": 1.921}, {"at": "2026-10-03T18:15:00Z", "value": 1.923}, {"at": "2026-10-03T18:45:00Z", "value": 1.922}, {"at": "2026-10-03T19:15:00Z", "value": 1.923}, {"at": "2026-10-03T19:45:00Z", "value": 1.923}, {"at": "2026-10-03T20:15:00Z", "value": 1.922}, {"at": "2026-10-03T20:45:00Z", "value": 1.922}, {"at": "2026-10-03T21:30:00Z", "value": 1.923}, {"at": "2026-10-03T22:00:00Z", "value": 1.923}, {"at": "2026-10-03T22:30:00Z", "value": 1.923}, {"at": "2026-10-03T23:00:00Z", "value": 1.922}, {"at": "2026-10-03T23:30:00Z", "value": 1.922}, {"at": "2026-10-04T00:00:00Z", "value": 1.921}, {"at": "2026-10-04T00:30:00Z", "value": 1.922}, {"at": "2026-10-04T01:00:00Z", "value": 1.922}, {"at": "2026-10-04T01:30:00Z", "value": 1.923}, {"at": "2026-10-04T02:00:00Z", "value": 1.921}, {"at": "2026-10-04T02:45:00Z", "value": 1.923}, {"at": "2026-10-04T03:15:00Z", "value": 1.921}, {"at": "2026-10-04T03:45:00Z", "value": 1.921}, {"at": "2026-10-04T04:15:00Z", "value": 1.923}, {"at": "2026-10-04T04:45:00Z", "value": 1.922}, {"at": "2026-10-04T05:15:00Z", "value": 1.922}, {"at": "2026-10-04T05:45:00Z", "value": 1.923}, {"at": "2026-10-04T06:15:00Z", "value": 2.031}, {"at": "2026-10-04T06:45:00Z", "value": 2.029}, {"at": "2026-10-04T07:15:00Z", "value": 2.007}, {"at": "2026-10-04T07:45:00Z", "value": 2.003}, {"at": "2026-10-04T08:00:00Z", "value": 2.024}], "flowSeries": [{"at": "2026-10-04T06:00:00Z", "value": 0}, {"at": "2026-10-04T06:30:00Z", "value": 0}, {"at": "2026-10-04T07:00:00Z", "value": 0}, {"at": "2026-10-04T07:30:00Z", "value": 0}, {"at": "2026-10-04T08:00:00Z", "value": 0}]}, {"code": "Y031502001", "name": "Villemolaque", "lat": 42.596145655, "lon": 2.829785482, "lastAt": "2026-10-04T08:00:00Z", "heightM": 2.148, "flowM3s": 0.011, "change1hM": 0.005, "heightSeries": [{"at": "2026-10-04T06:15:00Z", "value": 2.122}, {"at": "2026-10-04T06:30:00Z", "value": 2.135}, {"at": "2026-10-04T06:45:00Z", "value": 2.121}, {"at": "2026-10-04T07:00:00Z", "value": 2.143}, {"at": "2026-10-04T07:15:00Z", "value": 2.12}, {"at": "2026-10-04T07:30:00Z", "value": 2.217}, {"at": "2026-10-04T07:45:00Z", "value": 2.154}, {"at": "2026-10-04T08:00:00Z", "value": 2.148}], "flowSeries": [{"at": "2026-10-04T06:15:00Z", "value": 0.004}, {"at": "2026-10-04T06:30:00Z", "value": 0.008}, {"at": "2026-10-04T06:45:00Z", "value": 0.004}, {"at": "2026-10-04T07:00:00Z", "value": 0.01}, {"at": "2026-10-04T07:15:00Z", "value": 0.004}, {"at": "2026-10-04T07:30:00Z", "value": 0.08}, {"at": "2026-10-04T07:45:00Z", "value": 0.013}, {"at": "2026-10-04T08:00:00Z", "value": 0.011}]}]
    },
    {
      "id": "MO17",
      "name": "Tech",
      "level": 2,
      "territory": {"code": "21", "name": "Méditerranée Ouest", "url": "https://www.vigicrues.gouv.fr/territoire/21"},
      "path": [[[2.403630000000367, 42.40694999999895], [2.406065999996892, 42.4077539999982], [2.407214, 42.40546399999728]]],
      "stations": [{"code": "Y026401001", "name": "Céret [Pont du diable]", "lat": 42.495390867, "lon": 2.74389142, "lastAt": "2026-10-04T08:00:00Z", "heightM": 4.225, "flowM3s": null, "change1hM": -0.004, "heightSeries": [{"at": "2026-10-04T06:15:00Z", "value": 4.214}, {"at": "2026-10-04T06:30:00Z", "value": 4.223}, {"at": "2026-10-04T06:45:00Z", "value": 4.227}, {"at": "2026-10-04T07:00:00Z", "value": 4.229}, {"at": "2026-10-04T07:15:00Z", "value": 4.229}, {"at": "2026-10-04T07:30:00Z", "value": 4.225}, {"at": "2026-10-04T07:45:00Z", "value": 4.229}, {"at": "2026-10-04T08:00:00Z", "value": 4.225}], "flowSeries": []}, {"code": "Y011541001", "name": "Mas-d'en-Tourens", "lat": 42.525644133, "lon": 2.985740441, "lastAt": "2026-10-04T08:00:00Z", "heightM": 0.797, "flowM3s": 6.98, "change1hM": -0.248, "heightSeries": [{"at": "2026-10-04T06:15:00Z", "value": 0.653}, {"at": "2026-10-04T06:30:00Z", "value": 1.131}, {"at": "2026-10-04T06:45:00Z", "value": 1.236}, {"at": "2026-10-04T07:00:00Z", "value": 1.045}, {"at": "2026-10-04T07:15:00Z", "value": 0.928}, {"at": "2026-10-04T07:30:00Z", "value": 0.877}, {"at": "2026-10-04T07:45:00Z", "value": 0.829}, {"at": "2026-10-04T08:00:00Z", "value": 0.797}], "flowSeries": [{"at": "2026-10-04T06:15:00Z", "value": 4.46}, {"at": "2026-10-04T06:30:00Z", "value": 15.2}, {"at": "2026-10-04T06:45:00Z", "value": 19.3}, {"at": "2026-10-04T07:00:00Z", "value": 12.2}, {"at": "2026-10-04T07:15:00Z", "value": 9.58}, {"at": "2026-10-04T07:30:00Z", "value": 8.53}, {"at": "2026-10-04T07:45:00Z", "value": 7.59}, {"at": "2026-10-04T08:00:00Z", "value": 6.98}]}]
    }
  ],
  "stationsReadAt": "2026-10-04T08:05:00Z",
  "stationsOmitted": 0,
  "errors": []
};

/** Crues du 04/10 : 337 tronçons, 4 jaunes de Méditerranée Ouest (Têt, Agly, Réart, Tech), deux ou trois stations par tronçon. */
export function FLOODS_FIXTURE(): FloodsResponse { return copy(FLOODS); }

const FIRES: FiresResponse = {
  "readAt": "2026-10-04T08:10:00.000Z",
  "lastAcquisitionAt": "2026-10-04T03:34:00.000Z",
  "sources": [
    {
      "id": "VIIRS_SNPP_NRT",
      "ok": true,
      "lastAcquisitionAt": "2026-10-04T03:00:00.000Z"
    },
    {
      "id": "VIIRS_NOAA20_NRT",
      "ok": true,
      "lastAcquisitionAt": "2026-10-04T03:19:00.000Z"
    },
    {
      "id": "VIIRS_NOAA21_NRT",
      "ok": true,
      "lastAcquisitionAt": "2026-10-04T02:24:00.000Z"
    },
    {
      "id": "MODIS_NRT",
      "ok": true,
      "lastAcquisitionAt": "2026-10-04T03:34:00.000Z"
    }
  ],
  "detections": [
    {
      "id": "48.5595_-1.7780_2026-10-04_0319_NOAA-20",
      "lat": 48.55947,
      "lon": -1.77802,
      "acquiredAt": "2026-10-04T03:19:00.000Z",
      "satellite": "NOAA-20",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 0.84,
      "daynight": "N",
      "dept": "35",
      "recurrent": false,
      "foyerId": "48.5627_-1.7717_2026-10-04_0300_Suomi NPP"
    },
    {
      "id": "48.5627_-1.7717_2026-10-04_0300_Suomi NPP",
      "lat": 48.56269,
      "lon": -1.77171,
      "acquiredAt": "2026-10-04T03:00:00.000Z",
      "satellite": "Suomi NPP",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 1.27,
      "daynight": "N",
      "dept": "35",
      "recurrent": false,
      "foyerId": "48.5627_-1.7717_2026-10-04_0300_Suomi NPP"
    },
    {
      "id": "48.5640_-1.7773_2026-10-04_0300_Suomi NPP",
      "lat": 48.56403,
      "lon": -1.77729,
      "acquiredAt": "2026-10-04T03:00:00.000Z",
      "satellite": "Suomi NPP",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 1.8,
      "daynight": "N",
      "dept": "35",
      "recurrent": false,
      "foyerId": "48.5627_-1.7717_2026-10-04_0300_Suomi NPP"
    },
    {
      "id": "43.7949_7.3735_2026-10-04_0141_NOAA-20",
      "lat": 43.79491,
      "lon": 7.37353,
      "acquiredAt": "2026-10-04T01:41:00.000Z",
      "satellite": "NOAA-20",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 1.56,
      "daynight": "N",
      "dept": "06",
      "recurrent": false,
      "foyerId": "43.7936_7.3711_2026-10-04_0120_Suomi NPP"
    },
    {
      "id": "43.7936_7.3711_2026-10-04_0120_Suomi NPP",
      "lat": 43.79365,
      "lon": 7.37111,
      "acquiredAt": "2026-10-04T01:20:00.000Z",
      "satellite": "Suomi NPP",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 1.02,
      "daynight": "N",
      "dept": "06",
      "recurrent": false,
      "foyerId": "43.7936_7.3711_2026-10-04_0120_Suomi NPP"
    },
    {
      "id": "48.7698_4.5651_2026-10-04_0300_Suomi NPP",
      "lat": 48.76982,
      "lon": 4.56506,
      "acquiredAt": "2026-10-04T03:00:00.000Z",
      "satellite": "Suomi NPP",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 0.55,
      "daynight": "N",
      "dept": "51",
      "recurrent": false,
      "foyerId": "48.7661_4.5640_2026-10-04_0221_NOAA-21"
    },
    {
      "id": "48.7661_4.5640_2026-10-04_0221_NOAA-21",
      "lat": 48.76607,
      "lon": 4.564,
      "acquiredAt": "2026-10-04T02:21:00.000Z",
      "satellite": "NOAA-21",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 0.69,
      "daynight": "N",
      "dept": "51",
      "recurrent": false,
      "foyerId": "48.7661_4.5640_2026-10-04_0221_NOAA-21"
    },
    {
      "id": "47.6096_4.0124_2026-10-03_1227_NOAA-21",
      "lat": 47.60958,
      "lon": 4.01242,
      "acquiredAt": "2026-10-03T12:27:00.000Z",
      "satellite": "NOAA-21",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 11.67,
      "daynight": "D",
      "dept": "89",
      "recurrent": false,
      "foyerId": "47.6096_4.0124_2026-10-03_1227_NOAA-21"
    },
    {
      "id": "46.8301_3.5995_2026-10-03_1227_NOAA-21",
      "lat": 46.8301,
      "lon": 3.59947,
      "acquiredAt": "2026-10-03T12:27:00.000Z",
      "satellite": "NOAA-21",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 3.77,
      "daynight": "D",
      "dept": "58",
      "recurrent": false,
      "foyerId": "46.8301_3.5995_2026-10-03_1227_NOAA-21"
    },
    {
      "id": "46.8334_3.5983_2026-10-03_1227_NOAA-21",
      "lat": 46.83337,
      "lon": 3.59833,
      "acquiredAt": "2026-10-03T12:27:00.000Z",
      "satellite": "NOAA-21",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 5.72,
      "daynight": "D",
      "dept": "58",
      "recurrent": false,
      "foyerId": "46.8301_3.5995_2026-10-03_1227_NOAA-21"
    },
    {
      "id": "46.6744_2.6304_2026-10-03_1227_NOAA-21",
      "lat": 46.67444,
      "lon": 2.63039,
      "acquiredAt": "2026-10-03T12:27:00.000Z",
      "satellite": "NOAA-21",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 4.6,
      "daynight": "D",
      "dept": "18",
      "recurrent": false,
      "foyerId": "46.6744_2.6304_2026-10-03_1227_NOAA-21"
    },
    {
      "id": "46.6778_2.6292_2026-10-03_1227_NOAA-21",
      "lat": 46.67775,
      "lon": 2.62917,
      "acquiredAt": "2026-10-03T12:27:00.000Z",
      "satellite": "NOAA-21",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 4.6,
      "daynight": "D",
      "dept": "03",
      "recurrent": false,
      "foyerId": "46.6744_2.6304_2026-10-03_1227_NOAA-21"
    },
    {
      "id": "48.7253_5.3664_2026-10-03_1401_Aqua",
      "lat": 48.72532,
      "lon": 5.36637,
      "acquiredAt": "2026-10-03T14:01:00.000Z",
      "satellite": "Aqua",
      "sensor": "MODIS",
      "confidence": "faible",
      "confidenceRaw": "0",
      "frpMw": 7.45,
      "daynight": "D",
      "dept": "55",
      "recurrent": false,
      "foyerId": "48.7253_5.3664_2026-10-03_1401_Aqua"
    },
    {
      "id": "46.0926_3.1344_2026-10-03_1227_NOAA-21",
      "lat": 46.09255,
      "lon": 3.13442,
      "acquiredAt": "2026-10-03T12:27:00.000Z",
      "satellite": "NOAA-21",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 3.23,
      "daynight": "D",
      "dept": "03",
      "recurrent": false,
      "foyerId": "46.0926_3.1344_2026-10-03_1227_NOAA-21"
    },
    {
      "id": "46.0958_3.1332_2026-10-03_1227_NOAA-21",
      "lat": 46.09584,
      "lon": 3.13324,
      "acquiredAt": "2026-10-03T12:27:00.000Z",
      "satellite": "NOAA-21",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 3.23,
      "daynight": "D",
      "dept": "03",
      "recurrent": false,
      "foyerId": "46.0926_3.1344_2026-10-03_1227_NOAA-21"
    },
    {
      "id": "51.0278_2.2661_2026-10-04_0317_NOAA-20",
      "lat": 51.02777,
      "lon": 2.26614,
      "acquiredAt": "2026-10-04T03:17:00.000Z",
      "satellite": "NOAA-20",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 1.92,
      "daynight": "N",
      "dept": "59",
      "recurrent": true,
      "foyerId": "51.0467_2.2980_2026-10-03_1229_NOAA-21"
    },
    {
      "id": "51.0309_2.2769_2026-10-04_0317_NOAA-20",
      "lat": 51.03094,
      "lon": 2.27693,
      "acquiredAt": "2026-10-04T03:17:00.000Z",
      "satellite": "NOAA-20",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 1.92,
      "daynight": "N",
      "dept": "59",
      "recurrent": true,
      "foyerId": "51.0467_2.2980_2026-10-03_1229_NOAA-21"
    },
    {
      "id": "51.0444_2.2899_2026-10-04_0317_NOAA-20",
      "lat": 51.04436,
      "lon": 2.28993,
      "acquiredAt": "2026-10-04T03:17:00.000Z",
      "satellite": "NOAA-20",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 1.57,
      "daynight": "N",
      "dept": "59",
      "recurrent": true,
      "foyerId": "51.0467_2.2980_2026-10-03_1229_NOAA-21"
    },
    {
      "id": "43.4337_4.8959_2026-10-04_0300_Suomi NPP",
      "lat": 43.43371,
      "lon": 4.89587,
      "acquiredAt": "2026-10-04T03:00:00.000Z",
      "satellite": "Suomi NPP",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 1.89,
      "daynight": "N",
      "dept": "13",
      "recurrent": true,
      "foyerId": "43.4337_4.8919_2026-10-04_0043_NOAA-21"
    },
    {
      "id": "43.4337_4.8978_2026-10-04_0300_Suomi NPP",
      "lat": 43.43367,
      "lon": 4.89778,
      "acquiredAt": "2026-10-04T03:00:00.000Z",
      "satellite": "Suomi NPP",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 1.53,
      "daynight": "N",
      "dept": "13",
      "recurrent": true,
      "foyerId": "43.4337_4.8919_2026-10-04_0043_NOAA-21"
    },
    {
      "id": "43.4360_4.8890_2026-10-04_0300_Suomi NPP",
      "lat": 43.43602,
      "lon": 4.889,
      "acquiredAt": "2026-10-04T03:00:00.000Z",
      "satellite": "Suomi NPP",
      "sensor": "VIIRS",
      "confidence": "nominale",
      "confidenceRaw": "n",
      "frpMw": 2.94,
      "daynight": "N",
      "dept": "13",
      "recurrent": true,
      "foyerId": "43.4337_4.8919_2026-10-04_0043_NOAA-21"
    }
  ],
  "abroadCount": 158,
  "abroad": [
    {
      "lat": 49.96453,
      "lon": 7.23617,
      "acquiredAt": "2026-10-03T14:01:00.000Z",
      "frpMw": 54.31,
      "satellite": "Aqua"
    },
    {
      "lat": 50.96543,
      "lon": 6.27543,
      "acquiredAt": "2026-10-03T14:01:00.000Z",
      "frpMw": 19.3,
      "satellite": "Aqua"
    },
    {
      "lat": 50.97084,
      "lon": 6.29899,
      "acquiredAt": "2026-10-03T14:01:00.000Z",
      "frpMw": 12.74,
      "satellite": "Aqua"
    },
    {
      "lat": 51.42646,
      "lon": 6.73949,
      "acquiredAt": "2026-10-03T12:27:00.000Z",
      "frpMw": 12.14,
      "satellite": "NOAA-21"
    },
    {
      "lat": 49.78854,
      "lon": 9.10031,
      "acquiredAt": "2026-10-03T14:01:00.000Z",
      "frpMw": 11.88,
      "satellite": "Aqua"
    },
    {
      "lat": 51.34546,
      "lon": 6.45895,
      "acquiredAt": "2026-10-03T14:01:00.000Z",
      "frpMw": 10.8,
      "satellite": "Aqua"
    },
    {
      "lat": 45.14902,
      "lon": 9.94109,
      "acquiredAt": "2026-10-04T03:34:00.000Z",
      "frpMw": 10.76,
      "satellite": "Aqua"
    },
    {
      "lat": 51.1676,
      "lon": 3.81388,
      "acquiredAt": "2026-10-04T01:39:00.000Z",
      "frpMw": 10.2,
      "satellite": "NOAA-20"
    }
  ],
  "foyers": [
    {
      "id": "48.5627_-1.7717_2026-10-04_0300_Suomi NPP",
      "dept": "35",
      "depts": ["35"],
      "lat": 48.56262,
      "lon": -1.77563,
      "detections": 3,
      "passes": 2,
      "confirmed": true,
      "recurrent": false,
      "frpTotalMw": 3.91,
      "frpMaxMw": 1.8,
      "firstAt": "2026-10-04T03:00:00.000Z",
      "lastAt": "2026-10-04T03:19:00.000Z",
      "satellites": ["Suomi NPP", "NOAA-20"],
      "confidenceMax": "nominale",
      "nightDetections": 3
    },
    {
      "id": "43.7936_7.3711_2026-10-04_0120_Suomi NPP",
      "dept": "06",
      "depts": ["06"],
      "lat": 43.79441,
      "lon": 7.37257,
      "detections": 2,
      "passes": 2,
      "confirmed": true,
      "recurrent": false,
      "frpTotalMw": 2.58,
      "frpMaxMw": 1.56,
      "firstAt": "2026-10-04T01:20:00.000Z",
      "lastAt": "2026-10-04T01:41:00.000Z",
      "satellites": ["Suomi NPP", "NOAA-20"],
      "confidenceMax": "nominale",
      "nightDetections": 2
    },
    {
      "id": "48.7661_4.5640_2026-10-04_0221_NOAA-21",
      "dept": "51",
      "depts": ["51"],
      "lat": 48.76773,
      "lon": 4.56447,
      "detections": 2,
      "passes": 2,
      "confirmed": true,
      "recurrent": false,
      "frpTotalMw": 1.24,
      "frpMaxMw": 0.69,
      "firstAt": "2026-10-04T02:21:00.000Z",
      "lastAt": "2026-10-04T03:00:00.000Z",
      "satellites": ["Suomi NPP", "NOAA-21"],
      "confidenceMax": "nominale",
      "nightDetections": 2
    },
    {
      "id": "47.6096_4.0124_2026-10-03_1227_NOAA-21",
      "dept": "89",
      "depts": ["89"],
      "lat": 47.60958,
      "lon": 4.01242,
      "detections": 1,
      "passes": 1,
      "confirmed": false,
      "recurrent": false,
      "frpTotalMw": 11.67,
      "frpMaxMw": 11.67,
      "firstAt": "2026-10-03T12:27:00.000Z",
      "lastAt": "2026-10-03T12:27:00.000Z",
      "satellites": ["NOAA-21"],
      "confidenceMax": "nominale",
      "nightDetections": 0
    },
    {
      "id": "46.8301_3.5995_2026-10-03_1227_NOAA-21",
      "dept": "58",
      "depts": ["58"],
      "lat": 46.83207,
      "lon": 3.59878,
      "detections": 2,
      "passes": 1,
      "confirmed": false,
      "recurrent": false,
      "frpTotalMw": 9.49,
      "frpMaxMw": 5.72,
      "firstAt": "2026-10-03T12:27:00.000Z",
      "lastAt": "2026-10-03T12:27:00.000Z",
      "satellites": ["NOAA-21"],
      "confidenceMax": "nominale",
      "nightDetections": 0
    },
    {
      "id": "46.6744_2.6304_2026-10-03_1227_NOAA-21",
      "dept": "03",
      "depts": ["03", "18"],
      "lat": 46.6761,
      "lon": 2.62978,
      "detections": 2,
      "passes": 1,
      "confirmed": false,
      "recurrent": false,
      "frpTotalMw": 9.2,
      "frpMaxMw": 4.6,
      "firstAt": "2026-10-03T12:27:00.000Z",
      "lastAt": "2026-10-03T12:27:00.000Z",
      "satellites": ["NOAA-21"],
      "confidenceMax": "nominale",
      "nightDetections": 0
    },
    {
      "id": "48.7253_5.3664_2026-10-03_1401_Aqua",
      "dept": "55",
      "depts": ["55"],
      "lat": 48.72532,
      "lon": 5.36637,
      "detections": 1,
      "passes": 1,
      "confirmed": false,
      "recurrent": false,
      "frpTotalMw": 7.45,
      "frpMaxMw": 7.45,
      "firstAt": "2026-10-03T14:01:00.000Z",
      "lastAt": "2026-10-03T14:01:00.000Z",
      "satellites": ["Aqua"],
      "confidenceMax": "faible",
      "nightDetections": 0
    },
    {
      "id": "46.0926_3.1344_2026-10-03_1227_NOAA-21",
      "dept": "03",
      "depts": ["03"],
      "lat": 46.0942,
      "lon": 3.13383,
      "detections": 2,
      "passes": 1,
      "confirmed": false,
      "recurrent": false,
      "frpTotalMw": 6.46,
      "frpMaxMw": 3.23,
      "firstAt": "2026-10-03T12:27:00.000Z",
      "lastAt": "2026-10-03T12:27:00.000Z",
      "satellites": ["NOAA-21"],
      "confidenceMax": "nominale",
      "nightDetections": 0
    },
    {
      "id": "51.0467_2.2980_2026-10-03_1229_NOAA-21",
      "dept": "59",
      "depts": ["59"],
      "lat": 51.03723,
      "lon": 2.28744,
      "detections": 53,
      "passes": 9,
      "confirmed": true,
      "recurrent": true,
      "frpTotalMw": 194.06,
      "frpMaxMw": 25.75,
      "firstAt": "2026-10-03T12:29:00.000Z",
      "lastAt": "2026-10-04T03:17:00.000Z",
      "satellites": ["Suomi NPP", "NOAA-20", "NOAA-21", "Terra"],
      "confidenceMax": "haute",
      "nightDetections": 51
    },
    {
      "id": "43.4337_4.8919_2026-10-04_0043_NOAA-21",
      "dept": "13",
      "depts": ["13"],
      "lat": 43.43978,
      "lon": 4.89363,
      "detections": 42,
      "passes": 5,
      "confirmed": true,
      "recurrent": true,
      "frpTotalMw": 75.33,
      "frpMaxMw": 4.15,
      "firstAt": "2026-10-04T00:43:00.000Z",
      "lastAt": "2026-10-04T03:00:00.000Z",
      "satellites": ["Suomi NPP", "NOAA-20", "NOAA-21"],
      "confidenceMax": "nominale",
      "nightDetections": 42
    }
  ],
  "daily": {
    "days": [
      {"date": "2026-10-03", "france": 96, "recurrent": 59},
      {"date": "2026-10-04", "france": 105, "recurrent": 90}
    ],
    "since": "2026-10-03"
  },
  "nextPasses": [
    {
      "satellite": "Terra",
      "expectedAt": "2026-10-04T08:48:00.000Z"
    },
    {
      "satellite": "Suomi NPP",
      "expectedAt": "2026-10-04T11:25:00.000Z"
    },
    {
      "satellite": "NOAA-20",
      "expectedAt": "2026-10-04T11:45:00.000Z"
    },
    {
      "satellite": "NOAA-21",
      "expectedAt": "2026-10-04T12:27:00.000Z"
    },
    {
      "satellite": "Suomi NPP",
      "expectedAt": "2026-10-04T13:04:00.000Z"
    },
    {
      "satellite": "NOAA-20",
      "expectedAt": "2026-10-04T13:25:00.000Z"
    }
  ],
  "errors": [],
  "forestDanger": {
    "publishedAt": "2026-10-03T14:50:06Z",
    "j1Date": "2026-10-04",
    "j2Date": "2026-10-05",
    "season": "en-saison",
    "departments": [
      {"dept": "01", "name": "Ain", "j1": 1, "j2": 1},
      {"dept": "02", "name": "Aisne", "j1": 1, "j2": 1},
      {"dept": "03", "name": "Allier", "j1": 1, "j2": 1},
      {"dept": "04", "name": "Alpes-de-Haute-Provence", "j1": 2, "j2": 1},
      {"dept": "05", "name": "Hautes-Alpes", "j1": 1, "j2": 1},
      {"dept": "06", "name": "Alpes-Maritimes", "j1": 2, "j2": 2},
      {"dept": "07", "name": "Ardèche", "j1": 1, "j2": 1},
      {"dept": "08", "name": "Ardennes", "j1": 1, "j2": 1},
      {"dept": "09", "name": "Ariège", "j1": 1, "j2": 1},
      {"dept": "10", "name": "Aube", "j1": 1, "j2": 1},
      {"dept": "11", "name": "Aude", "j1": 1, "j2": 1},
      {"dept": "12", "name": "Aveyron", "j1": 1, "j2": 1},
      {"dept": "13", "name": "Bouches-du-Rhône", "j1": 2, "j2": 1},
      {"dept": "14", "name": "Calvados", "j1": 1, "j2": 1},
      {"dept": "15", "name": "Cantal", "j1": 1, "j2": 1},
      {"dept": "16", "name": "Charente", "j1": 1, "j2": 1},
      {"dept": "17", "name": "Charente-Maritime", "j1": 1, "j2": 1},
      {"dept": "18", "name": "Cher", "j1": 1, "j2": 1},
      {"dept": "19", "name": "Corrèze", "j1": 1, "j2": 1},
      {"dept": "21", "name": "Côte-d'Or", "j1": 1, "j2": 1},
      {"dept": "22", "name": "Côtes-d'Armor", "j1": 1, "j2": 1},
      {"dept": "23", "name": "Creuse", "j1": 1, "j2": 1},
      {"dept": "24", "name": "Dordogne", "j1": 1, "j2": 1},
      {"dept": "25", "name": "Doubs", "j1": 1, "j2": 1},
      {"dept": "26", "name": "Drôme", "j1": 1, "j2": 1},
      {"dept": "27", "name": "Eure", "j1": 1, "j2": 1},
      {"dept": "28", "name": "Eure-et-Loir", "j1": 1, "j2": 1},
      {"dept": "29", "name": "Finistère", "j1": 1, "j2": 1},
      {"dept": "2A", "name": "Corse-du-Sud", "j1": 2, "j2": 2},
      {"dept": "2B", "name": "Haute-Corse", "j1": 2, "j2": 2},
      {"dept": "30", "name": "Gard", "j1": 1, "j2": 1},
      {"dept": "31", "name": "Haute-Garonne", "j1": 2, "j2": 1},
      {"dept": "32", "name": "Gers", "j1": 1, "j2": 1},
      {"dept": "33", "name": "Gironde", "j1": 1, "j2": 1},
      {"dept": "34", "name": "Hérault", "j1": 1, "j2": 1},
      {"dept": "35", "name": "Ille-et-Vilaine", "j1": 1, "j2": 1},
      {"dept": "36", "name": "Indre", "j1": 1, "j2": 1},
      {"dept": "37", "name": "Indre-et-Loire", "j1": 1, "j2": 1},
      {"dept": "38", "name": "Isère", "j1": 1, "j2": 1},
      {"dept": "39", "name": "Jura", "j1": 1, "j2": 1},
      {"dept": "40", "name": "Landes", "j1": 1, "j2": 1},
      {"dept": "41", "name": "Loir-et-Cher", "j1": 1, "j2": 1},
      {"dept": "42", "name": "Loire", "j1": 1, "j2": 1},
      {"dept": "43", "name": "Haute-Loire", "j1": 1, "j2": 1},
      {"dept": "44", "name": "Loire-Atlantique", "j1": 2, "j2": 1},
      {"dept": "45", "name": "Loiret", "j1": 1, "j2": 1},
      {"dept": "46", "name": "Lot", "j1": 1, "j2": 1},
      {"dept": "47", "name": "Lot-et-Garonne", "j1": 1, "j2": 1},
      {"dept": "48", "name": "Lozère", "j1": 1, "j2": 1},
      {"dept": "49", "name": "Maine-et-Loire", "j1": 1, "j2": 1},
      {"dept": "50", "name": "Manche", "j1": 1, "j2": 1},
      {"dept": "51", "name": "Marne", "j1": 2, "j2": 2},
      {"dept": "52", "name": "Haute-Marne", "j1": 1, "j2": 1},
      {"dept": "53", "name": "Mayenne", "j1": 1, "j2": 1},
      {"dept": "54", "name": "Meurthe-et-Moselle", "j1": 1, "j2": 1},
      {"dept": "55", "name": "Meuse", "j1": 1, "j2": 1},
      {"dept": "56", "name": "Morbihan", "j1": 1, "j2": 1},
      {"dept": "57", "name": "Moselle", "j1": 1, "j2": 1},
      {"dept": "58", "name": "Nièvre", "j1": 1, "j2": 1},
      {"dept": "59", "name": "Nord", "j1": 1, "j2": 1},
      {"dept": "60", "name": "Oise", "j1": 1, "j2": 1},
      {"dept": "61", "name": "Orne", "j1": 1, "j2": 1},
      {"dept": "62", "name": "Pas-de-Calais", "j1": 1, "j2": 1},
      {"dept": "63", "name": "Puy-de-Dôme", "j1": 1, "j2": 1},
      {"dept": "64", "name": "Pyrénées-Atlantiques", "j1": 1, "j2": 1},
      {"dept": "65", "name": "Hautes-Pyrénées", "j1": 1, "j2": 1},
      {"dept": "66", "name": "Pyrénées-Orientales", "j1": 1, "j2": 1},
      {"dept": "67", "name": "Bas-Rhin", "j1": 1, "j2": 1},
      {"dept": "68", "name": "Haut-Rhin", "j1": 1, "j2": 1},
      {"dept": "69", "name": "Rhône", "j1": 1, "j2": 1},
      {"dept": "70", "name": "Haute-Saône", "j1": 1, "j2": 1},
      {"dept": "71", "name": "Saône-et-Loire", "j1": 1, "j2": 1},
      {"dept": "72", "name": "Sarthe", "j1": 1, "j2": 1},
      {"dept": "73", "name": "Savoie", "j1": 1, "j2": 1},
      {"dept": "74", "name": "Haute-Savoie", "j1": 1, "j2": 1},
      {"dept": "75", "name": "Paris", "j1": 1, "j2": 1},
      {"dept": "76", "name": "Seine-Maritime", "j1": 1, "j2": 1},
      {"dept": "77", "name": "Seine-et-Marne", "j1": 1, "j2": 1},
      {"dept": "78", "name": "Yvelines", "j1": 1, "j2": 1},
      {"dept": "79", "name": "Deux-Sèvres", "j1": 1, "j2": 1},
      {"dept": "80", "name": "Somme", "j1": 1, "j2": 1},
      {"dept": "81", "name": "Tarn", "j1": 1, "j2": 1},
      {"dept": "82", "name": "Tarn-et-Garonne", "j1": 1, "j2": 1},
      {"dept": "83", "name": "Var", "j1": 2, "j2": 2},
      {"dept": "84", "name": "Vaucluse", "j1": 2, "j2": 1},
      {"dept": "85", "name": "Vendée", "j1": 1, "j2": 1},
      {"dept": "86", "name": "Vienne", "j1": 1, "j2": 1},
      {"dept": "87", "name": "Haute-Vienne", "j1": 1, "j2": 1},
      {"dept": "88", "name": "Vosges", "j1": 1, "j2": 1},
      {"dept": "89", "name": "Yonne", "j1": 1, "j2": 1},
      {"dept": "90", "name": "Territoire de Belfort", "j1": 1, "j2": 1},
      {"dept": "91", "name": "Essonne", "j1": 1, "j2": 1},
      {"dept": "92", "name": "Hauts-de-Seine", "j1": 1, "j2": 1},
      {"dept": "93", "name": "Seine-Saint-Denis", "j1": 1, "j2": 1},
      {"dept": "94", "name": "Val-de-Marne", "j1": 1, "j2": 1},
      {"dept": "95", "name": "Val-d'Oise", "j1": 1, "j2": 1}
    ],
    "history": [
      {"date": "2026-05-29", "n1": 79, "n2": 17, "n3": 0, "n4": 0},
      {"date": "2026-05-30", "n1": 81, "n2": 15, "n3": 0, "n4": 0},
      {"date": "2026-05-31", "n1": 75, "n2": 20, "n3": 1, "n4": 0},
      {"date": "2026-06-01", "n1": 87, "n2": 9, "n3": 0, "n4": 0},
      {"date": "2026-06-02", "n1": 92, "n2": 3, "n3": 1, "n4": 0},
      {"date": "2026-06-03", "n1": 90, "n2": 5, "n3": 1, "n4": 0},
      {"date": "2026-06-04", "n1": 90, "n2": 5, "n3": 1, "n4": 0},
      {"date": "2026-06-05", "n1": 91, "n2": 5, "n3": 0, "n4": 0},
      {"date": "2026-06-06", "n1": 90, "n2": 6, "n3": 0, "n4": 0},
      {"date": "2026-06-07", "n1": 91, "n2": 5, "n3": 0, "n4": 0},
      {"date": "2026-06-08", "n1": 89, "n2": 6, "n3": 1, "n4": 0},
      {"date": "2026-06-09", "n1": 86, "n2": 9, "n3": 1, "n4": 0},
      {"date": "2026-06-10", "n1": 83, "n2": 9, "n3": 4, "n4": 0},
      {"date": "2026-06-11", "n1": 83, "n2": 8, "n3": 5, "n4": 0},
      {"date": "2026-06-12", "n1": 84, "n2": 8, "n3": 4, "n4": 0},
      {"date": "2026-06-13", "n1": 76, "n2": 17, "n3": 3, "n4": 0},
      {"date": "2026-06-14", "n1": 61, "n2": 29, "n3": 6, "n4": 0},
      {"date": "2026-06-15", "n1": 58, "n2": 32, "n3": 6, "n4": 0},
      {"date": "2026-06-16", "n1": 61, "n2": 33, "n3": 2, "n4": 0},
      {"date": "2026-06-17", "n1": 66, "n2": 29, "n3": 1, "n4": 0},
      {"date": "2026-06-18", "n1": 40, "n2": 53, "n3": 3, "n4": 0},
      {"date": "2026-06-19", "n1": 22, "n2": 58, "n3": 16, "n4": 0},
      {"date": "2026-06-20", "n1": 32, "n2": 61, "n3": 3, "n4": 0},
      {"date": "2026-06-21", "n1": 38, "n2": 54, "n3": 4, "n4": 0},
      {"date": "2026-06-22", "n1": 17, "n2": 62, "n3": 17, "n4": 0},
      {"date": "2026-06-23", "n1": 11, "n2": 57, "n3": 28, "n4": 0},
      {"date": "2026-06-24", "n1": 7, "n2": 54, "n3": 35, "n4": 0},
      {"date": "2026-06-25", "n1": 6, "n2": 40, "n3": 48, "n4": 2},
      {"date": "2026-06-26", "n1": 9, "n2": 62, "n3": 25, "n4": 0},
      {"date": "2026-06-27", "n1": 12, "n2": 40, "n3": 43, "n4": 1},
      {"date": "2026-06-28", "n1": 40, "n2": 46, "n3": 10, "n4": 0},
      {"date": "2026-06-29", "n1": 72, "n2": 16, "n3": 7, "n4": 1},
      {"date": "2026-06-30", "n1": 53, "n2": 35, "n3": 8, "n4": 0},
      {"date": "2026-07-01", "n1": 35, "n2": 52, "n3": 3, "n4": 6},
      {"date": "2026-07-02", "n1": 25, "n2": 59, "n3": 6, "n4": 6},
      {"date": "2026-07-03", "n1": 18, "n2": 67, "n3": 5, "n4": 6},
      {"date": "2026-07-04", "n1": 13, "n2": 63, "n3": 14, "n4": 6},
      {"date": "2026-07-05", "n1": 9, "n2": 59, "n3": 21, "n4": 7},
      {"date": "2026-07-06", "n1": 1, "n2": 47, "n3": 41, "n4": 7},
      {"date": "2026-07-07", "n1": 0, "n2": 32, "n3": 61, "n4": 3},
      {"date": "2026-07-08", "n1": 1, "n2": 41, "n3": 47, "n4": 7},
      {"date": "2026-07-09", "n1": 1, "n2": 36, "n3": 54, "n4": 5},
      {"date": "2026-07-10", "n1": 0, "n2": 32, "n3": 63, "n4": 1},
      {"date": "2026-07-11", "n1": 1, "n2": 34, "n3": 61, "n4": 0},
      {"date": "2026-07-12", "n1": 2, "n2": 23, "n3": 70, "n4": 1},
      {"date": "2026-07-13", "n1": 1, "n2": 36, "n3": 59, "n4": 0},
      {"date": "2026-07-14", "n1": 3, "n2": 63, "n3": 30, "n4": 0},
      {"date": "2026-07-15", "n1": 3, "n2": 57, "n3": 36, "n4": 0},
      {"date": "2026-07-16", "n1": 21, "n2": 66, "n3": 9, "n4": 0},
      {"date": "2026-07-17", "n1": 60, "n2": 29, "n3": 7, "n4": 0},
      {"date": "2026-07-18", "n1": 51, "n2": 36, "n3": 8, "n4": 1},
      {"date": "2026-07-19", "n1": 18, "n2": 62, "n3": 14, "n4": 2},
      {"date": "2026-07-20", "n1": 7, "n2": 62, "n3": 27, "n4": 0},
      {"date": "2026-07-21", "n1": 4, "n2": 56, "n3": 31, "n4": 5},
      {"date": "2026-07-22", "n1": 5, "n2": 65, "n3": 23, "n4": 3},
      {"date": "2026-07-23", "n1": 3, "n2": 60, "n3": 28, "n4": 5},
      {"date": "2026-07-24", "n1": 4, "n2": 64, "n3": 27, "n4": 1},
      {"date": "2026-07-25", "n1": 3, "n2": 67, "n3": 26, "n4": 0},
      {"date": "2026-07-26", "n1": 14, "n2": 62, "n3": 20, "n4": 0},
      {"date": "2026-07-27", "n1": 28, "n2": 61, "n3": 7, "n4": 0},
      {"date": "2026-07-28", "n1": 8, "n2": 81, "n3": 7, "n4": 0},
      {"date": "2026-07-29", "n1": 0, "n2": 31, "n3": 65, "n4": 0},
      {"date": "2026-07-30", "n1": 1, "n2": 64, "n3": 29, "n4": 2},
      {"date": "2026-07-31", "n1": 7, "n2": 80, "n3": 9, "n4": 0},
      {"date": "2026-08-01", "n1": 32, "n2": 56, "n3": 8, "n4": 0},
      {"date": "2026-08-02", "n1": 12, "n2": 75, "n3": 9, "n4": 0},
      {"date": "2026-08-03", "n1": 5, "n2": 55, "n3": 36, "n4": 0},
      {"date": "2026-08-04", "n1": 32, "n2": 52, "n3": 12, "n4": 0},
      {"date": "2026-08-05", "n1": 32, "n2": 56, "n3": 8, "n4": 0},
      {"date": "2026-08-06", "n1": 16, "n2": 70, "n3": 6, "n4": 4},
      {"date": "2026-08-07", "n1": 8, "n2": 76, "n3": 9, "n4": 3},
      {"date": "2026-08-08", "n1": 2, "n2": 60, "n3": 34, "n4": 0},
      {"date": "2026-08-09", "n1": 1, "n2": 58, "n3": 37, "n4": 0},
      {"date": "2026-08-10", "n1": 21, "n2": 58, "n3": 17, "n4": 0},
      {"date": "2026-08-11", "n1": 13, "n2": 41, "n3": 42, "n4": 0},
      {"date": "2026-08-12", "n1": 6, "n2": 45, "n3": 45, "n4": 0},
      {"date": "2026-08-13", "n1": 3, "n2": 43, "n3": 50, "n4": 0},
      {"date": "2026-08-14", "n1": 1, "n2": 34, "n3": 57, "n4": 4},
      {"date": "2026-08-15", "n1": 3, "n2": 50, "n3": 43, "n4": 0},
      {"date": "2026-08-16", "n1": 16, "n2": 66, "n3": 14, "n4": 0},
      {"date": "2026-08-17", "n1": 28, "n2": 56, "n3": 9, "n4": 3},
      {"date": "2026-08-18", "n1": 23, "n2": 62, "n3": 10, "n4": 1},
      {"date": "2026-08-19", "n1": 19, "n2": 60, "n3": 17, "n4": 0},
      {"date": "2026-08-20", "n1": 39, "n2": 52, "n3": 5, "n4": 0},
      {"date": "2026-08-21", "n1": 52, "n2": 44, "n3": 0, "n4": 0},
      {"date": "2026-08-22", "n1": 58, "n2": 36, "n3": 2, "n4": 0},
      {"date": "2026-08-23", "n1": 33, "n2": 57, "n3": 6, "n4": 0},
      {"date": "2026-08-24", "n1": 20, "n2": 66, "n3": 10, "n4": 0},
      {"date": "2026-08-25", "n1": 89, "n2": 7, "n3": 0, "n4": 0},
      {"date": "2026-08-26", "n1": 64, "n2": 31, "n3": 1, "n4": 0},
      {"date": "2026-08-27", "n1": 72, "n2": 19, "n3": 4, "n4": 1},
      {"date": "2026-08-28", "n1": 86, "n2": 9, "n3": 1, "n4": 0},
      {"date": "2026-08-29", "n1": 84, "n2": 5, "n3": 7, "n4": 0},
      {"date": "2026-08-30", "n1": 83, "n2": 10, "n3": 3, "n4": 0},
      {"date": "2026-08-31", "n1": 79, "n2": 10, "n3": 7, "n4": 0},
      {"date": "2026-09-01", "n1": 79, "n2": 11, "n3": 6, "n4": 0},
      {"date": "2026-09-02", "n1": 76, "n2": 13, "n3": 7, "n4": 0},
      {"date": "2026-09-03", "n1": 72, "n2": 18, "n3": 6, "n4": 0},
      {"date": "2026-09-04", "n1": 48, "n2": 43, "n3": 5, "n4": 0},
      {"date": "2026-09-05", "n1": 67, "n2": 21, "n3": 8, "n4": 0},
      {"date": "2026-09-06", "n1": 46, "n2": 43, "n3": 7, "n4": 0},
      {"date": "2026-09-07", "n1": 37, "n2": 55, "n3": 4, "n4": 0},
      {"date": "2026-09-08", "n1": 34, "n2": 57, "n3": 5, "n4": 0},
      {"date": "2026-09-09", "n1": 84, "n2": 11, "n3": 1, "n4": 0},
      {"date": "2026-09-10", "n1": 83, "n2": 8, "n3": 5, "n4": 0},
      {"date": "2026-09-11", "n1": 80, "n2": 11, "n3": 5, "n4": 0},
      {"date": "2026-09-12", "n1": 77, "n2": 15, "n3": 4, "n4": 0},
      {"date": "2026-09-13", "n1": 63, "n2": 29, "n3": 4, "n4": 0},
      {"date": "2026-09-14", "n1": 62, "n2": 27, "n3": 7, "n4": 0},
      {"date": "2026-09-15", "n1": 32, "n2": 61, "n3": 3, "n4": 0},
      {"date": "2026-09-16", "n1": 32, "n2": 58, "n3": 5, "n4": 1},
      {"date": "2026-09-17", "n1": 39, "n2": 52, "n3": 5, "n4": 0},
      {"date": "2026-09-18", "n1": 66, "n2": 24, "n3": 6, "n4": 0},
      {"date": "2026-09-19", "n1": 55, "n2": 39, "n3": 2, "n4": 0},
      {"date": "2026-09-20", "n1": 48, "n2": 42, "n3": 6, "n4": 0},
      {"date": "2026-09-21", "n1": 35, "n2": 53, "n3": 5, "n4": 3},
      {"date": "2026-09-22", "n1": 18, "n2": 69, "n3": 9, "n4": 0},
      {"date": "2026-09-23", "n1": 19, "n2": 75, "n3": 2, "n4": 0},
      {"date": "2026-09-24", "n1": 26, "n2": 59, "n3": 10, "n4": 1},
      {"date": "2026-09-25", "n1": 20, "n2": 69, "n3": 7, "n4": 0},
      {"date": "2026-09-26", "n1": 47, "n2": 48, "n3": 1, "n4": 0},
      {"date": "2026-09-27", "n1": 17, "n2": 75, "n3": 4, "n4": 0},
      {"date": "2026-09-28", "n1": 38, "n2": 55, "n3": 3, "n4": 0},
      {"date": "2026-09-29", "n1": 36, "n2": 55, "n3": 5, "n4": 0},
      {"date": "2026-09-30", "n1": 46, "n2": 50, "n3": 0, "n4": 0},
      {"date": "2026-10-01", "n1": 92, "n2": 4, "n3": 0, "n4": 0},
      {"date": "2026-10-02", "n1": 90, "n2": 6, "n3": 0, "n4": 0},
      {"date": "2026-10-03", "n1": 88, "n2": 8, "n3": 0, "n4": 0},
      {"date": "2026-10-04", "n1": 86, "n2": 10, "n3": 0, "n4": 0}
    ]
  }
};

/** Feux du 04/10 : météo des forêts du 03/10 (10 départements au niveau 2 pour aujourd’hui), sources récurrentes, détections hors de France ; pastille jaune. */
export function FIRES_FIXTURE(): FiresResponse { return copy(FIRES); }

const MANIFEST: Radar2dManifest = {
  "schemaVersion": 1,
  "source": "Météo-France DPRadar",
  "observedAt": "2026-10-04T08:05:00Z",
  "generatedAt": "2026-10-04T08:10:25Z",
  "bounds": [-9.965, 39.46785, 14.564708, 53.67],
  "imageUrl": "https://www.francemonitor.com/radar/rasters/radar-20261004T0805Z-0ee838cddba4a5500289b88820bc120d9a55e780d19e35a4eb2623abcfa508c9.webp",
  "resolutionMeters": 1000,
  "license": "Licence Ouverte 2.0",
  "echoTopImageUrl": "https://www.francemonitor.com/radar/rasters/radar-echotops-20261004T0805Z-0ee838cddba4a5500289b88820bc120d9a55e780d19e35a4eb2623abcfa508c9.webp"
};

/** Manifeste radar de production du 04/10 (observation 08:05Z, 10 h 05 à Paris). */
export function RADAR_MANIFEST_FIXTURE(): Radar2dManifest { return copy(MANIFEST); }

const COLUMN: RadarColumnResult = { kind: 'profile', profile: {
  "schemaVersion": 1,
  "source": "Météo-France DPRadar",
  "license": "Licence Ouverte 2.0",
  "station": {
    "id": 49,
    "name": "NIMES",
    "lat": 43.80611,
    "lon": 4.50278
  },
  "distanceKm": 53.6,
  "observedAt": "2026-10-04T09:30:00Z",
  "levels": [
    {
      "elevationDeg": 0.6,
      "altitudeM": 801.0,
      "dbz": 11.5
    },
    {
      "elevationDeg": 1.2,
      "altitudeM": 1362.6,
      "dbz": null
    },
    {
      "elevationDeg": 1.8,
      "altitudeM": 1924.0,
      "dbz": null
    },
    {
      "elevationDeg": 2.4,
      "altitudeM": 2485.2,
      "dbz": null
    },
    {
      "elevationDeg": 5.0,
      "altitudeM": 4935.4,
      "dbz": null
    }
  ]
} };

/** Colonne radar de production (Nîmes, 53,6 km, 5 élévations), relevée le 04/10. */
export function RADAR_COLUMN_FIXTURE(): RadarColumnResult { return copy(COLUMN); }

const IMPACTS: FireImpactsResponse = {
  "lat": 44.88,
  "lon": -1.12,
  "radiusKm": 10,
  "communes": [
    {
      "code": "33333",
      "name": "Le Porge",
      "dept": "33",
      "population": 3465,
      "distanceKm": 2.1
    },
    {
      "code": "33011",
      "name": "Arès",
      "dept": "33",
      "population": 6482,
      "distanceKm": 9.4
    },
    {
      "code": "33503",
      "name": "Saumos",
      "dept": "33",
      "population": 550,
      "distanceKm": 9.9
    }
  ],
  "nearest": {
    "code": "33333",
    "name": "Le Porge",
    "dept": "33",
    "population": 3465,
    "distanceKm": 2.1
  },
  "georisquesUrl": "https://www.georisques.gouv.fr/api/v1/rapport_pdf?code_insee=33333",
  "readAt": "2026-10-04T08:10:00.000Z",
  "errors": []
};

/** Communes à moins de 10 km d’un point du Porge (Gironde, 44,88 N 1,12 O) et lien Géorisques de la plus proche. */
export function FIRE_IMPACTS_FIXTURE(): FireImpactsResponse { return copy(IMPACTS); }
