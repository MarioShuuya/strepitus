/**
 * Exhaust system visualization — header pipes, collector, cat, resonator,
 * muffler, tip with animated gas flow, per-header overlays, and traveling
 * gas blobs.
 */

import * as THREE from "three";
import { temperatureColor, exhaustGasColor } from "./materials";
import type { EnginePart, LayoutType, CylinderData } from "./engine-view";
import type { ExhaustSystemConfig } from "../audio/exhaust-config";
import { defaultExhaustConfig } from "../audio/exhaust-config";

export const EXHAUST_PARTS: EnginePart[] = [
  // Piping
  { name: "Header Pipe", color: "#cc6633", category: "Piping" },
  { name: "Collector", color: "#aa5522", category: "Piping" },
  { name: "Mid Pipe", color: "#996633", category: "Piping" },
  // Treatment
  { name: "Catalytic Converter", color: "#88aa44", category: "Treatment" },
  { name: "Resonator", color: "#7799aa", category: "Treatment" },
  { name: "Muffler", color: "#666688", category: "Treatment" },
  // Output
  { name: "Exhaust Tip", color: "#cccccc", category: "Output" },
  // Effects
  { name: "Exhaust Gas", color: "#ff6600", category: "Effects" },
];

/** Traveling gas blob */
interface GasBlob {
  progress: number;       // 0 → 1 from port to tip
  intensity: number;      // initial pulse strength
  temp: number;           // exhaust gas temp at spawn
  cylinderIndex: number;  // which cylinder spawned it
  age: number;            // frames alive
}

/** Per-header overlay path point */
interface PipePath {
  start: THREE.Vector2;
  end: THREE.Vector2;
}

/** Segments along the post-collector chain for blob interpolation */
interface ChainSegment {
  x: number;
  y: number;
}

const BLOB_POOL_SIZE = 24;
const HEADER_OVERLAY_SEGS = 4;
const CHAIN_OVERLAY_SEGS = 12;

export class ExhaustVisual {
  readonly group = new THREE.Group();
  private config: ExhaustSystemConfig;
  private scale: number;
  private bore: number;
  private stroke: number;
  private layoutType: LayoutType;
  private cylinderCount: number;
  private vAngle: number;

  // Meshes
  private headerPipes: THREE.Mesh[] = [];
  private collector: THREE.Mesh | null = null;
  private midPipe: THREE.Mesh | null = null;
  private cat: THREE.Mesh | null = null;
  private resonator: THREE.Mesh | null = null;
  private muffler: THREE.Mesh | null = null;
  private tips: THREE.Mesh[] = [];

  // Per-header gas overlays: [cylinderIndex][segmentIndex]
  private headerGasOverlays: THREE.Mesh[][] = [];
  // Post-collector gas overlays (shared)
  private chainGasOverlays: THREE.Mesh[] = [];

  // Blob pool — traveling hot spots with additive blending
  private blobPool: THREE.Mesh[] = [];
  private blobs: GasBlob[] = [];

  // Per-header pipe paths for overlay/blob interpolation
  private headerPaths: PipePath[] = [];
  // Chain waypoints for blob interpolation (post-collector)
  private chainPoints: ChainSegment[] = [];
  // Where the collector sits (transition point)
  private collectorPos = new THREE.Vector2();
  private chainY = 0;

  // Animation state
  private prevPulseIntensities: number[] = [];
  // Per-cylinder heat accumulation (EMA)
  private headerHeat: number[] = [];

  /** Horizontal extent of the exhaust system (for camera framing) */
  extentRight = 0;

  constructor(
    scale: number,
    bore: number,
    stroke: number,
    cylinderCount: number,
    layoutType: LayoutType,
    vAngle: number,
  ) {
    this.scale = scale;
    this.bore = bore;
    this.stroke = stroke;
    this.cylinderCount = cylinderCount;
    this.layoutType = layoutType;
    this.vAngle = vAngle;
    this.config = defaultExhaustConfig();
  }

