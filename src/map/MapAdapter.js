export class MapAdapter {
  constructor(mapCore) {
    this.mapCore = mapCore;
  }

  get scene() { return this.mapCore.scene; }
  get camera() { return this.mapCore.camera; }
  get renderer() { return this.mapCore.renderer; }
  get controls() { return this.mapCore.controls; }

  getHeightAt(x, z) {
    return this.mapCore.getHeightAt(x, z);
  }

  getSlopeAt(x, z) {
    return this.mapCore.getSlopeAt(x, z);
  }

  getTerrainNormalAt(x, z) {
    return this.mapCore.getTerrainNormalAt(x, z);
  }

  isWaterAt(x, z) {
    return this.mapCore.isWaterAt(x, z);
  }

  isInsideWorld(x, z, margin = 0) {
    return this.mapCore.isInsideWorld ? this.mapCore.isInsideWorld(x, z, margin) : Math.abs(x) <= this.getHalfWorldSize() - margin && Math.abs(z) <= this.getHalfWorldSize() - margin;
  }

  isBuildableAt(x, z, opts = {}) {
    return this.mapCore.isBuildableAt(x, z, opts);
  }

  getWorldSize() {
    return this.mapCore.getWorldSize();
  }

  getHalfWorldSize() {
    return this.mapCore.getHalfWorldSize();
  }

  getConfig() {
    return this.mapCore.getConfig();
  }

  getStats() {
    return this.mapCore.getStats();
  }
}
