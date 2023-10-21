import fetch from "node-fetch";
import { Entity, EntityType, Profile } from "@dcl/schemas";
import { config } from "./config";

type Delta = Omit<Entity, "metadata"> & { metadata: Profile };

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

export async function getAddressesWithChanges(peerUrl: string, from: number) {
  const now = Date.now();
  const url = `${peerUrl}/content/pointer-changes?entityType=${EntityType.PROFILE}&from=${from}&to=${now}`;
  const response = await fetch(url);
  if (response.ok) {
    const data: PointerChangesResponse = await response.json();
    const addresses = new Set<string>();
    for (const profile of data.deltas) {
      for (const address of profile.pointers) {
        addresses.add(address);
      }
    }
    return { addresses: Array.from(addresses), timestamp: now };
  } else {
    const text = await response.text();
    throw new Error(`Could not load pointer changes: "${text}"`);
  }
}