  build(exhaustPortPositions: THREE.Vector2[]): void {
    this.clearMeshes();
    const s = this.scale;
    const boreS = this.bore * s;
    const strokeS = this.stroke * s;
    const pipeW = boreS * 0.04; // pipe thickness
    const cfg = this.config;

    // Determine collector position based on layout
    if (this.layoutType === "boxer") {
      this.collectorPos = new THREE.Vector2(boreS * 0.5, -strokeS * 0.8);
    } else if (this.layoutType === "v") {
      this.collectorPos = new THREE.Vector2(boreS * 0.3, -strokeS * 0.7);
    } else {
      const rightmost = exhaustPortPositions.reduce(
        (best, p) => (p.x > best.x ? p : best),
        exhaustPortPositions[0] || new THREE.Vector2(0, strokeS),
      );
      this.collectorPos = new THREE.Vector2(rightmost.x + boreS * 0.4, -strokeS * 0.3);
    }

    // 1. Header pipes — one per exhaust port to collector
    this.headerPaths = [];
    for (let i = 0; i < exhaustPortPositions.length; i++) {
      const port = exhaustPortPositions[i];
      const dx = this.collectorPos.x - port.x;
      const dy = this.collectorPos.y - port.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dx, dy);

      const geo = new THREE.PlaneGeometry(pipeW, len);
      const mat = new THREE.MeshBasicMaterial({ color: 0xcc6633 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.partName = "Header Pipe";
      mesh.position.set(port.x + dx / 2, port.y + dy / 2, -0.5);
      mesh.rotation.z = angle;
      this.headerPipes.push(mesh);
      this.group.add(mesh);

      this.headerPaths.push({ start: port.clone(), end: this.collectorPos.clone() });
    }

    // 2. Collector — funnel shape
    const collW = boreS * 0.15;
    const collH = boreS * 0.12;
    const collGeo = new THREE.PlaneGeometry(collW, collH);
    const collMat = new THREE.MeshBasicMaterial({ color: 0xaa5522 });
    this.collector = new THREE.Mesh(collGeo, collMat);
    this.collector.userData.partName = "Collector";
    this.collector.position.set(this.collectorPos.x, this.collectorPos.y, -0.5);
    this.group.add(this.collector);

    // Build the horizontal exhaust chain from collector rightward
    let curX = this.collectorPos.x + collW / 2 + pipeW;
    this.chainY = this.collectorPos.y;
    const componentGap = boreS * 0.03;

    // Track chain waypoints for blob interpolation
    this.chainPoints = [{ x: this.collectorPos.x, y: this.chainY }];

    // 3. Mid pipe segment (collector → first component)
    const midLen = boreS * 0.2;
    const midGeo = new THREE.PlaneGeometry(midLen, pipeW);
    const midMat = new THREE.MeshBasicMaterial({ color: 0x996633 });
    this.midPipe = new THREE.Mesh(midGeo, midMat);
    this.midPipe.userData.partName = "Mid Pipe";
    this.midPipe.position.set(curX + midLen / 2, this.chainY, -0.5);
    this.group.add(this.midPipe);
    curX += midLen + componentGap;
    this.chainPoints.push({ x: curX, y: this.chainY });

    // 4. Catalytic converter
    if (cfg.cat.enabled) {
      const catW = boreS * 0.2;
      const catH = boreS * 0.1;
      const catGeo = new THREE.PlaneGeometry(catW, catH);
      const catMat = new THREE.MeshBasicMaterial({ color: 0x88aa44 });
      this.cat = new THREE.Mesh(catGeo, catMat);
      this.cat.userData.partName = "Catalytic Converter";
      this.cat.position.set(curX + catW / 2, this.chainY, -0.5);
      this.group.add(this.cat);

      this.addHoneycombLines(curX + catW / 2, this.chainY, catW, catH);
      curX += catW + componentGap;

      this.addConnector(curX, this.chainY, boreS * 0.08, pipeW);
      curX += boreS * 0.08 + componentGap;
      this.chainPoints.push({ x: curX, y: this.chainY });
    }

    // 5. Resonator
    if (cfg.resonator.enabled) {
      const resW = boreS * 0.18;
      const resH = boreS * 0.09;
      const resGeo = new THREE.PlaneGeometry(resW, resH);
      const resMat = new THREE.MeshBasicMaterial({ color: 0x7799aa });
      this.resonator = new THREE.Mesh(resGeo, resMat);
      this.resonator.userData.partName = "Resonator";
      this.resonator.position.set(curX + resW / 2, this.chainY, -0.5);
      this.group.add(this.resonator);
      curX += resW + componentGap;

      this.addConnector(curX, this.chainY, boreS * 0.08, pipeW);
      curX += boreS * 0.08 + componentGap;
      this.chainPoints.push({ x: curX, y: this.chainY });
    }

    // 6. Muffler
    if (cfg.muffler.enabled) {
      const mufW = boreS * 0.3;
      const mufH = boreS * 0.14;
      const mufGeo = this.createRoundedRectShape(mufW, mufH, boreS * 0.02);
      const mufMat = new THREE.MeshBasicMaterial({ color: 0x666688 });
      this.muffler = new THREE.Mesh(mufGeo, mufMat);
      this.muffler.userData.partName = "Muffler";
      this.muffler.position.set(curX + mufW / 2, this.chainY, -0.5);
      this.group.add(this.muffler);

      this.addBaffleLines(curX + mufW / 2, this.chainY, mufW, mufH);
      curX += mufW + componentGap;

      this.addConnector(curX, this.chainY, boreS * 0.05, pipeW);
      curX += boreS * 0.05 + componentGap;
      this.chainPoints.push({ x: curX, y: this.chainY });
    }

    // 7. Tip(s)
    const tipCount = cfg.tip.type === "quad" ? 4 : cfg.tip.type === "dual" ? 2 : 1;
    const tipW = boreS * 0.08;
    const tipH = boreS * 0.06;
    const tipSpacing = tipH * 1.4;
    const tipStartY = this.chainY - ((tipCount - 1) * tipSpacing) / 2;

    for (let t = 0; t < tipCount; t++) {
      const tipGeo = this.createFlaredTip(tipW, tipH);
      const tipMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
      const tipMesh = new THREE.Mesh(tipGeo, tipMat);
      tipMesh.userData.partName = "Exhaust Tip";
      tipMesh.position.set(curX + tipW / 2, tipStartY + t * tipSpacing, -0.4);
      this.tips.push(tipMesh);
      this.group.add(tipMesh);
    }
    curX += tipW;
    this.chainPoints.push({ x: curX, y: this.chainY });

    // 8. Per-header gas overlays
    this.buildHeaderOverlays(exhaustPortPositions, pipeW);

    // 9. Post-collector chain gas overlays
    this.buildChainOverlays(pipeW, boreS);

    // 10. Blob pool — traveling hot spots
    this.buildBlobPool(boreS);

    this.extentRight = curX;
    this.prevPulseIntensities = new Array(this.cylinderCount).fill(0);
    this.headerHeat = new Array(this.cylinderCount).fill(0);
  }

  update(cylinders: CylinderData[], rpm: number): void {
    if (this.headerGasOverlays.length === 0 && this.chainGasOverlays.length === 0) return;

    const dt = 1 / 60; // approximate frame time

    // --- Per-cylinder pulse detection and header overlays ---
    for (let i = 0; i < cylinders.length; i++) {
      const prev = this.prevPulseIntensities[i] ?? 0;
      const cur = cylinders[i]?.exhaust_pulse_intensity ?? 0;
      const temp = cylinders[i]?.exhaust_gas_temp ?? 800;

      // Update per-cylinder heat EMA
      this.headerHeat[i] = (this.headerHeat[i] ?? 0) * 0.95 + cur * 0.05;

      // Detect rising edge → spawn blob
      if (cur > 0.3 && prev <= 0.3) {
        this.spawnBlob(i, cur, temp);
      }
      this.prevPulseIntensities[i] = cur;

      // Update per-header gas overlays
      if (i < this.headerGasOverlays.length) {
        const overlays = this.headerGasOverlays[i];
        for (let s = 0; s < overlays.length; s++) {
          const mat = overlays[s].material as THREE.MeshBasicMaterial;
          const segT = s / Math.max(overlays.length - 1, 1);

          // Gaussian pulse along header — sharper than linear
          const dist = segT; // 0 at port, 1 at collector
          const pulseOpacity = cur * 0.8 * Math.exp(-dist * dist / 0.08);

          // Background heat glow from EMA
          const heatGlow = (this.headerHeat[i] ?? 0) * 0.15;

          mat.opacity = Math.min(pulseOpacity + heatGlow, 0.85);
          mat.color.copy(exhaustGasColor(temp, segT * 0.3));
        }
      }
    }

    // --- Advance blobs ---
    const pulseSpeed = 0.015 + (rpm / 8000) * 0.035;
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const blob = this.blobs[i];
      blob.progress += pulseSpeed;
      blob.age++;

      if (blob.progress > 1.1) {
        // Return blob mesh to invisible pool
        this.blobPool[i % this.blobPool.length].visible = false;
        this.blobs.splice(i, 1);
        continue;
      }

      // Position the blob mesh along the path
      const meshIdx = i % this.blobPool.length;
      if (meshIdx < this.blobPool.length) {
        const mesh = this.blobPool[meshIdx];
        const pos = this.interpolateBlobPosition(blob);
        mesh.position.set(pos.x, pos.y, 0.5);
        mesh.visible = true;

        const mat = mesh.material as THREE.MeshBasicMaterial;
        // Fade: bright at port → dim at tip
        const fadeProgress = Math.max(0, blob.progress);
        const fade = Math.max(0, 1 - fadeProgress * 0.8) * blob.intensity;
        mat.opacity = Math.min(fade * 0.9, 0.9);
        mat.color.copy(exhaustGasColor(blob.temp, fadeProgress));

        // Scale down as it travels
        const scaleF = 1.0 - fadeProgress * 0.4;
        mesh.scale.set(scaleF, scaleF, 1);
      }
    }

    // --- Update chain gas overlays from blob contributions ---
    for (let g = 0; g < this.chainGasOverlays.length; g++) {
      const overlay = this.chainGasOverlays[g];
      const mat = overlay.material as THREE.MeshBasicMaterial;
      const segProgress = g / Math.max(this.chainGasOverlays.length - 1, 1);

      // Accumulate from all active blobs using sharper Gaussian
      let opacity = 0;
      let bestTemp = 400;
      for (const blob of this.blobs) {
        // Chain portion is progress > headerFraction
        const headerFrac = this.getHeaderFraction();
        const chainProg = blob.progress < headerFrac
          ? -1
          : (blob.progress - headerFrac) / (1 - headerFrac);
        if (chainProg < 0) continue;
        const dist = chainProg - segProgress;
        const wave = blob.intensity * 0.7 * Math.exp(-dist * dist / 0.01);
        opacity += wave;
        if (wave > 0.05) bestTemp = Math.max(bestTemp, blob.temp);
      }

      mat.opacity = Math.min(opacity, 0.85);
      mat.color.copy(exhaustGasColor(bestTemp, 0.3 + segProgress * 0.7));
    }

    // --- Tint header pipes by per-cylinder heat ---
    for (let h = 0; h < this.headerPipes.length; h++) {
      const hp = this.headerPipes[h];
      const hpMat = hp.material as THREE.MeshBasicMaterial;
      const cylIdx = Math.min(h, cylinders.length - 1);
      const cylTemp = cylinders[cylIdx]?.exhaust_gas_temp ?? 300;
      const heat = this.headerHeat[cylIdx] ?? 0;
      const tintColor = temperatureColor(cylTemp * 0.8);
      hpMat.color.copy(new THREE.Color(0xcc6633).lerp(tintColor, Math.min(heat * 0.6, 0.6)));
    }
  }

