import fetch from "node-fetch";
import { Entity, EntityType, Profile } from "@dcl/schemas";
import { config } from "./config";

type Delta = Omit<Entity, "metadata"> & { metadata: Profile; entityId: string };

type PointerChangesResponse = {
  deltas: Delta[];
  filters: {
    entityTypes: EntityType[];
    includeAuthChain: boolean;
  };
  pagination: {
    moreData: boolean;
    limit: number;
    offset: number;
    next: string;
  };
};

export async function getProfilesWithChanges(peerUrl: string, from: number) {
  const now = Date.now();
  const url = `${peerUrl}/content/pointer-changes?entityType=${EntityType.PROFILE}&from=${from}&to=${now}`;
  const response = await fetch(url);
  if (response.ok) {
    const data: PointerChangesResponse = await response.json();
    const profiles = new Map<string, string>();
    for (const profile of data.deltas) {
      for (const address of profile.pointers) {
        profiles.set(address, profile.entityId);
      }
    }
    return { profiles: Array.from(profiles), timestamp: now };
  } else {
    const text = await response.text();
    throw new Error(`Could not load pointer changes: "${text}"`);
  }
}
