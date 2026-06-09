# Rapport d'audit des véhicules

Un petit rapport d'audit autonome qui affiche le kilométrage et le niveau de carburant de chaque véhicule à une date précise.

Le rapport est servi sous `/treports/`. En local avec Wrangler, ouvrez `http://localhost:8788/treports/`, choisissez la date du rapport, puis imprimez le résultat si nécessaire.

Les relevés des véhicules sont actuellement stockés dans `app.js` comme données d'exemple. Remplacez les entrées de `vehicleReadings` par les données de production ou connectez ce tableau à votre source backend/export préférée.