  rebuild(config: ExhaustSystemConfig, exhaustPortPositions: THREE.Vector2[]): void {
    this.config = config;
    this.build(exhaustPortPositions);
  }

  dispose(): void {
    this.clearMeshes();
    this.group.parent?.remove(this.group);
  }

  // --- Private helpers ---

  private getHeaderFraction(): number {
    // Fraction of total path that is in the header (port→collector)
    // Approximate: header pipes go from port to collector, chain goes collector to tip
    if (this.headerPaths.length === 0) return 0.3;
    const hp = this.headerPaths[0];
    const headerLen = hp.start.distanceTo(hp.end);
    const chainLen = this.chainPoints.length > 1
      ? Math.abs(this.chainPoints[this.chainPoints.length - 1].x - this.chainPoints[0].x)
      : headerLen;
    return headerLen / (headerLen + chainLen);
  }

  private spawnBlob(cylinderIndex: number, intensity: number, temp: number): void {
    if (this.blobs.length >= BLOB_POOL_SIZE) {
      // Recycle oldest
      const oldest = this.blobs.shift()!;
      const meshIdx = 0;
      if (meshIdx < this.blobPool.length) {
        this.blobPool[meshIdx].visible = false;
      }
    }
    this.blobs.push({
      progress: 0,
      intensity: Math.min(intensity, 1.5),
      temp,
      cylinderIndex,
      age: 0,
    });
  }

