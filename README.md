# Rapport d'audit des véhicules

Un petit rapport d'audit autonome qui affiche le kilométrage et le niveau de carburant de chaque véhicule à une date précise.

Le rapport est servi sous `/treports/`. En local avec Wrangler, ouvrez `http://localhost:8788/treports/`, consultez les relevés du jour, puis imprimez le résultat si nécessaire.

Les relevés des véhicules sont chargés depuis l'API proxifiée sous `/api`, en combinant les véhicules de `/api/devices` avec les dernières positions de `/api/positions`.
