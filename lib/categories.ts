import type { Category, CategoryId } from "@/types";

export const CATEGORIES: Category[] = [
  {
    id: "headwear",
    label: "Casquette / chapeau / bonnet",
    shortDescription:
      "Essayez un couvre-chef sur votre tête avec un rendu naturel et élégant.",
    bodyTarget: "Tête et visage",
    photoInstructions: [
      "Cadrez votre tête et le haut des épaules.",
      "Visage bien éclairé, tête droite, sans filtre.",
      "Choisissez un fond simple et neutre.",
      "Gardez un instant immobile pour éviter le flou.",
    ],
    photoSteps: [
      {
        title: "Cadrez votre tête",
        hint: "De face, du haut du crâne jusqu'aux épaules. Téléphone à hauteur des yeux.",
        scene: "frame",
      },
      {
        title: "Tête droite, regard vers l'objectif",
        hint: "Évitez d'incliner la tête. Cheveux dégagés du front.",
        scene: "angle",
      },
      {
        title: "Lumière douce et frontale",
        hint: "Près d'une fenêtre ou d'une lampe, sans contre-jour ni ombre dure.",
        scene: "lighting",
      },
      {
        title: "Fond simple, sans motif",
        hint: "Un mur uni met votre visage en valeur — votre couvre-chef aussi.",
        scene: "background",
      },
    ],
    productInputMode: "single",
    loadingTitle: "Notre chapelier prépare votre essayage…",
    loadingDescription:
      "Ajustement précis de votre couvre-chef pour un rendu harmonieux.",
    animationType: "hatmaker",
    iconName: "hat",
  },
  {
    id: "glasses",
    label: "Lunettes",
    shortDescription:
      "Visualisez une monture sur votre visage avant de commander.",
    bodyTarget: "Visage de face",
    photoInstructions: [
      "Cadrez votre visage de face.",
      "Regardez directement la caméra.",
      "Retirez vos lunettes actuelles.",
      "Lumière naturelle, sans reflets sur les yeux.",
    ],
    photoSteps: [
      {
        title: "Cadrez votre visage",
        hint: "Front, yeux et bouche bien centrés. Téléphone à hauteur des yeux.",
        scene: "frame",
      },
      {
        title: "Retirez vos lunettes actuelles",
        hint: "Pour que la monture virtuelle s'ajuste au plus près de vos yeux.",
        scene: "remove",
      },
      {
        title: "Regardez l'objectif",
        hint: "Tête droite, regard fixé. Évitez de pencher le visage.",
        scene: "angle",
      },
      {
        title: "Lumière naturelle douce",
        hint: "Pas de soleil direct ni de reflets dans les yeux.",
        scene: "lighting",
      },
    ],
    productInputMode: "single",
    loadingTitle: "Notre opticien prépare vos lunettes…",
    loadingDescription:
      "Réglage minutieux de la monture pour s'adapter à votre visage.",
    animationType: "optician",
    iconName: "glasses",
  },
  {
    id: "watch",
    label: "Montre",
    shortDescription:
      "Découvrez comment une montre sublime votre poignet.",
    bodyTarget: "Poignet ou main",
    photoInstructions: [
      "Cadrez votre poignet de manière nette.",
      "Bras légèrement tourné, paume vers vous.",
      "Main stable, sans flou de mouvement.",
      "Lumière douce et uniforme.",
    ],
    photoSteps: [
      {
        title: "Cadrez votre poignet",
        hint: "Du dos de la main jusqu'au milieu de l'avant-bras, plein cadre.",
        scene: "frame",
      },
      {
        title: "Tournez le poignet d'environ 30°",
        hint: "Paume vers vous, comme pour lire l'heure naturellement.",
        scene: "angle",
      },
      {
        title: "Main stable, posée si possible",
        hint: "Posez l'avant-bras sur une table pour éviter tout flou.",
        scene: "stable",
      },
      {
        title: "Lumière douce, fond uni",
        hint: "Fuyez les reflets agressifs et les motifs distrayants.",
        scene: "lighting",
      },
    ],
    productInputMode: "single",
    loadingTitle: "Notre maître horloger ajuste votre montre…",
    loadingDescription:
      "Assemblage délicat pour un porté élégant et réaliste.",
    animationType: "watchmaker",
    iconName: "watch",
  },
  {
    id: "hand-jewelry",
    label: "Bijou de main",
    shortDescription:
      "Bagues, bracelets ou jonc — sublimez votre main en un instant.",
    bodyTarget: "Main",
    photoInstructions: [
      "Cadrez votre main de manière nette.",
      "Doigts légèrement écartés, bien visibles.",
      "Fond neutre pour mettre la main en valeur.",
      "Évitez les bijoux qui pourraient gêner.",
    ],
    photoSteps: [
      {
        title: "Cadrez votre main",
        hint: "De face ou de trois-quart, du poignet à la pointe des doigts.",
        scene: "frame",
      },
      {
        title: "Écartez légèrement les doigts",
        hint: "Pour que chaque doigt soit lisible. Pas de poing fermé.",
        scene: "angle",
      },
      {
        title: "Fond uni, neutre",
        hint: "Pose ta main sur une surface claire et unie pour le contraste.",
        scene: "background",
      },
      {
        title: "Retirez bagues et bracelets concurrents",
        hint: "Pour que le bijou virtuel reçoive toute la lumière.",
        scene: "remove",
      },
    ],
    productInputMode: "multi",
    loadingTitle: "Notre joaillier sublime votre main…",
    loadingDescription:
      "Polissage et ajustement de chaque détail pour un éclat parfait.",
    animationType: "jeweler",
    iconName: "gem",
  },
  {
    id: "clothes",
    label: "Vêtements",
    shortDescription:
      "Hauts, robes, vestes — visualisez une tenue complète sur vous.",
    bodyTarget: "Corps entier ou buste",
    photoInstructions: [
      "Cadrez votre buste ou corps entier selon le vêtement.",
      "Tenez-vous droit, posture naturelle.",
      "Portez quelque chose d'ajusté en dessous.",
      "Lumière douce, fond simple, sans filtre.",
    ],
    photoSteps: [
      {
        title: "Cadrage : buste ou corps entier",
        hint: "Haut → buste. Robe ou pantalon → corps entier, debout.",
        scene: "frame",
      },
      {
        title: "Posture droite, bras le long du corps",
        hint: "Pieds parallèles, épaules détendues, regard à l'horizontale.",
        scene: "pose",
      },
      {
        title: "Sous-couche ajustée",
        hint: "T-shirt près du corps ou legging : la silhouette sera plus nette.",
        scene: "outfit",
      },
      {
        title: "Lumière homogène, fond simple",
        hint: "Lumière du jour idéale. Mur ou rideau uni en arrière-plan.",
        scene: "lighting",
      },
    ],
    productInputMode: "multi",
    loadingTitle: "Notre couturier ajuste votre tenue…",
    loadingDescription:
      "Prise de mesures virtuelles pour un tombé impeccable.",
    animationType: "tailor",
    iconName: "shirt",
  },
];

export function getCategory(id: CategoryId): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function isValidCategoryId(id: string): id is CategoryId {
  return CATEGORIES.some((c) => c.id === id);
}
