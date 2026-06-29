export class AtmosphereSystem {
  constructor({ THREE, scene, renderer, camera, sun, hemi, fill, getWorldSize, getSeed }) {
    this.THREE = THREE;
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.sun = sun;
    this.hemi = hemi;
    this.fill = fill;
    this.getWorldSize = getWorldSize;
    this.getSeed = getSeed;
    this.hour = 12;
    this.minute = 0;
    this.day = 1;
    this.weather = this.makeWeatherState(1, 12);
    this.group = new THREE.Group();
    this.group.name = 'newcore-atmosphere';
    scene.add(this.group);
    this.buildSky();
    this.buildCelestialBodies();
    this.buildClouds();
    this.buildRain();
    this.update(0);
  }

  hash(n) {
    let h = (Math.floor(n) ^ (this.getSeed?.() || 1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  makeWeatherState(day, hour) {
    const slot = Math.floor((day || 1) * 3 + (hour || 0) / 8);
    const n = this.hash(slot);
    if (n > 0.83) return { key: 'storm', label: 'Tempestade', icon: '⛈', cloud: 0.92, rain: 0.92, haze: 0.92, temperature: 23 };
    if (n > 0.66) return { key: 'rain', label: 'Chuva', icon: '🌧', cloud: 0.78, rain: 0.58, haze: 0.72, temperature: 25 };
    if (n > 0.42) return { key: 'clouds', label: 'Nublado', icon: '☁', cloud: 0.62, rain: 0.0, haze: 0.48, temperature: 28 };
    if (n > 0.22) return { key: 'haze', label: 'Bruma', icon: '🌤', cloud: 0.34, rain: 0.0, haze: 0.38, temperature: 31 };
    return { key: 'clear', label: 'Limpo', icon: '☀', cloud: 0.16, rain: 0.0, haze: 0.18, temperature: 33 };
  }

  buildSky() {
    const world = this.getWorldSize?.() || 2400;
    this.skyRadius = Math.max(9000, world * 4.4);
    const uniforms = {
      topColor: { value: new this.THREE.Color(0x8ec4ff) },
      horizonColor: { value: new this.THREE.Color(0xffba7a) },
      bottomColor: { value: new this.THREE.Color(0xd8e8df) },
      nightColor: { value: new this.THREE.Color(0x07101d) },
      sunDirection: { value: new this.THREE.Vector3(0, 1, 0) },
      dayAmount: { value: 1 },
      warmAmount: { value: 0 },
      cloudAmount: { value: 0 },
      hazeAmount: { value: 0 },
      time: { value: 0 }
    };
    const material = new this.THREE.ShaderMaterial({
      uniforms,
      side: this.THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vWorld = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorld;
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        uniform vec3 nightColor;
        uniform vec3 sunDirection;
        uniform float dayAmount;
        uniform float warmAmount;
        uniform float cloudAmount;
        uniform float hazeAmount;
        uniform float time;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 345.45));
          p += dot(p, p + 34.345);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += noise(p) * a;
            p *= 2.04;
            a *= 0.52;
          }
          return v;
        }

        void main() {
          float y = clamp(vWorld.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 daySky = mix(bottomColor, topColor, smoothstep(0.18, 1.0, y));
          daySky = mix(daySky, horizonColor, (1.0 - smoothstep(0.08, 0.48, y)) * (0.34 + warmAmount * 0.48));
          float sunGlow = pow(max(dot(normalize(vWorld), normalize(sunDirection)), 0.0), 34.0) * dayAmount;
          float horizonGlow = pow(1.0 - abs(y - 0.30), 3.0) * warmAmount * 0.18;
          daySky += vec3(1.0, 0.52, 0.18) * sunGlow * (0.72 + warmAmount * 1.15);
          daySky += vec3(1.0, 0.45, 0.16) * horizonGlow;
          float n = fbm(vWorld.xz * 4.3 + vec2(time * 0.012, time * -0.007));
          float cloud = smoothstep(0.46, 0.84, n + cloudAmount * 0.38) * cloudAmount * smoothstep(0.18, 0.72, y);
          vec3 cloudCol = mix(vec3(0.94, 0.91, 0.84), vec3(0.42, 0.47, 0.53), hazeAmount * 0.62);
          daySky = mix(daySky, cloudCol, cloud * 0.50);
          vec3 nightSky = nightColor + vec3(0.010, 0.022, 0.052) * y;
          float stars = step(0.996, hash(floor(vWorld.xz * 980.0))) * smoothstep(0.22, 0.84, y) * (1.0 - dayAmount);
          nightSky += vec3(stars);
          vec3 color = mix(nightSky, daySky, dayAmount);
          color = mix(color, vec3(0.78, 0.86, 0.88), hazeAmount * 0.14);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    });
    this.sky = new this.THREE.Mesh(new this.THREE.SphereGeometry(this.skyRadius, 64, 32), material);
    this.sky.renderOrder = -100;
    this.group.add(this.sky);
  }

  buildCelestialBodies() {
    const sunMat = new this.THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.95, depthWrite: false });
    this.sunDisc = new this.THREE.Mesh(new this.THREE.SphereGeometry(34, 24, 12), sunMat);
    this.sunGlow = new this.THREE.Mesh(
      new this.THREE.SphereGeometry(64, 24, 12),
      new this.THREE.MeshBasicMaterial({ color: 0xffb45a, transparent: true, opacity: 0.18, depthWrite: false })
    );
    const moonMat = new this.THREE.MeshBasicMaterial({ color: 0xdce7f5, transparent: true, opacity: 0.82, depthWrite: false });
    this.moonDisc = new this.THREE.Mesh(new this.THREE.SphereGeometry(24, 24, 12), moonMat);
    this.group.add(this.sunGlow, this.sunDisc, this.moonDisc);
  }

  buildClouds() {
    this.clouds = new this.THREE.Group();
    this.clouds.name = 'newcore-clouds';
    const mat = new this.THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: this.THREE.DoubleSide
    });
    for (let i = 0; i < 38; i++) {
      const g = new this.THREE.PlaneGeometry(190 + this.hash(i) * 190, 42 + this.hash(i + 99) * 64);
      const cloud = new this.THREE.Mesh(g, mat.clone());
      cloud.position.set((this.hash(i + 7) - 0.5) * 4700, 760 + this.hash(i + 17) * 220, (this.hash(i + 27) - 0.5) * 4700);
      cloud.rotation.x = -Math.PI / 2 + (this.hash(i + 37) - 0.5) * 0.12;
      cloud.rotation.z = this.hash(i + 47) * Math.PI;
      cloud.userData.drift = 2.5 + this.hash(i + 57) * 5.5;
      cloud.userData.baseOpacity = 0.10 + this.hash(i + 67) * 0.22;
      this.clouds.add(cloud);
    }
    this.group.add(this.clouds);
  }

  buildRain() {
    const count = 860;
    const geo = new this.THREE.BufferGeometry();
    const positions = new Float32Array(count * 6);
    const size = 2300;
    for (let i = 0; i < count; i++) {
      const x = (this.hash(i + 200) - 0.5) * size;
      const y = 180 + this.hash(i + 400) * 680;
      const z = (this.hash(i + 600) - 0.5) * size;
      positions[i * 6] = x; positions[i * 6 + 1] = y; positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x - 6; positions[i * 6 + 4] = y - 38; positions[i * 6 + 5] = z + 2.5;
    }
    geo.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
    this.rain = new this.THREE.LineSegments(geo, new this.THREE.LineBasicMaterial({
      color: 0xa9d7ff,
      transparent: true,
      opacity: 0,
      depthWrite: false
    }));
    this.rain.userData.count = count;
    this.group.add(this.rain);
  }

  setTimeOfDay(hour = 12, minute = 0, day = this.day) {
    this.hour = Number(hour) || 0;
    this.minute = Number(minute) || 0;
    this.day = Number(day) || 1;
    this.weather = this.makeWeatherState(this.day, this.hour);
    this.updateLighting();
    return this.getWeatherLabel();
  }

  updateLighting() {
    const h = ((this.hour || 0) + (this.minute || 0) / 60) % 24;
    const dayAmount = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
    const dawn = Math.max(0, 1 - Math.abs(h - 6) / 2.4);
    const dusk = Math.max(0, 1 - Math.abs(h - 18) / 2.4);
    const warm = Math.max(dawn, dusk);
    const sunAngle = ((h - 6) / 24) * Math.PI * 2;
    const world = this.getWorldSize?.() || 2400;
    const lightRadius = Math.max(1200, world * 0.9);
    const domeRadius = Math.max(this.skyRadius || 9000, world * 4.4);
    const sunDir = new this.THREE.Vector3(
      Math.cos(sunAngle),
      Math.max(-0.20, Math.sin(sunAngle) * 0.92),
      Math.sin(sunAngle * 0.78) * 0.62
    ).normalize();
    const sunPos = sunDir.clone().multiplyScalar(lightRadius);
    this.sun.position.copy(sunPos);
    const moonPos = sunDir.clone().multiplyScalar(-0.82);
    moonPos.y = Math.max(180, moonPos.y);
    const weatherDim = Math.max(0.64, 1 - this.weather.cloud * 0.24 - this.weather.rain * 0.14);
    this.sun.intensity = (0.72 + dayAmount * 2.62 + warm * 0.72) * weatherDim;
    this.hemi.intensity = (0.74 + dayAmount * 0.92) * (1 - this.weather.cloud * 0.05);
    this.fill.intensity = 0.42 + dayAmount * 0.44 + this.weather.cloud * 0.18;
    this.renderer.toneMappingExposure = 1.08 + dayAmount * 0.56 + warm * 0.22 - this.weather.rain * 0.040;

    const skyMat = this.sky.material;
    skyMat.uniforms.sunDirection.value.copy(sunDir);
    skyMat.uniforms.dayAmount.value = Math.min(1, dayAmount * 1.14 + warm * 0.10);
    skyMat.uniforms.warmAmount.value = warm;
    skyMat.uniforms.cloudAmount.value = this.weather.cloud;
    skyMat.uniforms.hazeAmount.value = this.weather.haze;

    const bg = new this.THREE.Color().copy(skyMat.uniforms.nightColor.value).lerp(skyMat.uniforms.topColor.value, skyMat.uniforms.dayAmount.value);
    bg.lerp(new this.THREE.Color(0x9fa8a6), this.weather.haze * 0.15);
    this.scene.background = bg;
    if (this.scene.fog) {
      this.scene.fog.color.copy(bg);
      this.scene.fog.density = 0.000050 + (1 - dayAmount) * 0.000075 + this.weather.haze * 0.000080 + this.weather.rain * 0.000068;
    }

    this.sunDisc.position.copy(sunDir).multiplyScalar(domeRadius * 0.72);
    this.sunGlow.position.copy(this.sunDisc.position);
    this.sunDisc.visible = dayAmount > 0.04;
    this.sunGlow.visible = dayAmount > 0.04;
    this.sunDisc.material.opacity = Math.max(0, 0.90 - this.weather.cloud * 0.65) * dayAmount;
    this.sunGlow.material.opacity = Math.max(0, 0.34 - this.weather.cloud * 0.17) * dayAmount;
    this.moonDisc.position.copy(moonPos).normalize().multiplyScalar(domeRadius * 0.70);
    this.moonDisc.visible = dayAmount < 0.42;
    this.moonDisc.material.opacity = (1 - dayAmount) * (0.74 - this.weather.cloud * 0.35);

    this.updateWeatherObjects(0);
  }

  updateWeatherObjects(dt) {
    const cloudOpacity = 0.12 + this.weather.cloud * 0.56;
    for (const cloud of this.clouds.children) {
      cloud.visible = this.weather.cloud > 0.08;
      cloud.material.opacity = cloud.userData.baseOpacity * cloudOpacity;
      cloud.position.x += (cloud.userData.drift || 2) * dt;
      const limit = Math.max(2400, (this.getWorldSize?.() || 2400) * 1.18);
      if (cloud.position.x > limit) cloud.position.x = -limit;
    }
    this.rain.visible = this.weather.rain > 0.05;
    this.rain.material.opacity = this.weather.rain * 0.56;
    if (this.weather.rain > 0.05 && dt > 0) {
      const pos = this.rain.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) {
        const y = pos.getY(i) - dt * 360;
        const reset = y < 20;
        const ny = reset ? 820 + this.hash(i + Math.floor(this.day * 31)) * 260 : y;
        pos.setY(i, ny);
        pos.setY(i + 1, ny - 38);
      }
      pos.needsUpdate = true;
    }
  }

  update(dt = 0) {
    if (this.camera) this.group.position.copy(this.camera.position);
    if (this.sky?.material?.uniforms?.time) this.sky.material.uniforms.time.value += dt || 0;
    this.updateWeatherObjects(dt || 0);
  }

  setFogEnabled(enabled) {
    if (enabled && !this.scene.fog) this.scene.fog = new this.THREE.FogExp2(0xb8cad4, 0.00014);
    if (!enabled) this.scene.fog = null;
    this.updateLighting();
  }

  getWeatherLabel() {
    const temp = Math.round((this.weather.temperature || 28) - Math.max(0, Math.abs(this.hour - 14)) * 0.35);
    return `${this.weather.icon} ${this.weather.label} ${temp}°C`;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(obj => {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach(mat => mat.dispose?.());
      else obj.material?.dispose?.();
    });
  }
}
