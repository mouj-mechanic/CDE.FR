import type { Category, CategoryId } from "@/types";

export const CATEGORIES: Category[] = [
  {
    id: "headwear",
    label: "Casquette / chapeau / bonnet",
    shortDescription:
      "Essayez un couvre-chef sur votre tête avec un rendu naturel et élégant.",
    bodyTarget: "Tête et visage",
    photoInstructions: [
      "Prenez une photo claire de votre tête et de votre visage.",
      "Visage bien éclairé, tête droite, sans filtre.",
      "Choisissez un fond simple et neutre.",
      "Évitez les ombres marquées sur le visage.",
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
      "Prenez une photo de votre visage de face.",
      "Regardez directement la caméra.",
      "Retirez vos lunettes actuelles si possible.",
      "Assurez-vous d'avoir une bonne lumière naturelle.",
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
      "Photographiez votre poignet ou votre main clairement.",
      "Poignet bien visible, angle naturel.",
      "Main stable, sans flou de mouvement.",
      "Privilégiez une lumière douce et uniforme.",
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
      "Bagues, bracelets ou bagues — sublimez votre main en un instant.",
    bodyTarget: "Main",
    photoInstructions: [
      "Prenez une photo nette de votre main.",
      "Doigts bien visibles, main posée ou légèrement ouverte.",
      "Fond neutre pour mettre en valeur la main.",
      "Évitez les reflets trop forts sur les bijoux existants.",
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
      "Photo du corps entier ou du buste selon le vêtement.",
      "Tenez-vous debout, posture naturelle.",
      "Portez des vêtements ajustés ou moulants en dessous.",
      "Fond simple, bonne lumière, sans filtre.",
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
