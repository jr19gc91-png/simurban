export class AssetRegistry {
  constructor() {
    this.buildingPacks = new Map();
  }

  registerBuildingPack(pack) {
    if (!pack?.id) throw new Error('Building pack precisa de id.');
    if (!Array.isArray(pack.definitions)) throw new Error('Building pack precisa de definitions[].');
    this.buildingPacks.set(pack.id, pack);
    return pack;
  }

  listBuildingPacks() {
    return [...this.buildingPacks.values()].map(pack => ({
      id: pack.id,
      name: pack.name,
      version: pack.version,
      count: pack.definitions.length
    }));
  }

  getBuildingDefinitions(filter = {}) {
    const defs = [];
    for (const pack of this.buildingPacks.values()) {
      for (const def of pack.definitions) {
        if (filter.zone && def.zone !== filter.zone) continue;
        if (filter.density && def.density !== filter.density) continue;
        defs.push({ ...def, packId: pack.id });
      }
    }
    return defs;
  }
}
