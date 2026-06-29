import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AtmosphereSystem } from './AtmosphereSystem.js';
import { METERS_PER_UNIT, UNITS_PER_METER, kmToWorldUnits } from '../utils/Scale.js';

export const NEWCORE_VERSION = 'TerraNova-NewCore-v2.4.20-tmpe-connectors-phases-priority-5m';

export class MapGenerator {
  constructor({ mount = document.body } = {}) {
    const TWO_PI = Math.PI * 2;
    const BASE_WORLD = kmToWorldUnits(20);
    let MAP_KM = 20;
    let WORLD = BASE_WORLD;
    let HALF = WORLD / 2;
    let GRID = isMobile() ? 132 : 148;
    const SEA_LEVEL = -8;
    const DEFAULTS = { seed:1905502357, mapSizeKm:20, mountains:72, rivers:78, coast:62, plains:56, roughness:54, forest:70, rocks:82, details:74, showTrees:true, showRocks:true, showDetails:true, showFog:true };
    let PARAMS = {...DEFAULTS};
    let CURRENT_SEED = DEFAULTS.seed;
    let rng = mulberry32(CURRENT_SEED);
    let riverDefs = [];
    let worldGroup = null;
    let waterMeshes = [];
    let waterDetailMeshes = [];
    let sea = null;
    let seaCells = [];
    let terrainHeights = null;
    let waterSources = [];
    let waterDrains = [];
    let mountainDefs = [];
    let lastStats = {build:0,min:0,max:0,rivers:0,objects:0};

    function isMobile(){ return Math.min(innerWidth, innerHeight) < 820; }
    function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
    function lerp(a,b,t){ return a + (b-a) * t; }
    function smoothstep(e0,e1,x){ const t=clamp((x-e0)/(e1-e0),0,1); return t*t*(3-2*t); }
    function mulberry32(seed){ return function(){ let t=seed+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }
    function hash2(ix, iz){ let h = Math.imul(ix|0, 374761393) ^ Math.imul(iz|0, 668265263) ^ CURRENT_SEED; h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
    function valueNoise(x,z){ const ix=Math.floor(x), iz=Math.floor(z); const fx=x-ix, fz=z-iz; const sx=fx*fx*(3-2*fx), sz=fz*fz*(3-2*fz); const a=hash2(ix,iz), b=hash2(ix+1,iz), c=hash2(ix,iz+1), d=hash2(ix+1,iz+1); return lerp(lerp(a,b,sx), lerp(c,d,sx), sz); }
    function fbm(x,z,oct=5){ let v=0, amp=0.5, freq=1, norm=0; for(let i=0;i<oct;i++){ v += (valueNoise(x*freq,z*freq)*2-1)*amp; norm+=amp; amp*=0.52; freq*=2.04; } return v/Math.max(.0001,norm); }
    function mixColor(a,b,t){ return new THREE.Color(a).lerp(new THREE.Color(b), clamp(t,0,1)); }
    function pct(k){ return clamp((PARAMS[k]||0)/100,0,1); }
    function worldScale(){ return WORLD / BASE_WORLD; }
    function applyMapMetrics(km){
      MAP_KM = km;
      const t = clamp((km - 10) / 20, 0, 1);
      WORLD = kmToWorldUnits(km);
      HALF = WORLD / 2;
      GRID = Math.round((isMobile()?132:156) * lerp(0.78, 1.42, t));
      camera.far = Math.max(WORLD * 6.0, 14000);
      camera.updateProjectionMatrix();
      controls.maxDistance = WORLD * 1.55;
      sun.shadow.camera.left = -WORLD * 0.62;
      sun.shadow.camera.right = WORLD * 0.62;
      sun.shadow.camera.top = WORLD * 0.62;
      sun.shadow.camera.bottom = -WORLD * 0.62;
      sun.shadow.camera.far = WORLD * 1.4;
      sun.shadow.camera.updateProjectionMatrix();
      document.querySelectorAll('.sizebtn').forEach(btn=>btn.classList.toggle('active', Number(btn.dataset.size)===km));
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(43, innerWidth/innerHeight, 1, 14000);
    camera.position.set(-1380, 960, 1480);

    const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile()?1.35:1.75));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = 1.12;
    (mount || document.body).appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .075;
    controls.minDistance = 32;
    controls.maxDistance = 5200;
    controls.zoomSpeed = 1.25;
    controls.maxPolarAngle = Math.PI/2 - .02;
    // Controles estilo city builder: botão direito gira, clique/arrasto do scroll também gira e inclina, roda zoom.
    // O botão esquerdo fica livre para as ferramentas de construção.
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE };
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.zoomToCursor = false;
    controls.target.set(70, 10, 40);
    controls.update();

    const hemi = new THREE.HemisphereLight(0xf6eddc, 0x223229, 0.86);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe2bd, 2.35);
    sun.position.set(120, 980, 620);
    sun.castShadow = true;
    sun.shadow.mapSize.set(isMobile()?2048:3072, isMobile()?2048:3072);
    sun.shadow.camera.left = -1500; sun.shadow.camera.right = 1500; sun.shadow.camera.top = 1500; sun.shadow.camera.bottom = -1500; sun.shadow.camera.near = 50; sun.shadow.camera.far = 3200;
    sun.shadow.bias = -0.00042;
    sun.shadow.normalBias = 0.016;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xacc8ff, 0.44);
    fill.position.set(-760, 420, -520);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0x7da0ff, 0.22);
    rim.position.set(-420, 680, 860);
    scene.add(rim);

    const atmosphere = new AtmosphereSystem({ THREE, scene, renderer, camera, sun, hemi, fill, getWorldSize: () => WORLD, getSeed: () => CURRENT_SEED });

    const tex = {
      terrain: makeTerrainTexture(), terrainBump: makeTerrainBumpTexture(), rock: makeRockTexture(), rockBump: makeRockBumpTexture(), gravel: makeGravelTexture(), sand: makeSandTexture(), water: makeWaterTexture(), grass: makeGrassTexture(), mud: makeMudTexture()
    };
    for(const t of Object.values(tex)){ if(t){ t.colorSpace = THREE.SRGBColorSpace; t.wrapS=t.wrapT=THREE.RepeatWrapping; t.needsUpdate=true; } }
    if(THREE.NoColorSpace){ tex.terrainBump.colorSpace = THREE.NoColorSpace; tex.rockBump.colorSpace = THREE.NoColorSpace; }
    tex.terrain.repeat.set(9,9); tex.terrainBump.repeat.set(9,9); tex.rock.repeat.set(4,4); tex.rockBump.repeat.set(4,4); tex.gravel.repeat.set(6,6); tex.sand.repeat.set(8,8); tex.water.repeat.set(3.2,3.2); tex.grass.repeat.set(10,10); tex.mud.repeat.set(6,6);


    const keyboardState = new Set();
    const isEditableTarget = (el) => {
      if (!el) return false;
      const tag = (el.tagName || '').toUpperCase();
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const translateCamera = (dx, dz) => {
      if (!dx && !dz) return;
      camera.position.x += dx;
      camera.position.z += dz;
      controls.target.x += dx;
      controls.target.z += dz;
    };
    const updateCityLikeCamera = (dt) => {
      const panSpeed = (230 + controls.getDistance() * 0.30) * dt;
      const viewDir = new THREE.Vector3();
      camera.getWorldDirection(viewDir);
      viewDir.y = 0;
      if (viewDir.lengthSq() < 0.0001) viewDir.set(0, 0, -1);
      viewDir.normalize();
      const rightDir = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      rightDir.y = 0;
      if (rightDir.lengthSq() < 0.0001) rightDir.set(1, 0, 0);
      rightDir.normalize();
      let moveForward = 0;
      let moveRight = 0;
      // Igual ao jogo antigo: W/seta ↑ avança a câmera na direção do olhar;
      // S/seta ↓ recua; A/D deslocam lateralmente sem inverter.
      if (keyboardState.has('KeyW') || keyboardState.has('ArrowUp')) moveForward += 1;
      if (keyboardState.has('KeyS') || keyboardState.has('ArrowDown')) moveForward -= 1;
      if (keyboardState.has('KeyD') || keyboardState.has('ArrowRight')) moveRight += 1;
      if (keyboardState.has('KeyA') || keyboardState.has('ArrowLeft')) moveRight -= 1;
      if (moveForward || moveRight) {
        const delta = new THREE.Vector3()
          .addScaledVector(viewDir, moveForward)
          .addScaledVector(rightDir, moveRight);
        if (delta.lengthSq() > 0.0001) {
          delta.normalize().multiplyScalar(panSpeed);
          translateCamera(delta.x, delta.z);
        }
      }
      const rotSpeed = 1.4 * dt;
      if (keyboardState.has('KeyQ')) controls.rotateLeft(rotSpeed);
      if (keyboardState.has('KeyE')) controls.rotateLeft(-rotSpeed);
    };
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (isEditableTarget(e.target)) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      keyboardState.add(e.code);
    });
    window.addEventListener('keyup', (e) => keyboardState.delete(e.code));
    window.addEventListener('blur', () => keyboardState.clear());

    const MAT = {
      terrain: new THREE.MeshStandardMaterial({ map:tex.terrain, bumpMap:tex.terrainBump, bumpScale:1.65, vertexColors:true, roughness:.985, metalness:0.0, flatShading:false }),
      water: new THREE.MeshStandardMaterial({ map:tex.water, color:0x167cad, roughness:.18, metalness:0.0, transparent:true, opacity:.78, side:THREE.DoubleSide, depthWrite:true }),
      river: new THREE.MeshStandardMaterial({ map:tex.water, color:0x1f8fc0, roughness:.16, metalness:0.0, transparent:true, opacity:.82, side:THREE.DoubleSide, depthWrite:true }),
      waterBed: new THREE.MeshStandardMaterial({ color:0x0b4d73, roughness:1, transparent:true, opacity:.26, side:THREE.DoubleSide }),
      foam: new THREE.MeshBasicMaterial({ color:0xd9eef4, transparent:true, opacity:.15, depthWrite:false, side:THREE.DoubleSide, toneMapped:false }),
      current: new THREE.MeshBasicMaterial({ color:0xdff4f7, transparent:true, opacity:.07, depthWrite:false, side:THREE.DoubleSide, toneMapped:false }),
      rock: new THREE.MeshStandardMaterial({ map:tex.rock, bumpMap:tex.rockBump, bumpScale:4.2, color:0x918c84, roughness:.96, flatShading:true }),
      rockDark: new THREE.MeshStandardMaterial({ map:tex.rock, bumpMap:tex.rockBump, bumpScale:4.8, color:0x5f5d59, roughness:.98, flatShading:true }),
      cliffWarm: new THREE.MeshStandardMaterial({ map:tex.rock, bumpMap:tex.rockBump, bumpScale:3.4, color:0xa29279, roughness:.97, flatShading:true }),
      rockSkin: new THREE.MeshStandardMaterial({ map:tex.rock, bumpMap:tex.rockBump, bumpScale:2.6, color:0x8c8578, roughness:.98, transparent:true, opacity:.96, side:THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 }),
      gravel: new THREE.MeshStandardMaterial({ map:tex.gravel, color:0x777267, roughness:1, transparent:true, opacity:.78, depthWrite:false, side:THREE.DoubleSide, flatShading:false }),
      sand: new THREE.MeshStandardMaterial({ map:tex.sand, color:0xd7c18d, roughness:.98, flatShading:false }),
      mud: new THREE.MeshStandardMaterial({ map:tex.mud, color:0x7e6344, roughness:1 }),
      trunk: new THREE.MeshStandardMaterial({ color:0x69432d, roughness:.92, flatShading:true }), trunkLight: new THREE.MeshStandardMaterial({ color:0x80583a, roughness:.9, flatShading:true }),
      leaf1: new THREE.MeshStandardMaterial({ color:0x3f7f3c, roughness:1, flatShading:true }), leaf2: new THREE.MeshStandardMaterial({ color:0x2f6f36, roughness:1, flatShading:true }), leaf3: new THREE.MeshStandardMaterial({ color:0x557f3a, roughness:1, flatShading:true }), leaf4: new THREE.MeshStandardMaterial({ color:0x6f8845, roughness:1, flatShading:true }),
      flowerPink: new THREE.MeshStandardMaterial({ color:0xb76677, roughness:.95, flatShading:true }), flowerYellow: new THREE.MeshStandardMaterial({ color:0xd9ad43, roughness:.95, flatShading:true }), palmLeaf: new THREE.MeshStandardMaterial({ color:0x386a3f, roughness:1, flatShading:true })
    };


    function quantKey(x,z,step){ return `${Math.round(x/step)}:${Math.round(z/step)}`; }
    function hydroBaseHeight(x,z){ return baseHeight(x,z); }
    function waterCellStep(){ return WORLD / (GRID - 1) * 1.12; }
    function lowestWaterDrains(){
      const drains=[];
      const n=96;
      for(let i=0;i<n;i++){
        const t=i/(n-1);
        const pts=[[-HALF+t*WORLD,-HALF],[-HALF+t*WORLD,HALF],[-HALF,-HALF+t*WORLD],[HALF,-HALF+t*WORLD]];
        for(const [x,z] of pts){
          const y=hydroBaseHeight(x,z);
          const coast=coastBandAt(x,z);
          drains.push({x,z,y,coast,score:y - coast*42});
        }
      }
      drains.sort((a,b)=>a.score-b.score);
      return drains.slice(0,24);
    }
    function chooseDrainForSource(src, drains){
      let best=drains[0], bestScore=1e9;
      for(const d of drains){
        const dist=Math.hypot(d.x-src.x,d.z-src.z);
        const downhill = src.y - d.y;
        const score = dist*.038 + d.y*1.35 - d.coast*36 - downhill*.18;
        if(score<bestScore){ bestScore=score; best=d; }
      }
      return best;
    }
    function distToRiverSamples(x,z,list){
      let best=1e9, river=null, sample=null;
      for(const r of list){
        for(const s of r.samples||[]){ const d=Math.hypot(x-s.x,z-s.z); if(d<best){ best=d; river=r; sample=s; } }
      }
      return {d:best,river,sample};
    }
    function simplifyCourse(points,minDist){
      if(points.length<3) return points;
      const out=[points[0]];
      for(let i=1;i<points.length-1;i++){
        const p=points[i], last=out[out.length-1];
        if(Math.hypot(p[0]-last[0],p[1]-last[1])>=minDist) out.push(p);
      }
      out.push(points[points.length-1]);
      return out;
    }
    function traceWaterCourse(source, drain, built, idxSeed){
      const step=waterCellStep();
      const points=[[source.x,source.z]];
      const visited=new Set([quantKey(source.x,source.z,step)]);
      let x=source.x, z=source.z, px=0, pz=0;
      let mergedInto=null, reachedDrain=false;
      for(let i=0;i<340;i++){
        const y=hydroBaseHeight(x,z);
        const edgeDist=HALF-Math.max(Math.abs(x),Math.abs(z));
        const existing=distToRiverSamples(x,z,built);
        if(existing.river && existing.d < Math.max(12, existing.sample.w*.85) && points.length>8){
          points.push([existing.sample.x, existing.sample.z]); mergedInto=existing.river; break;
        }
        if((y<=SEA_LEVEL+1.2 && coastBandAt(x,z)>.10) || edgeDist<step*.85){ reachedDrain=true; break; }
        const targetAngle=Math.atan2(drain.z-z, drain.x-x);
        const meander=(hash2(idxSeed*71+i*9, idxSeed*37+i*13)-.5)*0.62;
        let best=null;
        for(let k=0;k<18;k++){
          const fan=((k/17)-.5)*Math.PI*1.52;
          const a=targetAngle + meander + fan;
          const dx=Math.cos(a), dz=Math.sin(a);
          const nx=x+dx*step, nz=z+dz*step;
          if(nx<-HALF*1.015||nx>HALF*1.015||nz<-HALF*1.015||nz>HALF*1.015) continue;
          const ny=hydroBaseHeight(nx,nz);
          const drop=y-ny;
          const toDrain=Math.hypot(drain.x-nx,drain.z-nz);
          const turnPenalty=(px||pz)?(1-(px*dx+pz*dz))*7.5:0;
          const revisit=visited.has(quantKey(nx,nz,step))?140:0;
          const coastPull=coastBandAt(nx,nz)*20;
          const edgePull=smoothstep(HALF*.55,HALF*.98,Math.max(Math.abs(nx),Math.abs(nz)))*7;
          const uphillPenalty=Math.max(0,-drop)*13.0;
          const erosionBonus=Math.max(0,drop)*3.1;
          const score=ny*.78+toDrain*.045+turnPenalty+revisit+uphillPenalty-erosionBonus-coastPull-edgePull;
          if(!best||score<best.score) best={nx,nz,ny,dx,dz,score};
        }
        if(!best) break;
        x=best.nx; z=best.nz; px=best.dx; pz=best.dz;
        const key=quantKey(x,z,step);
        if(visited.has(key)) break;
        visited.add(key); points.push([x,z]);
        if(Math.hypot(drain.x-x,drain.z-z)<step*1.2){ points.push([drain.x,drain.z]); reachedDrain=true; break; }
      }
      if(!mergedInto && !reachedDrain){
        const last=points[points.length-1];
        const edgeX=Math.abs(last[0])>Math.abs(last[1])?Math.sign(last[0])*HALF:last[0];
        const edgeZ=Math.abs(last[1])>=Math.abs(last[0])?Math.sign(last[1])*HALF:last[1];
        points.push([edgeX,edgeZ]);
      }
      return {points:simplifyCourse(points,step*1.08), mergedInto, reachedDrain};
    }
    function riverSourceCandidates(targetCount){
      const c=[];
      const tries=Math.max(260,targetCount*150);
      for(let i=0;i<tries;i++){
        const x=lerp(-HALF*.90,HALF*.90,rng()), z=lerp(-HALF*.90,HALF*.90,rng());
        const y=hydroBaseHeight(x,z), slope=slopeAt(x,z), rocky=rockyMountainMask(x,z,y,slope), coast=coastBandAt(x,z);
        if(y<lerp(75,180,pct('mountains'))) continue;
        if(slope<2 || slope>36 || coast>.72) continue;
        c.push({x,z,y,flow:lerp(.55,1.20,hash2(i*23+7,i*19+3)),score:y+rocky*130+Math.max(0,slope-4)*4-coast*54});
      }
      if(c.length<targetCount){
        for(let iz=0;iz<10;iz++) for(let ix=0;ix<10;ix++){
          const x=lerp(-HALF*.88,HALF*.88,(ix+.5)/10), z=lerp(-HALF*.88,HALF*.88,(iz+.5)/10);
          const y=hydroBaseHeight(x,z), slope=slopeAt(x,z);
          if(y>SEA_LEVEL+48 && coastBandAt(x,z)<.78) c.push({x,z,y,flow:.65,score:y+slope*3});
        }
      }
      c.sort((a,b)=>b.score-a.score); return c;
    }
    function rebuildRiverDefs(){
      const rp=pct('rivers');
      riverDefs=[]; waterSources=[]; waterDrains=[];
      if(rp<.05) return;
      const target=clamp(Math.round(lerp(1,8,rp)),1,8);
      const widthScale=Math.pow(worldScale(),.82);
      const drains=lowestWaterDrains(); waterDrains=drains;
      const sources=riverSourceCandidates(target);
      const used=[], built=[];
      for(let i=0;i<sources.length && built.length<target;i++){
        const s=sources[i];
        if(used.some(u=>Math.hypot(u.x-s.x,u.z-s.z)<WORLD*.14)) continue;
        const drain=chooseDrainForSource(s,drains);
        riverDefs=built;
        const traced=traceWaterCourse(s,drain,built,i+1);
        const len=traced.points.reduce((acc,p,idx,arr)=>idx?acc+Math.hypot(p[0]-arr[idx-1][0],p[1]-arr[idx-1][1]):0,0);
        if(traced.points.length<4 || len<WORLD*.14) continue;
        const downstream=clamp(len/(WORLD*.72),0,1);
        const flow=s.flow+downstream*.45;
        const width0=lerp(6.5,12.0,hash2(i*29+3,i*17+7))*widthScale*flow;
        const width1=lerp(22,56,downstream)*lerp(.92,1.18,hash2(i*31+9,i*37+11))*widthScale*flow;
        const r={name:`Rio ${built.length+1}`,flow,width0,width1,points:traced.points,mergedInto:traced.mergedInto,source:s,drain,flowSign:1};
        r.curve=new THREE.CatmullRomCurve3(traced.points.map(p=>new THREE.Vector3(p[0],0,p[1])),false,'catmullrom',0.35);
        r.samples=[];
        const n=200;
        for(let j=0;j<=n;j++){const t=j/n; const p=r.curve.getPoint(t); const w=lerp(r.width0,r.width1,Math.pow(t,.84))*r.flow; r.samples.push({x:p.x,z:p.z,t,width:w,w});}
        built.push(r); used.push(s); waterSources.push(s);
        if(traced.mergedInto){ traced.mergedInto.flow+=flow*.22; traced.mergedInto.width1+=width1*.14; }
      }
      riverDefs=built;
    }
    function distToRivers(x,z){
      let best=1e9, bestRiver=null, bestT=0, bestW=1;
      for(const r of riverDefs){ for(const s of r.samples){ const d=Math.hypot(x-s.x,z-s.z); if(d<best){ best=d; bestRiver=r; bestT=s.t; bestW=s.width; } } }
      return {d:best, river:bestRiver, t:bestT, w:bestW};
    }
    function mountainMass(x,z,cx,cz,sx,sz,power=2.2){ const dx=(x-cx)/sx, dz=(z-cz)/sz; const d=Math.sqrt(dx*dx + dz*dz); return Math.pow(Math.max(0, 1-d), power); }
    function rebuildMountainDefs(){
      mountainDefs = [];
      const count = 4 + Math.floor(hash2(911, 1207) * 3); // 4 a 6 maciços
      for(let i=0;i<count;i++){
        const h1 = hash2(1000+i*31, 2000+i*17);
        const h2 = hash2(1100+i*29, 2100+i*13);
        const h3 = hash2(1200+i*23, 2200+i*19);
        const h4 = hash2(1300+i*41, 2300+i*11);
        const h5 = hash2(1400+i*37, 2400+i*31);
        let cx, cz;
        if(h1 < .58){
          const side = Math.floor(h2*4);
          const along = lerp(-HALF*1.05, HALF*1.05, h3);
          const out = lerp(HALF*.96, HALF*1.34, h4);
          if(side===0){ cx = along; cz = -out; }
          else if(side===1){ cx = out; cz = along; }
          else if(side===2){ cx = along; cz = out; }
          else { cx = -out; cz = along; }
        }else{
          cx = lerp(-HALF*.82, HALF*.82, h2);
          cz = lerp(-HALF*.82, HALF*.82, h3);
        }
        const sx = HALF * lerp(.36,.92,h4);
        const sz = HALF * lerp(.34,.86,h5);
        const power = lerp(1.85, 2.72, hash2(1500+i*43, 2500+i*7));
        const amp = lerp(.72, 1.38, hash2(1600+i*47, 2600+i*5));
        mountainDefs.push({cx,cz,sx,sz,power,amp});
      }
    }
    function mountainProfile(x,z){
      if(!mountainDefs.length) rebuildMountainDefs();
      const vals = mountainDefs.map(d => mountainMass(x,z,d.cx,d.cz,d.sx,d.sz,d.power) * d.amp);
      const all = vals.reduce((a,b)=>Math.max(a,b),0);
      return {
        west: vals[0] || 0,
        east: vals[1] || 0,
        northWest: vals[2] || 0,
        southEast: vals[3] || 0,
        extraA: vals[4] || 0,
        extraB: vals[5] || 0,
        all
      };
    }
    function rockyMountainMask(x,z,y,slope=0){
      const nx=x/WORLD+.5, nz=z/WORLD+.5;
      const mp = mountainProfile(x,z);
      const massif = Math.max(mp.all || 0, mp.west, mp.east*.92, mp.northWest*.88, (mp.southEast||0)*.86);
      const ridge = fbm(nx*5.8+11.2, nz*5.6-4.8, 4)*.5 + .5;
      const fractures = fbm(nx*11.5-7.0, nz*11.2+3.0, 3)*.5 + .5;
      const high = smoothstep(135, 360, y);
      const steep = smoothstep(8, 30, slope || 0);
      const mask = massif * (0.38 + ridge*.72) * (0.34 + fractures*.36) * (0.45 + high*.75) * (0.30 + steep*.90) * lerp(.55,1.28,pct('rocks'));
      return clamp(mask,0,1);
    }
    function isCoastalCandidate(x,z,y,slope=0){
      const nx=x/WORLD+.5, nz=z/WORLD+.5;
      const coastBand = Math.max(smoothstep(.60, .98, nx), smoothstep(.68, .98, nz), smoothstep(0.018, 0.055, Math.min(nx,1-nx,nz,1-nz)));
      return y > SEA_LEVEL-1.8 && y < SEA_LEVEL + 9.5 && slope < 12 && coastBand > .32;
    }
    function baseHeight(x,z){
      const nx=x/WORLD+.5, nz=z/WORLD+.5;
      const edge = Math.min(nx, 1-nx, nz, 1-nz);
      const coastEast = smoothstep(0.58, 1.02, nx);
      const coastSouth = smoothstep(0.66, 1.02, nz);
      const coastLower = Math.max(coastEast*.75, coastSouth*.55) * lerp(.30,1.35,pct('coast'));
      const rough = lerp(.55,1.35,pct('roughness'));
      const mAmp = lerp(.12,1.32,pct('mountains'));
      const n1=fbm(nx*3.1+2.8,nz*3.1-1.2,5), n2=fbm(nx*7.4-1.5,nz*7.2+4.3,4), n3=fbm(nx*16.0+7.0,nz*15.0-3.0,3);
      const mp=mountainProfile(x,z), m1=mp.west, m2=mp.east, m3=mp.northWest, m4=(mp.southEast||0), m5=(mp.extraA||0), m6=(mp.extraB||0);
      const ridge=Math.max(0, fbm(nx*4.4+5,nz*4.4+1,5)*.5+.5);
      let h = 10 + n1*54*rough + n2*20*rough + n3*7*rough;
      h += m1*(335 + ridge*115)*mAmp + m2*(285 + ridge*95)*mAmp + m3*(245 + ridge*80)*mAmp + m4*(220 + ridge*74)*mAmp + m5*(190 + ridge*62)*mAmp + m6*(170 + ridge*55)*mAmp;
      const massif = Math.max(mp.all||0, m1, m2*.92, m3*.88, m4*.82, m5*.76, m6*.72);
      const ridgeNoise = 1 - Math.abs(fbm(nx*6.1-4.3, nz*6.0+2.1, 4));
      const spurNoise = fbm(nx*9.8+6.4, nz*9.2-3.8, 3)*.5 + .5;
      const erosionChannels = smoothstep(.38,.92, fbm(nx*13.5-8.0,nz*13.2+5.0,4)*.5+.5);
      h += massif * (ridgeNoise-.5) * 46 * mAmp;
      h -= massif * smoothstep(.28,.90,spurNoise) * 15 * lerp(.55,1.05,pct('roughness'));
      h -= massif * erosionChannels * 11 * lerp(.45,1.10,pct('roughness'));
      h += (n1*n2) * 10 * rough;
      h -= coastLower*95;
      const edgeMountain = Math.max(mp.all||0, m1, m2*.88, m3*.90, m4*.82, m5*.76, m6*.72);
      const edgeProtect = smoothstep(.08, .52, edgeMountain);
      const edgeZone = smoothstep(0.000, lerp(.026,.010,edgeProtect), edge);
      const edgeNoise = fbm(nx*12.0+4.0,nz*12.0-6.0,4) * 18 + fbm(nx*27.0-2.0,nz*25.0+3.0,3) * 7;
      const edgeFloor = lerp(-18 + edgeNoise, 26 + edgeNoise*.45, edgeProtect);
      h = lerp(edgeFloor, h, edgeZone);
      const rv = distToRivers(x,z);
      if(rv.river){
        const valleyW = rv.w * 4.2 + 38;
        const channelW = rv.w * 1.08;
        const valley = smoothstep(valleyW, 0, rv.d);
        const channel = smoothstep(channelW, 0, rv.d);
        h -= valley * (10 + rv.w*.20) * lerp(.65,1.18,pct('rivers'));
        h -= channel * (5 + rv.w*.14) * lerp(.65,1.2,pct('rivers'));
        const plainStrength = pct('plains');
        const plain = smoothstep(rv.w*3.2 + 56, rv.w*.9 + 22, rv.d) * smoothstep(175, 28, Math.abs(h-SEA_LEVEL-40));
        h = lerp(h, Math.round(h/8)*8, plain*(.08+plainStrength*.42));
      }
      const globalPlain = pct('plains') * .18 * smoothstep(80, 14, Math.abs(h-SEA_LEVEL-36)) * (1-smoothstep(24,55,Math.abs(n1*50)));
      h = lerp(h, Math.round(h/10)*10, globalPlain);
      return h;
    }
    function terrainHeight(x,z){ return baseHeight(x,z); }
    function terrainNormalApprox(x,z){ const e=8; const hL=terrainHeight(x-e,z), hR=terrainHeight(x+e,z), hD=terrainHeight(x,z-e), hU=terrainHeight(x,z+e); return new THREE.Vector3(hL-hR, 2*e, hD-hU).normalize(); }
    function slopeAt(x,z){ const n=terrainNormalApprox(x,z); return Math.acos(clamp(n.y,-1,1))*180/Math.PI; }
    function coastBandAt(x,z){ const nx=x/WORLD+.5, nz=z/WORLD+.5; return Math.max(smoothstep(.60, .98, nx), smoothstep(.68, .98, nz), smoothstep(0.018, 0.055, Math.min(nx,1-nx,nz,1-nz))); }

    function disposeObject(obj){ obj.traverse(o=>{ if(o.geometry) o.geometry.dispose(); }); }
    function rebuildWorld(){
      PARAMS = readUI();
      applyMapMetrics(PARAMS.mapSizeKm);
      CURRENT_SEED = PARAMS.seed >>> 0;
      rng = mulberry32(CURRENT_SEED);
      rebuildMountainDefs();
      rebuildRiverDefs();
      waterMeshes = [];
      waterDetailMeshes = [];
      sea = null;
      seaCells = [];
      terrainHeights = null;
      if(worldGroup){ scene.remove(worldGroup); disposeObject(worldGroup); }
      worldGroup = new THREE.Group();
      worldGroup.name = 'generated-map';
      scene.add(worldGroup);
      buildTerrain(worldGroup);
      addMapBase(worldGroup);
      addSea(worldGroup);
      addCoastalBeaches(worldGroup);
      addRiverSystems(worldGroup);
      let objects = 0;
      if(PARAMS.showTrees || PARAMS.showRocks) objects += addForestAndRocks(worldGroup);
      if(PARAMS.showDetails) objects += addSmallDetails(worldGroup);
      lastStats.rivers = riverDefs.length;
      lastStats.objects = objects;
      updateStats();
      atmosphere.setFogEnabled(PARAMS.showFog);
    }
    function buildTerrain(group){
      const verts=[], colors=[], uvs=[], indices=[];
      terrainHeights = new Float32Array(GRID*GRID);
      const color = new THREE.Color();
      let minY=1e9,maxY=-1e9,buildable=0,total=0;
      for(let iz=0; iz<GRID; iz++){
        const z = -HALF + (iz/(GRID-1))*WORLD;
        for(let ix=0; ix<GRID; ix++){
          const x = -HALF + (ix/(GRID-1))*WORLD;
          const y = terrainHeight(x,z);
          terrainHeights[iz*GRID + ix] = y;
          verts.push(x,y,z); uvs.push(ix/(GRID-1)*8, iz/(GRID-1)*8);
          minY=Math.min(minY,y); maxY=Math.max(maxY,y); total++;
          const rv=distToRivers(x,z); const slope=slopeAt(x,z); const nx=x/WORLD+.5, nz=z/WORLD+.5;
          if(y>SEA_LEVEL+10 && slope<10.5) buildable++;
          const shore = Math.abs(y-SEA_LEVEL);
          const beachBySea = isCoastalCandidate(x,z,y,slope) && pct('coast') > .04;
          const riverBank = rv.river && rv.d < rv.w*2.6 + 12 && y > SEA_LEVEL - 4;
          const high = smoothstep(150, 345, y), alpine = smoothstep(240, 430, y), cliff = smoothstep(18, 43, slope);
          const rockyMass = rockyMountainMask(x,z,y,slope);
          const rock = Math.max(Math.max(smoothstep(170, 330, y) * cliff, smoothstep(300, 440, y) * .66) * lerp(.75,1.18,pct('rocks')), rockyMass * 1.08);
          const forestTone = valueNoise(x*.006+13,z*.006-5), dryTone = valueNoise(x*.011-4,z*.010+8), mossTone = fbm(x*.018+9,z*.018-2,3)*.5+.5;
          if(beachBySea){ color.set(0xd2bf91).lerp(new THREE.Color(0xe6d6a6), valueNoise(x*.025,z*.025)); color.lerp(new THREE.Color(0xc9b27e), smoothstep(0,10,shore)*.18); }
          else if(rv.river && rv.d < rv.w*1.15){ color.set(0x3d6968).lerp(new THREE.Color(0x6f8a79), .32); }
          else if(riverBank){ color.set(0x806c4d).lerp(new THREE.Color(0xb4a674), .32+forestTone*.28); }
          else if(rock>.26){ color.set(0x696861).lerp(new THREE.Color(0xb5aa96), clamp(rock*.72 + dryTone*.14,0,1)); color.lerp(new THREE.Color(0x8f8066), alpine*.18); color.lerp(new THREE.Color(0x5e5c58), rockyMass*.34); }
          else if(y>135){ color.set(0x6f7c5b).lerp(new THREE.Color(0xa18d67), high*.58 + dryTone*.12); color.lerp(new THREE.Color(0x77746a), cliff*.22); }
          else if(y<SEA_LEVEL+16){ color.set(0x788653).lerp(new THREE.Color(0xa09b66), .25 + shore*.004); }
          else { color.set(0x466e3d).lerp(new THREE.Color(0x718450), clamp((y-20)/150,0,1)*.45 + forestTone*.16); }
          const speck = fbm(x*.034+8,z*.034-4,3)*.055; const erosion = Math.max(smoothstep(24, 42, slope) * smoothstep(115, 260, y), rockyMass*.78);
          color.offsetHSL(0, -erosion*.025, speck - alpine*.015 + mossTone*.012 - rockyMass*.018);
          if(erosion>.35) color.lerp(new THREE.Color(0x8a8170), erosion*.18 + rockyMass*.10);
          colors.push(color.r,color.g,color.b);
        }
      }
      for(let iz=0; iz<GRID-1; iz++){ for(let ix=0; ix<GRID-1; ix++){ const a=iz*GRID+ix, b=a+1, c=a+GRID, d=c+1; if((ix+iz)%2===0) indices.push(a,c,b,b,c,d); else indices.push(a,c,d,a,d,b); } }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts,3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors,3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs,2)); geo.setIndex(indices); geo.computeVertexNormals();
      const terrain = new THREE.Mesh(geo, MAT.terrain); terrain.receiveShadow = true; group.add(terrain);
      lastStats = { ...lastStats, build: buildable/total, min:minY, max:maxY };
    }
    function addSea(group){
      if(!terrainHeights) return;
      seaCells = [];
      const seaLevelY = SEA_LEVEL + 0.44;
      const cellCols = GRID - 1, cellRows = GRID - 1;
      const candidate = new Uint8Array(cellCols * cellRows);
      const open = new Uint8Array(cellCols * cellRows);
      const queue = [];
      const idxCell = (x,z)=> z*cellCols + x;
      for(let iz=0; iz<cellRows; iz++){
        for(let ix=0; ix<cellCols; ix++){
          const i00 = iz*GRID + ix, i10 = i00 + 1, i01 = i00 + GRID, i11 = i01 + 1;
          const h00 = terrainHeights[i00], h10 = terrainHeights[i10], h01 = terrainHeights[i01], h11 = terrainHeights[i11];
          const minH = Math.min(h00,h10,h01,h11), avgH = (h00+h10+h01+h11) * 0.25;
          const cx = -HALF + ((ix+0.5)/(GRID-1))*WORLD;
          const cz = -HALF + ((iz+0.5)/(GRID-1))*WORLD;
          const coast = coastBandAt(cx,cz);
          if((minH <= SEA_LEVEL + 0.7 || avgH <= SEA_LEVEL - 0.15) && coast > 0.12) candidate[idxCell(ix,iz)] = 1;
        }
      }
      const pushIf = (x,z)=>{
        if(x<0 || z<0 || x>=cellCols || z>=cellRows) return;
        const id = idxCell(x,z);
        if(!candidate[id] || open[id]) return;
        open[id] = 1; queue.push([x,z]);
      };
      for(let ix=0; ix<cellCols; ix++){ pushIf(ix,0); pushIf(ix,cellRows-1); }
      for(let iz=1; iz<cellRows-1; iz++){ pushIf(0,iz); pushIf(cellCols-1,iz); }
      while(queue.length){
        const [x,z] = queue.pop();
        pushIf(x+1,z); pushIf(x-1,z); pushIf(x,z+1); pushIf(x,z-1);
      }
      const pos=[], uv=[], idx=[]; let v=0;
      const uvScale = 2.15 / WORLD;
      for(let iz=0; iz<cellRows; iz++){
        for(let ix=0; ix<cellCols; ix++){
          if(!open[idxCell(ix,iz)]) continue;
          const x0 = -HALF + (ix/(GRID-1))*WORLD;
          const x1 = -HALF + ((ix+1)/(GRID-1))*WORLD;
          const z0 = -HALF + (iz/(GRID-1))*WORLD;
          const z1 = -HALF + ((iz+1)/(GRID-1))*WORLD;
          const cx=(x0+x1)*.5, cz=(z0+z1)*.5;
          seaCells.push({x:cx,z:cz,size:x1-x0});
          pos.push(x0,seaLevelY,z0, x1,seaLevelY,z0, x0,seaLevelY,z1, x1,seaLevelY,z1);
          uv.push((x0+HALF)*uvScale,(z0+HALF)*uvScale, (x1+HALF)*uvScale,(z0+HALF)*uvScale, (x0+HALF)*uvScale,(z1+HALF)*uvScale, (x1+HALF)*uvScale,(z1+HALF)*uvScale);
          idx.push(v,v+2,v+1, v+1,v+2,v+3);
          v += 4;
        }
      }
      if(!pos.length) return;
      const seaGeo = new THREE.BufferGeometry();
      seaGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
      seaGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
      seaGeo.setIndex(idx);
      seaGeo.computeVertexNormals();
      const seaMat = MAT.water.clone();
      seaMat.color = new THREE.Color(0x2a93bd);
      seaMat.opacity = .74;
      seaMat.roughness = .23;
      seaMat.map = tex.water.clone();
      seaMat.map.wrapS = seaMat.map.wrapT = THREE.RepeatWrapping;
      seaMat.map.repeat.set(1,1);
      sea = new THREE.Mesh(seaGeo, seaMat);
      sea.receiveShadow = true;
      sea.renderOrder = 1;
      group.add(sea);
      addSeaSurfaceDetails(group, seaLevelY);
    }
    function addSeaSurfaceDetails(group, seaLevelY){
      if(!seaCells.length) return;
      const detail = new THREE.Group();
      const glintGeo = new THREE.PlaneGeometry(1,1);
      const foamGeo = new THREE.PlaneGeometry(1,1);
      const glintCount = Math.min(isMobile()?14:30, Math.max(6, Math.floor(seaCells.length * 0.006)));
      for(let i=0;i<glintCount;i++){
        const c = seaCells[Math.floor(rng()*seaCells.length)];
        const m = new THREE.Mesh(glintGeo, new THREE.MeshBasicMaterial({color:0xdff8ff, transparent:true, opacity:0.05 + rng()*0.07, depthWrite:false, side:THREE.DoubleSide, toneMapped:false}));
        const s = lerp(16, 58, rng()) * worldScale();
        m.scale.set(s, lerp(.8, 2.1, rng()) * worldScale(), 1);
        m.rotation.x = -Math.PI/2;
        m.rotation.z = rng()*TWO_PI;
        m.position.set(c.x, seaLevelY + 0.06, c.z);
        m.userData.wave = true; m.userData.baseOpacity = m.material.opacity; m.renderOrder = 7;
        detail.add(m); waterDetailMeshes.push(m);
      }
      const foamCount = Math.min(isMobile()?22:42, Math.max(8, Math.floor(seaCells.length * 0.010)));
      const step = WORLD/(GRID-1);
      for(let i=0;i<foamCount;i++){
        const c = seaCells[Math.floor(rng()*seaCells.length)];
        const shoreTest = Math.max(terrainHeight(c.x+step*0.8,c.z), terrainHeight(c.x-step*0.8,c.z), terrainHeight(c.x,c.z+step*0.8), terrainHeight(c.x,c.z-step*0.8));
        if(shoreTest < SEA_LEVEL + 1.5 && rng() > .25) continue;
        const m = new THREE.Mesh(foamGeo, MAT.foam.clone());
        const s = lerp(8, 30, rng()) * worldScale();
        m.scale.set(s, lerp(1.2, 3.6, rng()) * worldScale(), 1);
        m.rotation.x = -Math.PI/2; m.rotation.z = rng()*TWO_PI;
        m.position.set(c.x, seaLevelY + 0.07, c.z);
        m.material.opacity = lerp(.05,.14,rng());
        m.renderOrder = 8; detail.add(m);
      }
      group.add(detail);
    }
    function addRiverSystems(group){
      for(const r of riverDefs){
        const bed=buildRiverRibbon(r,1.78,-0.35,MAT.waterBed,true); group.add(bed);
        const water=buildRiverRibbon(r,1.00,0.44,MAT.river,false); water.userData.flow=r.flow; water.userData.flowSign=1; waterMeshes.push(water); group.add(water);
        group.add(buildRiverCurrentLines(r));
        group.add(buildRiverFoam(r));
        group.add(buildSpringMarker(r));
        group.add(buildRiverMouthFoam(r));
      }
    }
    function buildRiverRibbon(r,widthMul=1,yOffset=0.2,material=MAT.river,wider=false){
      const N=Math.max(170,Math.round(GRID*1.20)), pos=[],uv=[],idx=[];
      for(let i=0;i<=N;i++){
        const t=i/N; const p=r.curve.getPoint(t);
        const p0=r.curve.getPoint(Math.max(0,t-0.006)), p1=r.curve.getPoint(Math.min(1,t+0.006));
        const tx=p1.x-p0.x,tz=p1.z-p0.z; const len=Math.hypot(tx,tz)||1;
        const nx=-tz/len,nz=tx/len;
        const w=lerp(r.width0,r.width1,Math.pow(t,.76))*r.flow*widthMul;
        const cy=terrainHeight(p.x,p.z);
        // corta a fita no mar para não gerar manchas azul-claro sobre o oceano.
        const atSea=(cy<=SEA_LEVEL+1.2 && coastBandAt(p.x,p.z)>.12 && t>.88);
        if(atSea && !wider) continue;
        for(const side of [-1,1]){
          const x=p.x+nx*w*side, z=p.z+nz*w*side;
          const sideY=terrainHeight(x,z);
          const y=lerp(cy,sideY,wider?.78:.62)+yOffset;
          pos.push(x,y,z); uv.push(side<0?0:1,t*4.2);
        }
      }
      for(let i=0;i<pos.length/6-1;i++){ const a=i*2,b=a+1,c=a+2,d=a+3; idx.push(a,c,b,b,c,d); }
      const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); geo.setIndex(idx); geo.computeVertexNormals();
      const mesh=new THREE.Mesh(geo,material.clone?material.clone():material); mesh.receiveShadow=true; mesh.renderOrder=wider?2:5;
      if(mesh.material.map){ mesh.material.map=mesh.material.map.clone(); mesh.material.map.wrapS=mesh.material.map.wrapT=THREE.RepeatWrapping; mesh.material.map.repeat.set(wider?1.2:1.45,wider?1.0:2.2); }
      return mesh;
    }
    function buildRiverCurrentLines(r){
      const group=new THREE.Group(); const mat=MAT.current.clone(); const geo=new THREE.PlaneGeometry(1,1);
      const count=Math.max(8,Math.round(r.samples.length/18));
      for(let i=2;i<count;i++){
        const t=i/count; const p=r.curve.getPoint(t); const p0=r.curve.getPoint(Math.max(0,t-.01)),p1=r.curve.getPoint(Math.min(1,t+.01));
        const angle=Math.atan2(p1.z-p0.z,p1.x-p0.x); const w=lerp(r.width0,r.width1,Math.pow(t,.76))*r.flow;
        const lanes=w>30?2:1;
        for(let k=0;k<lanes;k++){
          const side=lanes===1?0:(k?-.25:.25); const nx=-Math.sin(angle), nz=Math.cos(angle);
          const m=new THREE.Mesh(geo,mat.clone());
          m.scale.set(lerp(10,34,rng())*worldScale(),lerp(.45,1.35,rng())*worldScale(),1);
          m.rotation.x=-Math.PI/2; m.rotation.z=-angle+lerp(-.07,.07,rng());
          m.position.set(p.x+nx*w*side,terrainHeight(p.x,p.z)+.62,p.z+nz*w*side);
          m.material.opacity=lerp(.045,.12,rng()); m.userData.wave=true; m.userData.baseOpacity=m.material.opacity; m.renderOrder=8; group.add(m); waterDetailMeshes.push(m);
        }
      }
      return group;
    }
    function buildRiverFoam(r){
      const group=new THREE.Group(); const mat=MAT.foam.clone(); const N=32;
      for(let i=3;i<N;i+=4){
        const t=i/N; const p=r.curve.getPoint(t); const p0=r.curve.getPoint(Math.max(0,t-.018)),p1=r.curve.getPoint(Math.min(1,t+.018));
        const fall=terrainHeight(p0.x,p0.z)-terrainHeight(p1.x,p1.z); const slope=fall/Math.max(1,Math.hypot(p1.x-p0.x,p1.z-p0.z));
        if(slope<.085 && t<.88) continue;
        const angle=Math.atan2(p1.z-p0.z,p1.x-p0.x), w=lerp(r.width0,r.width1,Math.pow(t,.76))*r.flow;
        const strip=new THREE.Mesh(new THREE.PlaneGeometry(w*.86,1.0+Math.min(2.6,w*.025)),mat.clone());
        strip.rotation.x=-Math.PI/2; strip.rotation.z=-angle; strip.position.set(p.x,terrainHeight(p.x,p.z)+.64,p.z); strip.material.opacity=lerp(.07,.18,rng()); strip.renderOrder=9; group.add(strip);
      }
      return group;
    }
    function buildSpringMarker(r){
      const group=new THREE.Group(); if(!r.points?.length) return group; const p=r.points[0];
      const m=new THREE.Mesh(new THREE.CircleGeometry(Math.max(4,r.width0*.85),18),MAT.river.clone());
      m.rotation.x=-Math.PI/2; m.position.set(p[0],terrainHeight(p[0],p[1])+.50,p[1]); m.material.opacity=.62; m.renderOrder=6; group.add(m); return group;
    }
    function buildRiverMouthFoam(r){
      const group=new THREE.Group(); if(!r.points?.length) return group; const p=r.points[r.points.length-1]; const mat=MAT.foam.clone();
      for(let i=0;i<5;i++){
        const m=new THREE.Mesh(new THREE.PlaneGeometry(lerp(8,28,rng())*worldScale(),lerp(1.0,3.5,rng())*worldScale()),mat.clone());
        const a=rng()*TWO_PI, d=lerp(0,24,rng())*worldScale();
        m.rotation.x=-Math.PI/2; m.rotation.z=rng()*TWO_PI; m.position.set(p[0]+Math.cos(a)*d,terrainHeight(p[0],p[1])+.70,p[1]+Math.sin(a)*d); m.material.opacity=lerp(.055,.14,rng()); m.renderOrder=9; group.add(m);
      }
      return group;
    }
    function addCoastalBeaches(group){
      if(pct('coast') < .05) return;
      const beachGroup = new THREE.Group();
      const patchCount = Math.round((isMobile()?26:54) * lerp(.20, 1.22, pct('coast')));
      let placed = 0, guard = 0;
      while(placed < patchCount && guard < patchCount*60){
        guard++;
        const x = lerp(-HALF+40, HALF-40, rng()), z = lerp(-HALF+40, HALF-40, rng());
        const y = terrainHeight(x,z), slope = slopeAt(x,z);
        if(!isCoastalCandidate(x,z,y,slope)) continue;
        const rv = distToRivers(x,z);
        if(rv.river && rv.d < rv.w*1.5 + 14) continue;
        const w = lerp(48, 180, Math.pow(rng(), .85)) * lerp(.75,1.45,pct('coast'));
        const d = lerp(18, 72, Math.pow(rng(), .92)) * lerp(.72,1.28,pct('coast'));
        const patch = new THREE.Mesh(makeBlobPlane(w,d,15), MAT.sand);
        patch.rotation.y = rng()*TWO_PI;
        patch.position.set(x, SEA_LEVEL + 0.95 + rng()*.18, z);
        patch.receiveShadow = true;
        patch.renderOrder = 3;
        beachGroup.add(patch);
        placed++;
      }
      group.add(beachGroup);
    }
    function addForestAndRocks(group){
      let objectCount = 0;
      if(PARAMS.showTrees && PARAMS.forest>0){
        const forest = new THREE.Group(); forest.userData.naturalCleanupLayer = true; forest.name = 'natural-trees'; const prototypes = makeTreePrototypes(); const count = Math.round((isMobile()?430:740) * lerp(.05,1.28,pct('forest')));
        let placed=0, guard=0; while(placed<count && guard<count*25){ guard++; const x=lerp(-HALF+60,HALF-60,rng()), z=lerp(-HALF+60,HALF-60,rng()); const y=terrainHeight(x,z); const rv=distToRivers(x,z); if(y < SEA_LEVEL+8) continue; if(rv.river && rv.d < rv.w*2.2 + 12) continue; const slope=slopeAt(x,z); if(slope>34) continue; const rocky = rockyMountainMask(x,z,y,slope); if(rocky>.46) continue; const forestNoise=valueNoise(x*.004+11,z*.004-3); const nearMountain = smoothstep(20,190,y) * (1-smoothstep(260,430,y)); const density = clamp(forestNoise*.95 + nearMountain*.55 + (rng()-.5)*.22 - rocky*.75,0,1); if(density < lerp(.66,.36,pct('forest'))) continue; const type = Math.floor(rng()*prototypes.length); const tree = prototypes[type].clone(true); const s = lerp(.65, 1.85, Math.pow(rng(), .72)) * (y>170 ? lerp(.75,1.15,rng()) : 1); tree.scale.setScalar(s * UNITS_PER_METER); tree.rotation.y = rng()*TWO_PI; tree.position.set(x, y, z); forest.add(tree); placed++; }
        objectCount += placed; group.add(forest);
      }
      if(PARAMS.showRocks && PARAMS.rocks>0){
        const rocks = new THREE.Group(); rocks.userData.naturalCleanupLayer = true; rocks.name = 'natural-rocks';
        const rockGeo1=new THREE.DodecahedronGeometry(1,1), rockGeo2=new THREE.IcosahedronGeometry(1,1), slabGeo=new THREE.BoxGeometry(1,1,1,1,1,1);
        const rockCount=Math.round((isMobile()?520:980) * lerp(.06,1.22,pct('rocks')));
        let rp=0, rg=0;
        while(rp<rockCount && rg<rockCount*28){
          rg++;
          const x=lerp(-HALF+45,HALF-45,rng()), z=lerp(-HALF+45,HALF-45,rng());
          const y=terrainHeight(x,z), sl=slopeAt(x,z);
          if(y<SEA_LEVEL+6 || sl>42) continue;
          const rv = distToRivers(x,z);
          if(rv.river && rv.d < rv.w*1.2 + 8) continue;
          const rocky = rockyMountainMask(x,z,y,sl);
          const fieldNoise = valueNoise(x*.0057+5.2,z*.0061-7.4)*.72 + fbm(x*.0105-3,z*.0105+4,3)*.28;
          const scatter = fieldNoise + smoothstep(110,260,y)*.18 + smoothstep(12,30,sl)*.12 + rocky*.42;
          if(scatter < lerp(.54,.28,pct('rocks'))) continue;
          const m = rocky>.38 ? (rng()>.45 ? MAT.rockDark : MAT.cliffWarm) : (rng()>.58 ? MAT.rock : MAT.rockDark);
          const geo = rocky>.42 && rng()>.72 ? slabGeo : (rng()>.52?rockGeo1:rockGeo2);
          const sizeBase = rocky>.42 ? lerp(4.0,18.0,Math.pow(rng(),1.15)) : lerp(1.6,8.8,Math.pow(rng(),1.35));
          const s=sizeBase * lerp(.90,1.18,smoothstep(8,30,sl)) * UNITS_PER_METER;
          const rock = new THREE.Mesh(geo, m);
          rock.scale.set(s*lerp(.90,1.95,rng()), s*lerp(.32,.95,rng()), s*lerp(.75,1.65,rng()));
          rock.rotation.set(rng()*Math.PI*.22, rng()*TWO_PI, rng()*Math.PI*.18);
          rock.position.set(x, y+rock.scale.y*.32, z);
          rock.castShadow=true; rock.receiveShadow=true; rocks.add(rock); objectCount++;
          if(rng()>.66){
            const clusterN = 1 + Math.floor(rng()*3);
            for(let k=0;k<clusterN;k++){
              const a=rng()*TWO_PI, d=lerp(5,18,rng()) * UNITS_PER_METER;
              const cx=x+Math.cos(a)*d, cz=z+Math.sin(a)*d, cy=terrainHeight(cx,cz), csl=slopeAt(cx,cz);
              if(cy<SEA_LEVEL+8 || csl>44) continue;
              const peb=new THREE.Mesh(rng()>.5?rockGeo1:rockGeo2, rng()>.5?MAT.rock:MAT.rockDark);
              const ps=s*lerp(.14,.34,rng());
              peb.scale.set(ps*lerp(.8,1.6,rng()),ps*lerp(.35,.9,rng()),ps*lerp(.7,1.5,rng()));
              peb.rotation.set(rng()*Math.PI,rng()*TWO_PI,rng()*Math.PI*.4);
              peb.position.set(cx,cy+peb.scale.y*.28,cz);
              peb.castShadow=true; peb.receiveShadow=true; rocks.add(peb); objectCount++;
            }
          }
          rp++;
        }
        group.add(rocks); objectCount += addMountainRockSurfacePatches(group); objectCount += addMountainRockDetails(group);
      }
      return objectCount;
    }
    function makeBlobPlane(w,d,segments=14){ const pts=[0,0,0], idx=[]; for(let i=0;i<segments;i++){ const a=i/segments*TWO_PI; const wob=.72 + valueNoise(Math.cos(a)*6.1+w*.013, Math.sin(a)*6.1+d*.017)*.46; pts.push(Math.cos(a)*w*.5*wob,0,Math.sin(a)*d*.5*wob); } for(let i=1;i<=segments;i++) idx.push(0,i,i===segments?1:i+1); const geo=new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts,3)); geo.setIndex(idx); geo.computeVertexNormals(); return geo; }
    function addMountainRockSurfacePatches(group){ return 0; }
    function addMountainRockDetails(group){ return 0; }
    function addSmallDetails(group){
      const detailGroup=new THREE.Group(); detailGroup.userData.naturalCleanupLayer = true; detailGroup.name = 'natural-details'; const grassGeo=new THREE.ConeGeometry(1,1,5); const shrubMat=new THREE.MeshStandardMaterial({color:0x557044,roughness:1,flatShading:true}); const dryShrubMat=new THREE.MeshStandardMaterial({color:0x7b754d,roughness:1,flatShading:true});
      const n=Math.round((isMobile()?320:620) * lerp(.08,1.25,pct('details'))); let objectCount=0;
      for(let i=0;i<n;i++){ const x=lerp(-HALF+40,HALF-40,rng()), z=lerp(-HALF+40,HALF-40,rng()); const y=terrainHeight(x,z); if(y<SEA_LEVEL+2 || slopeAt(x,z)>32) continue; const rv=distToRivers(x,z); if(rv.river && rv.d<rv.w*1.2) continue; const m=new THREE.Mesh(grassGeo, y>150 && rng()>.55 ? dryShrubMat : shrubMat); const s=lerp(.35,1.35,rng()) * UNITS_PER_METER; m.scale.set(s,lerp(.45,1.35,rng()) * UNITS_PER_METER,s); m.position.set(x,y+m.scale.y*.5,z); m.rotation.y=rng()*TWO_PI; m.castShadow=true; detailGroup.add(m); objectCount++; }
      group.add(detailGroup); return objectCount;
    }
    function addMapBase(group){
      const bottom = Math.min(lastStats.min - 52, SEA_LEVEL - 82);
      const sideMat = new THREE.MeshStandardMaterial({color:0x4c4537, roughness:1, side:THREE.DoubleSide, flatShading:true});
      const bottomMat = new THREE.MeshStandardMaterial({color:0x3e392f, roughness:1, side:THREE.DoubleSide, flatShading:true});
      const pts=[];
      for(let i=0;i<GRID;i++) pts.push([-HALF + i/(GRID-1)*WORLD, -HALF]);
      for(let i=1;i<GRID;i++) pts.push([HALF, -HALF + i/(GRID-1)*WORLD]);
      for(let i=1;i<GRID;i++) pts.push([HALF - i/(GRID-1)*WORLD, HALF]);
      for(let i=1;i<GRID-1;i++) pts.push([-HALF, HALF - i/(GRID-1)*WORLD]);
      const pos=[], idx=[];
      for(const [x,z] of pts){ const y=terrainHeight(x,z); pos.push(x,y,z, x,bottom,z); }
      for(let i=0;i<pts.length;i++){ const a=i*2,b=a+1,c=((i+1)%pts.length)*2,d=c+1; idx.push(a,b,c,c,b,d); }
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const skirt=new THREE.Mesh(geo, sideMat);
      skirt.receiveShadow=true;
      group.add(skirt);
      const bottomGeo = new THREE.PlaneGeometry(WORLD, WORLD, 1, 1);
      bottomGeo.rotateX(-Math.PI/2);
      const bottomMesh = new THREE.Mesh(bottomGeo, bottomMat);
      bottomMesh.position.set(0,bottom,0);
      bottomMesh.receiveShadow=true;
      group.add(bottomMesh);
    }
    function addMapSkirt(group){ return; }

    function makeTreePrototypes(){
      const trunkGeo=new THREE.CylinderGeometry(.18,.26,1,7), trunkTallGeo=new THREE.CylinderGeometry(.12,.22,1,7), crownGeo=new THREE.DodecahedronGeometry(1,1), coneGeo=new THREE.ConeGeometry(1,1,8), palmLeafGeo=new THREE.ConeGeometry(1,.28,5);
      const prototypes=[]; function box(name){ const g=new THREE.Group(); g.name=name; prototypes.push(g); return g; } function trunk(g,h=5,mat=MAT.trunk){ const m=new THREE.Mesh(trunkGeo,mat); m.scale.set(1,h,1); m.position.y=h*.5; m.castShadow=true; m.receiveShadow=true; g.add(m); return m; } function crown(g,x,y,z,s,mat){ const m=new THREE.Mesh(crownGeo,mat); m.scale.setScalar(s); m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; g.add(m); return m; }
      let g=box('jequitiba'); trunk(g,8,MAT.trunkLight); crown(g,0,8.7,0,3.2,MAT.leaf2); crown(g,-1.7,7.6,.5,2.2,MAT.leaf1); crown(g,1.8,7.9,-.4,2.1,MAT.leaf3);
      g=box('ipe-amarelo'); trunk(g,5.5); crown(g,0,6.2,0,2.4,MAT.flowerYellow); crown(g,-1.1,5.5,.4,1.5,MAT.flowerYellow);
      g=box('quaresmeira'); trunk(g,4.8); crown(g,0,5.6,0,2.2,MAT.flowerPink); crown(g,1,5.2,.2,1.4,MAT.leaf1);
      g=box('palm-juçara'); { const tr=new THREE.Mesh(trunkTallGeo,MAT.trunk); tr.scale.set(.75,9,.75); tr.position.y=4.5; tr.castShadow=true; g.add(tr); for(let i=0;i<8;i++){ const leaf=new THREE.Mesh(palmLeafGeo,MAT.palmLeaf); leaf.scale.set(1.1,5.5,1.1); leaf.position.set(0,9.2,0); leaf.rotation.z=Math.PI/2.6; leaf.rotation.y=i*TWO_PI/8; leaf.castShadow=true; g.add(leaf); } }
      g=box('embauba'); trunk(g,6.5,MAT.trunkLight); for(let i=0;i<5;i++) crown(g,Math.cos(i*TWO_PI/5)*1.3,7.2+Math.sin(i)*.2,Math.sin(i*TWO_PI/5)*1.3,1.35,MAT.leaf4);
      g=box('araucaria'); { const tr=new THREE.Mesh(trunkTallGeo,MAT.trunk); tr.scale.set(.55,10,.55); tr.position.y=5; tr.castShadow=true; g.add(tr); for(let k=0;k<4;k++){ const disk=new THREE.Mesh(coneGeo,MAT.leaf2); disk.scale.set(2.8-k*.45,.55,2.8-k*.45); disk.position.y=6.4+k*1.2; disk.rotation.y=k*.6; disk.castShadow=true; g.add(disk); } }
      g=box('manaca'); trunk(g,3.4); crown(g,0,4.2,0,1.8,MAT.leaf1); crown(g,.9,4.0,.6,1.2,MAT.flowerPink);
      g=box('guapuruvu'); trunk(g,9,MAT.trunkLight); crown(g,0,9.7,0,2.1,MAT.leaf3); crown(g,-1.2,9.3,.4,1.2,MAT.leaf4);
      g=box('cedro'); trunk(g,6.8); crown(g,0,7.1,0,2.4,MAT.leaf2); crown(g,1.4,6.5,-.7,1.6,MAT.leaf1); crown(g,-1.1,6.3,.6,1.7,MAT.leaf3);
      g=box('bromelia'); { for(let i=0;i<7;i++){ const leaf=new THREE.Mesh(palmLeafGeo,i%3===0?MAT.leaf4:MAT.leaf1); leaf.scale.set(.55,2.2,.55); leaf.position.y=.4; leaf.rotation.z=Math.PI/2.5; leaf.rotation.y=i*TWO_PI/7; leaf.castShadow=true; g.add(leaf); } crown(g,0,1.1,0,.45,MAT.flowerPink); }
      return prototypes;
    }

    function makeCanvasTexture(size, painter){ const canvas=document.createElement('canvas'); canvas.width=canvas.height=size; const ctx=canvas.getContext('2d'); painter(ctx,size); const t=new THREE.CanvasTexture(canvas); t.anisotropy=renderer.capabilities.getMaxAnisotropy?.() || 1; t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter; return t; }
    function makeTerrainTexture(){ return makeCanvasTexture(512,(ctx,S)=>{
      ctx.fillStyle='#617248'; ctx.fillRect(0,0,S,S);
      for(let i=0;i<76000;i++){
        const r=Math.random(), x=Math.random()*S, y=Math.random()*S;
        ctx.fillStyle=r>.66?'rgba(28,75,34,.24)':(r>.34?'rgba(178,164,104,.16)':'rgba(92,78,48,.11)');
        ctx.fillRect(x,y,1+Math.random()*2.2,1+Math.random()*2.2);
      }
      for(let i=0;i<1450;i++){
        const x=Math.random()*S,y=Math.random()*S,len=10+Math.random()*42, ang=Math.random()*TWO_PI;
        ctx.strokeStyle=Math.random()>.54?'rgba(39,78,39,.15)':'rgba(165,143,92,.12)';
        ctx.lineWidth=.55+Math.random()*1.6;
        ctx.beginPath();
        ctx.moveTo(x,y);
        ctx.bezierCurveTo(x+Math.cos(ang)*len*.35,y+Math.sin(ang)*len*.35,x+Math.cos(ang+.5)*len*.7,y+Math.sin(ang+.5)*len*.5,x+Math.cos(ang)*len,y+Math.sin(ang)*len);
        ctx.stroke();
      }
      for(let i=0;i<120;i++){
        const x=Math.random()*S,y=Math.random()*S,rx=16+Math.random()*42,ry=10+Math.random()*30;
        const gr=ctx.createRadialGradient(x,y,1,x,y,Math.max(rx,ry));
        gr.addColorStop(0,Math.random()>.55?'rgba(96,90,57,.16)':'rgba(38,90,42,.14)');
        gr.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=gr; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,Math.random()*Math.PI,0,TWO_PI); ctx.fill();
      }
    }); }
    function makeTerrainBumpTexture(){ return makeCanvasTexture(512,(ctx,S)=>{ ctx.fillStyle='#7f7f7f'; ctx.fillRect(0,0,S,S); for(let i=0;i<56000;i++){ const v=105+Math.random()*70; ctx.fillStyle=`rgb(${v},${v},${v})`; ctx.fillRect(Math.random()*S,Math.random()*S,1+Math.random()*3,1+Math.random()*3); } for(let i=0;i<950;i++){ const v=90+Math.random()*75; const x=Math.random()*S,y=Math.random()*S,len=12+Math.random()*42,ang=Math.random()*TWO_PI; ctx.strokeStyle=`rgba(${v},${v},${v},.34)`; ctx.lineWidth=.8+Math.random()*1.8; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+Math.cos(ang)*len,y+Math.sin(ang)*len); ctx.stroke(); } }); }
    function makeGrassTexture(){ return makeCanvasTexture(512,(ctx,S)=>{ ctx.fillStyle='#526b3e'; ctx.fillRect(0,0,S,S); for(let i=0;i<52000;i++){ ctx.fillStyle=Math.random()>.5?'rgba(25,80,30,.25)':'rgba(210,220,150,.18)'; ctx.fillRect(Math.random()*S,Math.random()*S,1+Math.random()*2,1+Math.random()*3); } }); }
    function makeRockTexture(){ return makeCanvasTexture(512,(ctx,S)=>{ ctx.fillStyle='#7d7971'; ctx.fillRect(0,0,S,S); for(let i=0;i<26000;i++){ const r=Math.random(); ctx.fillStyle=r>.58?'rgba(255,248,224,.12)':(r>.25?'rgba(42,39,35,.18)':'rgba(132,116,88,.12)'); ctx.fillRect(Math.random()*S,Math.random()*S,1+Math.random()*5,1+Math.random()*5); } for(let y=-40;y<S+40;y+=18+Math.random()*16){ ctx.strokeStyle=Math.random()>.5?'rgba(50,45,39,.26)':'rgba(196,176,135,.14)'; ctx.lineWidth=.8+Math.random()*2.2; ctx.beginPath(); const off=Math.random()*36-18; ctx.moveTo(-30,y+off); ctx.bezierCurveTo(S*.25,y-14+Math.random()*28,S*.70,y-18+Math.random()*36,S+30,y+Math.random()*30-15); ctx.stroke(); } for(let i=0;i<190;i++){ ctx.strokeStyle='rgba(32,29,26,.28)'; ctx.lineWidth=.6+Math.random()*2.4; ctx.beginPath(); const x=Math.random()*S,y=Math.random()*S; ctx.moveTo(x,y); ctx.lineTo(x+Math.random()*80-40,y+Math.random()*80-40); ctx.stroke(); } }); }
    function makeRockBumpTexture(){ return makeCanvasTexture(512,(ctx,S)=>{ ctx.fillStyle='#858585'; ctx.fillRect(0,0,S,S); for(let i=0;i<34000;i++){ const v=70+Math.random()*120; ctx.fillStyle=`rgb(${v},${v},${v})`; ctx.fillRect(Math.random()*S,Math.random()*S,2+Math.random()*6,2+Math.random()*6); } for(let y=0;y<S;y+=14+Math.random()*12){ const v=70+Math.random()*80; ctx.strokeStyle=`rgba(${v},${v},${v},.55)`; ctx.lineWidth=1+Math.random()*2; ctx.beginPath(); ctx.moveTo(0,y); ctx.bezierCurveTo(S*.28,y+Math.random()*24-12,S*.65,y+Math.random()*24-12,S,y+Math.random()*20-10); ctx.stroke(); } }); }
    function makeGravelTexture(){ return makeCanvasTexture(512,(ctx,S)=>{ ctx.clearRect(0,0,S,S); ctx.fillStyle='rgba(92,86,76,.72)'; ctx.fillRect(0,0,S,S); for(let i=0;i<30000;i++){ const r=Math.random(), v=80+Math.random()*85; ctx.fillStyle=r>.68?`rgba(${v+40},${v+32},${v+18},.35)`: `rgba(${v},${v},${v},.32)`; ctx.fillRect(Math.random()*S,Math.random()*S,1+Math.random()*4,1+Math.random()*4); } for(let i=0;i<65;i++){ ctx.strokeStyle='rgba(35,31,26,.18)'; ctx.lineWidth=1+Math.random()*2; ctx.beginPath(); const x=Math.random()*S,y=Math.random()*S; ctx.moveTo(x,y); ctx.lineTo(x+Math.random()*90-45,y+Math.random()*50-25); ctx.stroke(); } }); }
    function makeSandTexture(){ return makeCanvasTexture(512,(ctx,S)=>{ ctx.fillStyle='#d2bd87'; ctx.fillRect(0,0,S,S); for(let i=0;i<36000;i++){ ctx.fillStyle=Math.random()>.55?'rgba(255,245,190,.16)':'rgba(100,82,40,.12)'; ctx.fillRect(Math.random()*S,Math.random()*S,1+Math.random()*2,1+Math.random()*2); } for(let y=0;y<S;y+=28){ ctx.strokeStyle='rgba(120,95,55,.085)'; ctx.beginPath(); ctx.moveTo(0,y+Math.random()*10); ctx.bezierCurveTo(S*.3,y+10,S*.6,y-10,S,y+Math.random()*10); ctx.stroke(); } }); }
    function makeMudTexture(){ return makeCanvasTexture(512,(ctx,S)=>{ ctx.fillStyle='#6d5a40'; ctx.fillRect(0,0,S,S); for(let i=0;i<26000;i++){ ctx.fillStyle=Math.random()>.55?'rgba(120,100,70,.16)':'rgba(30,22,14,.12)'; ctx.fillRect(Math.random()*S,Math.random()*S,2+Math.random()*3,2+Math.random()*3); } for(let i=0;i<80;i++){ ctx.strokeStyle='rgba(30,22,14,.12)'; ctx.beginPath(); const x=Math.random()*S,y=Math.random()*S; ctx.arc(x,y,5+Math.random()*22,0,TWO_PI); ctx.stroke(); } }); }
    function makeWaterTexture(){ return makeCanvasTexture(512,(ctx,S)=>{
      ctx.clearRect(0,0,S,S);
      const gr=ctx.createLinearGradient(0,0,S,0);
      gr.addColorStop(0,'rgba(16,91,132,.88)');
      gr.addColorStop(.50,'rgba(34,136,176,.76)');
      gr.addColorStop(1,'rgba(12,82,128,.88)');
      ctx.fillStyle=gr; ctx.fillRect(0,0,S,S);

      // Padrão da v0.9, mas sem manchas azul-claras grandes e sem faixa/esteira repetitiva.
      for(let i=0;i<105;i++){
        const a = Math.random()*TWO_PI;
        const x = Math.random()*S, y = Math.random()*S;
        const len = 42 + Math.random()*155;
        ctx.strokeStyle=`rgba(205,242,255,${0.026+Math.random()*0.052})`;
        ctx.lineWidth=.65+Math.random()*1.45;
        ctx.beginPath();
        ctx.moveTo(x-Math.cos(a)*len*.5, y-Math.sin(a)*len*.5);
        ctx.bezierCurveTo(
          x+Math.cos(a+.35)*len*.12, y+Math.sin(a+.35)*len*.12,
          x+Math.cos(a-.28)*len*.34, y+Math.sin(a-.28)*len*.34,
          x+Math.cos(a)*len*.5, y+Math.sin(a)*len*.5
        );
        ctx.stroke();
      }
      for(let i=0;i<1800;i++){
        ctx.fillStyle=`rgba(255,255,255,${0.008+Math.random()*0.018})`;
        ctx.fillRect(Math.random()*S,Math.random()*S,1+Math.random()*1.5,1+Math.random()*1.1);
      }
    }); }

    const sliderIds = ['mountains','rivers','coast','plains','roughness','forest','rocks','details'];
    function readUI(){ const p={...PARAMS}; p.seed = Math.abs(parseInt(document.getElementById('seed').value,10) || DEFAULTS.seed) >>> 0; p.mapSizeKm = Number(document.querySelector('.sizebtn.active')?.dataset.size || DEFAULTS.mapSizeKm); for(const id of sliderIds) p[id]=parseInt(document.getElementById(id).value,10); for(const id of ['showTrees','showRocks','showDetails','showFog']) p[id]=document.getElementById(id).checked; return p; }
    function syncUI(p=PARAMS){ document.getElementById('seed').value = String(p.seed); for(const id of sliderIds){ document.getElementById(id).value = p[id]; document.getElementById(id+'Out').textContent = p[id]; } for(const id of ['showTrees','showRocks','showDetails','showFog']) document.getElementById(id).checked = !!p[id]; document.querySelectorAll('.sizebtn').forEach(btn=>btn.classList.toggle('active', Number(btn.dataset.size)===(p.mapSizeKm||20))); }
    function updateSliderLabels(){ for(const id of sliderIds) document.getElementById(id+'Out').textContent = document.getElementById(id).value; }
    function updateStats(){ document.getElementById('statBuild').textContent = `${Math.round(lastStats.build*100)}%`; document.getElementById('statAlt').textContent = `${Math.round(lastStats.min)} / ${Math.round(lastStats.max)}m`; document.getElementById('statRivers').textContent = `${lastStats.rivers}`; document.getElementById('statObjects').textContent = `${lastStats.objects}`; const pill=document.querySelector('.pill'); if(pill) pill.textContent = `Chrome desktop • WebGL • mapa ${MAP_KM}×${MAP_KM} km • 1u=${METERS_PER_UNIT}m`; }
    function randomSeed(){ return Math.floor(100000000 + Math.random()*3900000000) >>> 0; }

    const ui = document.getElementById('ui');
    ui.addEventListener('pointerdown', e=>e.stopPropagation()); ui.addEventListener('wheel', e=>e.stopPropagation(), {passive:false});
    document.getElementById('collapse').addEventListener('click',()=>{ ui.classList.toggle('collapsed'); document.getElementById('collapse').textContent = ui.classList.contains('collapsed') ? '+' : '—'; });
    document.getElementById('generate').addEventListener('click', rebuildWorld);
    document.getElementById('randomSeed').addEventListener('click',()=>{ document.getElementById('seed').value = String(randomSeed()); rebuildWorld(); });
    document.getElementById('reset').addEventListener('click',()=>{ PARAMS={...DEFAULTS}; syncUI(PARAMS); rebuildWorld(); });
    document.getElementById('exportCfg').addEventListener('click', async()=>{ const cfg = readUI(); const text = JSON.stringify(cfg,null,2); try{ await navigator.clipboard.writeText(text); alert('Config copiada.'); }catch{ window.prompt('Copie a config:', text); } });
    document.querySelectorAll('.sizebtn').forEach(btn=>btn.addEventListener('click', ()=>{ document.querySelectorAll('.sizebtn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); rebuildWorld(); }));
    for(const id of sliderIds){ document.getElementById(id).addEventListener('input', updateSliderLabels); document.getElementById(id).addEventListener('change', rebuildWorld); }
    for(const id of ['showTrees','showRocks','showDetails','showFog']) document.getElementById(id).addEventListener('change', rebuildWorld);

    // API pública do MapCore usada pelo novo jogo. Mantém o gerador como host,
    // sem expor o jogo antigo nem depender do RoadCore legado.
    this.version = 'newcore-v1.1-road-geometry';
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.THREE = THREE;
    this.getConfig = () => readUI();
    this.getStats = () => ({ ...lastStats, mapSizeKm: MAP_KM, metersPerUnit: METERS_PER_UNIT, worldSize: WORLD, worldKm: WORLD * METERS_PER_UNIT / 1000, grid: GRID, seaLevel: SEA_LEVEL });
    this.getWorldSize = () => WORLD;
    this.getHalfWorldSize = () => HALF;
    this.getHeightAt = (x, z) => terrainHeight(x, z);
    this.setTimeOfDay = (hour = 12, minute = 0, day = 1) => atmosphere.setTimeOfDay(hour, minute, day);
    this.getWeatherLabel = () => atmosphere.getWeatherLabel();
    this.getWeatherState = () => ({ ...atmosphere.weather, hour: atmosphere.hour, minute: atmosphere.minute, day: atmosphere.day });
    this.isInsideWorld = (x, z, margin = 0) => x >= -HALF + margin && x <= HALF - margin && z >= -HALF + margin && z <= HALF - margin;
    this.getSlopeAt = (x, z) => slopeAt(x, z);
    this.getTerrainNormalAt = (x, z) => terrainNormalApprox(x, z);
    this.isWaterAt = (x, z) => {
      const y = terrainHeight(x, z);
      const rv = distToRivers(x, z);
      if (rv.river && rv.d < rv.w * 1.05) return true;
      return y <= SEA_LEVEL + 1.2 && coastBandAt(x, z) > 0.12;
    };
    this.isBuildableAt = (x, z, opts = {}) => {
      const maxSlope = opts.maxSlope ?? 10.5;
      const minHeightAboveSea = opts.minHeightAboveSea ?? 10;
      const y = terrainHeight(x, z);
      if (y <= SEA_LEVEL + minHeightAboveSea) return false;
      if (slopeAt(x, z) > maxSlope) return false;
      if (this.isWaterAt(x, z)) return false;
      return true;
    };
    this.rebuild = () => rebuildWorld();
    this.setConfig = (config = {}) => {
      PARAMS = { ...PARAMS, ...config };
      if (typeof config.seed !== 'undefined') PARAMS.seed = Math.abs(parseInt(config.seed, 10) || DEFAULTS.seed) >>> 0;
      syncUI(PARAMS);
      rebuildWorld();
    };
    const pointSegmentDistance2D = (p, a, b) => {
      const dx = b.x - a.x, dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      if (len2 <= 0.0001) return Math.hypot(p.x - a.x, p.z - a.z);
      const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / len2, 0, 1);
      const x = a.x + dx * t, z = a.z + dz * t;
      return Math.hypot(p.x - x, p.z - z);
    };
    const distanceToPolyline2D = (p, pts) => {
      if (!pts || pts.length < 2) return Infinity;
      let best = Infinity;
      for (let i = 1; i < pts.length; i++) best = Math.min(best, pointSegmentDistance2D(p, pts[i - 1], pts[i]));
      return best;
    };
    const getBrushLayer = () => {
      const host = worldGroup || scene;
      let layer = host.getObjectByName?.('terrain-brush-props');
      if (!layer) {
        layer = new THREE.Group();
        layer.name = 'terrain-brush-props';
        layer.userData.naturalCleanupLayer = true;
        host.add(layer);
      }
      return layer;
    };
    this.addTreeAt = (x = 0, z = 0, scale = 1) => {
      if (!this.isInsideWorld(x, z, 5) || this.isWaterAt(x, z)) return null;
      const y = terrainHeight(x, z);
      const prototypes = makeTreePrototypes();
      const tree = prototypes[Math.abs(Math.floor((x * 13 + z * 17 + CURRENT_SEED) % prototypes.length))].clone(true);
      const s = clamp(scale, 0.45, 2.5);
      tree.scale.setScalar(s * UNITS_PER_METER);
      tree.rotation.y = hash2(Math.round(x), Math.round(z)) * TWO_PI;
      tree.position.set(x, y, z);
      tree.traverse(obj => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
      getBrushLayer().add(tree);
      return tree;
    };
    this.addRockAt = (x = 0, z = 0, scale = 1) => {
      if (!this.isInsideWorld(x, z, 5) || this.isWaterAt(x, z)) return null;
      const y = terrainHeight(x, z);
      const geo = hash2(Math.round(x), Math.round(z)) > 0.5 ? new THREE.DodecahedronGeometry(1, 1) : new THREE.IcosahedronGeometry(1, 1);
      const rock = new THREE.Mesh(geo, hash2(Math.round(x + 9), Math.round(z - 4)) > 0.5 ? MAT.rock : MAT.rockDark);
      const s = clamp(scale * lerp(1.1, 3.8, hash2(Math.round(x * 0.7), Math.round(z * 0.7))), 0.8, 6.0) * UNITS_PER_METER;
      rock.scale.set(s * 1.3, s * 0.62, s);
      rock.rotation.set(hash2(Math.round(x), Math.round(z)) * 0.32, hash2(Math.round(x + 2), Math.round(z - 3)) * TWO_PI, hash2(Math.round(x - 8), Math.round(z + 1)) * 0.28);
      rock.position.set(x, y + rock.scale.y * 0.32, z);
      rock.castShadow = true; rock.receiveShadow = true;
      getBrushLayer().add(rock);
      return rock;
    };
    this.addTerrainPatchAt = (x = 0, z = 0, opts = {}) => {
      if (!this.isInsideWorld(x, z, 5)) return null;
      const kind = opts.kind || 'grass';
      const radius = clamp(opts.radius || 24, 6, 110);
      const mat = kind === 'dirt' || kind === 'cut' ? MAT.mud : kind === 'gravel' || kind === 'fill' ? MAT.gravel : kind === 'level' ? MAT.sand : MAT.terrain;
      const patch = new THREE.Mesh(makeBlobPlane(radius * 1.8, radius * 1.35, 18), mat.clone ? mat.clone() : mat);
      if (patch.material) {
        patch.material.transparent = true;
        patch.material.opacity = kind === 'level' || kind === 'fill' || kind === 'cut' ? 0.55 : 0.38;
        patch.material.depthWrite = false;
      }
      patch.rotation.x = -Math.PI / 2;
      patch.rotation.z = hash2(Math.round(x), Math.round(z)) * TWO_PI;
      patch.position.set(x, terrainHeight(x, z) + 0.74, z);
      patch.renderOrder = 8;
      patch.receiveShadow = true;
      getBrushLayer().add(patch);
      return patch;
    };
    this.clearNaturalObstaclesAlongPath = (pts = [], radius = 18) => {
      if (!worldGroup || !pts?.length) return 0;
      let removed = 0;
      const layers = [];
      worldGroup.traverse(obj => { if (obj.userData?.naturalCleanupLayer) layers.push(obj); });
      const pos = new THREE.Vector3();
      for (const layer of layers) {
        for (const child of [...layer.children]) {
          child.getWorldPosition(pos);
          if (distanceToPolyline2D({ x: pos.x, z: pos.z }, pts) <= radius) {
            layer.remove(child);
            disposeObject(child);
            removed++;
          }
        }
      }
      return removed;
    };
    this.clearNaturalObstaclesInRect = ({ x = 0, z = 0, width = 10, depth = 10, rotation = 0, padding = 4 } = {}) => {
      if (!worldGroup) return 0;
      const halfW = width * 0.5 + padding;
      const halfD = depth * 0.5 + padding;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      let removed = 0;
      const layers = [];
      worldGroup.traverse(obj => { if (obj.userData?.naturalCleanupLayer) layers.push(obj); });
      const pos = new THREE.Vector3();
      const inside = (px, pz) => {
        const dx = px - x;
        const dz = pz - z;
        const lx = dx * cos + dz * sin;
        const lz = -dx * sin + dz * cos;
        return Math.abs(lx) <= halfW && Math.abs(lz) <= halfD;
      };
      for (const layer of layers) {
        for (const child of [...layer.children]) {
          child.getWorldPosition(pos);
          if (!inside(pos.x, pos.z)) continue;
          layer.remove(child);
          disposeObject(child);
          removed++;
        }
      }
      return removed;
    };
    this.addToScene = (object) => scene.add(object);
    this.addToMapGroup = (object) => (worldGroup || scene).add(object);
    this.removeFromScene = (object) => scene.remove(object);
    this.dispose = () => {
      if (animationId) cancelAnimationFrame(animationId);
      window.removeEventListener('resize', onResize);
      atmosphere.dispose();
      renderer.dispose();
      if (worldGroup) disposeObject(worldGroup);
    };

    applyMapMetrics(DEFAULTS.mapSizeKm);
    syncUI(DEFAULTS);
    atmosphere.setTimeOfDay(12, 0, 1);
    rebuildWorld();

    const clock = new THREE.Clock();
    let animationId = null;
    function animate(){ animationId = requestAnimationFrame(animate); const dt=clock.getDelta(); const time=clock.elapsedTime; for(const obj of waterMeshes){ if(obj.material?.map){ const sign = obj.userData.flowSign || 1; obj.material.map.offset.y -= dt * .055 * (obj.userData.flow||1) * sign; obj.material.map.offset.x += dt * .006 * (obj.userData.flow||1); } } if(sea?.material?.map){ sea.material.map.offset.x += dt*.0010; sea.material.map.offset.y -= dt*.0008; } for(const obj of waterDetailMeshes){ if(obj.material && obj.userData.wave){ obj.material.opacity = obj.userData.baseOpacity * (.70 + Math.sin(time*1.7 + obj.position.x*.014 + obj.position.z*.011)*.30); } } atmosphere.update(dt); updateCityLikeCamera(dt); controls.update(); renderer.render(scene,camera); }
    animate();
    const onResize = ()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); };
    window.addEventListener('resize', onResize);
  }
}