  private interpolateBlobPosition(blob: GasBlob): THREE.Vector2 {
    const headerFrac = this.getHeaderFraction();

    if (blob.progress <= headerFrac) {
      // In the header pipe for this cylinder
      const t = blob.progress / headerFrac;
      const pathIdx = Math.min(blob.cylinderIndex, this.headerPaths.length - 1);
      if (pathIdx < 0) return this.collectorPos.clone();
      const path = this.headerPaths[pathIdx];
      return new THREE.Vector2(
        path.start.x + (path.end.x - path.start.x) * t,
        path.start.y + (path.end.y - path.start.y) * t,
      );
    }

    // In the chain (post-collector)
    const chainT = (blob.progress - headerFrac) / (1 - headerFrac);
    if (this.chainPoints.length < 2) return this.collectorPos.clone();

    const totalChainDist = Math.abs(
      this.chainPoints[this.chainPoints.length - 1].x - this.chainPoints[0].x,
    );
    const targetDist = chainT * totalChainDist;
    let accumulated = 0;

    for (let i = 0; i < this.chainPoints.length - 1; i++) {
      const segDist = Math.abs(this.chainPoints[i + 1].x - this.chainPoints[i].x);
      if (accumulated + segDist >= targetDist) {
        const segT = (targetDist - accumulated) / Math.max(segDist, 0.001);
        return new THREE.Vector2(
          this.chainPoints[i].x + (this.chainPoints[i + 1].x - this.chainPoints[i].x) * segT,
          this.chainPoints[i].y + (this.chainPoints[i + 1].y - this.chainPoints[i].y) * segT,
        );
      }
      accumulated += segDist;
    }

    const last = this.chainPoints[this.chainPoints.length - 1];
    return new THREE.Vector2(last.x, last.y);
  }

