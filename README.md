# CabinesDEssayage.fr

MVP d'une **cabine d'essayage virtuelle** sans compte utilisateur. Importez votre photo, ajoutez un article (lien ou image), et visualisez un rendu généré par IA — ou un aperçu mock en l'absence de clé API.

## Fonctionnalités

- Landing page premium (hero, cartes catégories, animations)
- 5 catégories : couvre-chef, lunettes, montre, bijou de main, vêtements
- Parcours en 3 étapes : guide photo → upload → article(s)
- Validation élégante des formulaires
- Animations de chargement par métier (chapelier, opticien, horloger…)
- Révélation théâtrale par rideau bordeaux
- Téléchargement du résultat, réessayer, changer d'article
- API `/api/try-on` avec mode mock (4–6 s)
- Architecture prête pour brancher un provider IA réel

## Stack technique

- **Next.js 15** (App Router)
- **React 19** + **TypeScript**
- **Tailwind CSS** + **tailwindcss-animate**
- **Framer Motion** (animations)
- **react-dropzone** (upload)
- **lucide-react** (icônes)

## Lancement local

### Prérequis

- [Node.js](https://nodejs.org/) 18.18 ou supérieur (recommandé : 20 LTS)
- npm

### Installation

```bash
cd CDE.FR
npm install
cp .env.example .env.local
npm run dev
```

Ouvrez [http://localhost:3000](http://localhost:3000).

### Commandes

| Commande        | Description              |
|-----------------|--------------------------|
| `npm install`   | Installe les dépendances |
| `npm run dev`   | Serveur de développement |
| `npm run build` | Build de production      |
| `npm run start` | Lance le build           |
| `npm run lint`  | Vérification ESLint      |

## Connecter une vraie API IA

### Option par défaut : fal.ai (FLUX.1 Kontext multi-image)

Le projet est livré avec une intégration **fal.ai** prête à l'emploi. FLUX.1 Kontext est un modèle d'édition d'image multi-entrée qui couvre les 5 catégories (chapeau, lunettes, montre, bijou, vêtements) via un prompt adapté.

1. Crée un compte sur **https://fal.ai**
2. Génère une clé API : **https://fal.ai/dashboard/keys**
3. Ajoute du crédit : **https://fal.ai/dashboard/billing** (~0.04–0.05 $/image avec `flux-pro/kontext`, ~0.10 $ avec la variante `max`)
4. Dans `.env.local` :

```env
AI_TRYON_PROVIDER=fal
FAL_KEY=ta_cle_fal
NEXT_PUBLIC_AI_PROVIDER=fal.ai
```

5. Redémarre `npm run dev` — le mode mock est désactivé, les vraies générations IA sont utilisées.

Le modèle utilisé est défini dans [`lib/providers/fal.ts`](lib/providers/fal.ts) : `fal-ai/flux-pro/kontext/max/multi`. Pour une variante moins coûteuse, remplace par `fal-ai/flux-pro/kontext/multi`.

### Ajouter un autre provider

Crée un fichier `lib/providers/<nom>.ts` exposant `<provider>TryOn(params, apiKey)`, puis ajoute-le au switch dans [`lib/tryOnService.ts`](lib/tryOnService.ts) :

```ts
case "replicate":
  return replicateTryOn(params, process.env.AI_TRYON_API_KEY!);
```

Providers courants :
- **fal.ai** — FLUX Kontext, IDM-VTON, Leffa (intégré par défaut)
- **Replicate** — IDM-VTON, OOTDiffusion
- **Fashn AI** — API dédiée fashion try-on
- **OpenAI** — image editing (gpt-image)

## Mode mock

Si `AI_TRYON_PROVIDER` est vide ou absent :

- Délai artificiel de **4 à 6 secondes**
- Retour de l'image [`/public/mock-result.svg`](public/mock-result.svg)
- Champ `mock: true` dans la réponse JSON

Remplacez `mock-result.svg` par un `mock-result.jpg` réaliste si vous préférez un placeholder photo.

## Structure du projet

```
app/
  api/try-on/route.ts      # API essayage (mock + provider IA)
  api/download/route.ts    # Proxy CORS pour télécharger l'image résultat
  globals.css
  layout.tsx
  page.tsx
components/
  CategoryGrid.tsx
  CategoryCard.tsx
  TryOnPanel.tsx
  PhotoGuide.tsx
  ImageUploader.tsx
  ProductInput.tsx
  LoadingExperience.tsx
  CurtainReveal.tsx
  ResultView.tsx
  scenes/                # Animations artisans SVG
lib/
  categories.ts
  tryOnService.ts          # Routeur de provider (mock / fal / autres)
  tryOnReducer.ts
  utils.ts
  providers/
    fal.ts                 # Intégration fal.ai (FLUX.1 Kontext)
types/
  index.ts
public/
  mock-result.svg
```

## Limites du MVP

- **Pas d'authentification** ni de compte utilisateur
- **Pas de base de données** — les images ne sont pas stockées côté serveur
- **Pas de paiement** ni de panier e-commerce
- **Pas d'historique** des essayages
- L'IA réelle n'est **pas intégrée** par défaut (mock uniquement)
- Les liens produit ne sont pas scrapés automatiquement
- Un seul essayage à la fois par session navigateur

## Confidentialité

- En **mode mock**, les images sont seulement validées côté serveur puis ignorées (aucune écriture disque).
- En **mode IA réel** (fal.ai par exemple), les images sont uploadées sur le storage temporaire du provider via `fal.storage.upload()`, puis le modèle génère le résultat. Consulte la politique du provider concernant la rétention. CabinesDEssayage.fr n'enregistre rien côté serveur.
- La note de confidentialité affichée dans le parcours utilisateur est mise à jour dynamiquement via `NEXT_PUBLIC_AI_PROVIDER`.

## Licence

Projet MVP — usage interne / démonstration.
