# Guide photo — médias personnalisés

Dépose ici les **GIF** (ou `.webm` / `.mp4`) qui remplaceront les animations
SVG par défaut dans le **Guide photo étape par étape**.

## Convention de nommage

```
public/guide/<categoryId>/<sceneId>.<ext>
```

| `categoryId` | Description |
|---|---|
| `headwear` | Casquette / chapeau / bonnet |
| `glasses` | Lunettes |
| `watch` | Montre |
| `hand-jewelry` | Bague / bracelet de main |
| `clothes` | Vêtements |

| `sceneId` | Apparaît dans |
|---|---|
| `frame` | Cadrer la zone (présent dans toutes les catégories) |
| `angle` | Angle / orientation de la zone |
| `lighting` | Lumière douce |
| `background` | Fond simple, neutre |
| `remove` | Retirer un accessoire (lunettes / bagues actuelles) |
| `stable` | Main stable, posée sur une surface |
| `pose` | Posture droite |
| `outfit` | Sous-couche ajustée |

> Toutes les paires `category × scene` ne sont pas utilisées — seules celles
> définies dans `lib/categories.ts > photoSteps` apparaissent dans le guide.
> Les autres fichiers seront simplement ignorés.

## Exemples de chemins

```
public/guide/headwear/frame.gif
public/guide/headwear/angle.gif
public/guide/headwear/lighting.gif
public/guide/headwear/background.gif
public/guide/glasses/frame.gif
public/guide/glasses/remove.gif
public/guide/glasses/angle.gif
public/guide/glasses/lighting.gif
public/guide/watch/frame.gif
public/guide/watch/angle.gif
public/guide/watch/stable.gif
public/guide/watch/lighting.gif
public/guide/hand-jewelry/frame.gif
public/guide/hand-jewelry/angle.gif
public/guide/hand-jewelry/background.gif
public/guide/hand-jewelry/remove.gif
public/guide/clothes/frame.gif
public/guide/clothes/pose.gif
public/guide/clothes/outfit.gif
public/guide/clothes/lighting.gif
```

## Activation

Une fois les fichiers déposés, ouvre `lib/guideMedia.ts` et **décommente / ajoute**
les entrées correspondantes dans `MEDIA_INDEX`. Exemple :

```ts
const MEDIA_INDEX = {
  headwear: {
    frame:      { src: "/guide/headwear/frame.gif",      kind: "image" },
    angle:      { src: "/guide/headwear/angle.gif",      kind: "image" },
    lighting:   { src: "/guide/headwear/lighting.gif",   kind: "image" },
    background: { src: "/guide/headwear/background.gif", kind: "image" },
  },
};
```

Pour une vidéo (plus léger qu'un GIF de plus de ~1 Mo) :

```ts
watch: {
  frame: { src: "/guide/watch/frame.webm", kind: "video", poster: "/guide/watch/frame.jpg" },
}
```

Si une scène n'est pas listée, le composant retombe automatiquement sur
l'animation SVG par défaut. Aucune scène n'est obligatoire.

## Recommandations format

- **Format conteneur** :
  - GIF si court (<2s) et de petite taille (<1 Mo) — simple à intégrer.
  - WebM ou MP4 muet sinon — beaucoup plus léger pour la même qualité.
- **Ratio** : carré (1:1). Le composant les rogne en `object-cover`.
- **Résolution** : 480×480 ou 720×720 suffit largement.
- **Boucle** : transition propre (debut == fin) — le composant met
  automatiquement `loop` pour les vidéos.
- **Couleurs** : fond clair / crème pour s'intégrer au design (palette
  `#FBF7F2` cream, `#7A1F2B` bordeaux, `#C9A96E` or).
- **Durée** : 2 à 4 secondes idéal pour boucler sans saturer le regard.