  private buildHeaderOverlays(ports: THREE.Vector2[], pipeW: number): void {
    this.headerGasOverlays = [];
    for (let i = 0; i < ports.length; i++) {
      const overlays: THREE.Mesh[] = [];
      const port = ports[i];
      const dx = this.collectorPos.x - port.x;
      const dy = this.collectorPos.y - port.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dx, dy);

      for (let s = 0; s < HEADER_OVERLAY_SEGS; s++) {
        const segLen = len / HEADER_OVERLAY_SEGS;
        const t = (s + 0.5) / HEADER_OVERLAY_SEGS;
        const geo = new THREE.PlaneGeometry(pipeW * 2.5, segLen * 0.85);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xff6600,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.partName = "Exhaust Gas";
        mesh.position.set(
          port.x + dx * t,
          port.y + dy * t,
          -0.15,
        );
        mesh.rotation.z = angle;
        overlays.push(mesh);
        this.group.add(mesh);
      }
      this.headerGasOverlays.push(overlays);
    }
  }

  private buildChainOverlays(pipeW: number, boreS: number): void {
    this.chainGasOverlays = [];
    if (this.chainPoints.length < 2) return;

    const startX = this.chainPoints[0].x;
    const endX = this.chainPoints[this.chainPoints.length - 1].x;
    const totalLen = endX - startX;
    if (totalLen <= 0) return;
    const segLen = totalLen / CHAIN_OVERLAY_SEGS;

    for (let i = 0; i < CHAIN_OVERLAY_SEGS; i++) {
      const geo = new THREE.PlaneGeometry(segLen * 0.9, pipeW * 2.5);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.partName = "Exhaust Gas";
      mesh.position.set(startX + i * segLen + segLen / 2, this.chainY, -0.2);
      this.chainGasOverlays.push(mesh);
      this.group.add(mesh);
    }
  }

  private buildBlobPool(boreS: number): void {
    this.blobPool = [];
    this.blobs = [];
    const blobRadius = boreS * 0.04;

    for (let i = 0; i < BLOB_POOL_SIZE; i++) {
      const geo = new THREE.CircleGeometry(blobRadius, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffcc44,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.userData.partName = "Exhaust Gas";
      this.blobPool.push(mesh);
      this.group.add(mesh);
    }
  }

  private clearMeshes(): void {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      this.group.remove(child);
    }
    this.headerPipes = [];
    this.collector = null;
    this.midPipe = null;
    this.cat = null;
    this.resonator = null;
    this.muffler = null;
    this.tips = [];
    this.headerGasOverlays = [];
    this.chainGasOverlays = [];
    this.blobPool = [];
    this.blobs = [];
    this.headerPaths = [];
    this.chainPoints = [];
  }

  private addConnector(x: number, y: number, len: number, thick: number): void {
    const geo = new THREE.PlaneGeometry(len, thick);
    const mat = new THREE.MeshBasicMaterial({ color: 0x996633 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.partName = "Mid Pipe";
    mesh.position.set(x + len / 2, y, -0.5);
    this.group.add(mesh);
  }

  private addHoneycombLines(cx: number, cy: number, w: number, h: number): void {
    const lineCount = 4;
    for (let i = 0; i < lineCount; i++) {
      const t = (i + 0.5) / lineCount;
      const lx = cx - w / 2 + t * w;
      const pts = [new THREE.Vector3(lx, cy - h / 2 + h * 0.15, -0.3), new THREE.Vector3(lx, cy + h / 2 - h * 0.15, -0.3)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: 0xaacc66, transparent: true, opacity: 0.4 });
      const line = new THREE.Line(geo, mat);
      line.userData.partName = "Catalytic Converter";
      this.group.add(line);
    }
  }

  private addBaffleLines(cx: number, cy: number, w: number, h: number): void {
    for (let i = 0; i < 2; i++) {
      const t = (i + 1) / 3;
      const lx = cx - w / 2 + t * w;
      const pts = [new THREE.Vector3(lx, cy - h / 2 + h * 0.1, -0.3), new THREE.Vector3(lx, cy + h / 2 - h * 0.1, -0.3)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: 0x8888aa, transparent: true, opacity: 0.3 });
      const line = new THREE.Line(geo, mat);
      line.userData.partName = "Muffler";
      this.group.add(line);
    }
  }

  private createRoundedRectShape(w: number, h: number, r: number): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    return new THREE.ShapeGeometry(shape);
  }

  private createFlaredTip(w: number, h: number): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    const narrowH = h * 0.6;
    shape.moveTo(-w / 2, -narrowH / 2);
    shape.lineTo(w / 2, -h / 2);
    shape.lineTo(w / 2, h / 2);
    shape.lineTo(-w / 2, narrowH / 2);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }
}
