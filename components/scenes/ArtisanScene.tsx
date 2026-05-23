"use client";

import type { AnimationType } from "@/types";
import { HatmakerScene } from "./HatmakerScene";
import { WatchmakerScene } from "./WatchmakerScene";
import { JewelerScene } from "./JewelerScene";
import { TailorScene } from "./TailorScene";
import { OpticianScene } from "./OpticianScene";

interface ArtisanSceneProps {
  type: AnimationType;
}

export function ArtisanScene({ type }: ArtisanSceneProps) {
  switch (type) {
    case "hatmaker":
      return <HatmakerScene />;
    case "watchmaker":
      return <WatchmakerScene />;
    case "jeweler":
      return <JewelerScene />;
    case "tailor":
      return <TailorScene />;
    case "optician":
      return <OpticianScene />;
    default:
      return <HatmakerScene />;
  }
}
