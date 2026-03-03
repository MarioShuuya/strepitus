/**
 * Exhaust system visualization — header pipes, collector, cat, resonator,
 * muffler, tip with animated gas flow, per-header overlays, and traveling
 * gas blobs.
 *
 * Layout: exhaust routes BELOW the engine block.
 * Headers drop vertically from ports, then angle to a central collector.
 * The chain (cat, resonator, muffler, tips) runs horizontally rightward.
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

/** Multi-segment header path (waypoints from port to collector) */
interface HeaderPath {
  segments: THREE.Vector2[];  // [port, elbow, collector]
  totalLength: number;
}

/** Segments along the post-collector chain for blob interpolation */
interface ChainSegment {
  x: number;
  y: number;
}

const BLOB_POOL_SIZE = 24;
const HEADER_OVERLAY_SEGS = 6;
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
  private headerPaths: HeaderPath[] = [];
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
  /** Lowest Y extent of the exhaust system (for camera framing) */
  extentBottom = 0;

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
    const cfg = this.config;
    // Header pipe width scales with configured diameter (30-65mm range)
    const pipeW = boreS * 0.03 + boreS * 0.04 * (cfg.header.diameter / 65);
    const disabledPipeW = boreS * 0.02; // thin generic pipe when headers disabled

    // --- Layout: exhaust below the engine ---
    // Chain Y: horizontal run for collector → cat → muffler → tips
    this.chainY = -strokeS * 1.4;

    // Collector centered below engine
    const centerX = 0;
    this.collectorPos = new THREE.Vector2(centerX, this.chainY);

    // 1. Header pipes — L-shaped when enabled, simple straight when disabled
    // Real headers: short horizontal exit from port toward center, then drop to collector
    this.headerPaths = [];
    for (let i = 0; i < exhaustPortPositions.length; i++) {
      const port = exhaustPortPositions[i];
      const collector = this.collectorPos.clone();

      if (cfg.header.enabled) {
        // L-shaped: horizontal run from port toward collector X, then vertical drop
        // Elbow is near the port — at collector's X but at the port's Y (slightly below)
        const elbowY = port.y - strokeS * 0.15; // just below the port
        const elbow = new THREE.Vector2(collector.x, elbowY);
        const pw = pipeW;

        // Horizontal segment: port → elbow (moves toward center)
        const hDx = elbow.x - port.x;
        const hDy = elbow.y - port.y;
        const hLen = Math.sqrt(hDx * hDx + hDy * hDy);
        const hAngle = Math.atan2(hDx, hDy);
        const hGeo = new THREE.PlaneGeometry(pw, hLen);
        const hMat = new THREE.MeshBasicMaterial({ color: 0xcc6633 });
        const hMesh = new THREE.Mesh(hGeo, hMat);
        hMesh.userData.partName = "Header Pipe";
        hMesh.position.set(port.x + hDx / 2, port.y + hDy / 2, -0.5);
        hMesh.rotation.z = hAngle;
        this.headerPipes.push(hMesh);
        this.group.add(hMesh);

        // Vertical segment: elbow → collector (drops straight down)
        const vDx = collector.x - elbow.x;
        const vDy = collector.y - elbow.y;
        const vLen = Math.sqrt(vDx * vDx + vDy * vDy);
        if (vLen > 1) {
          const vAngle = Math.atan2(vDx, vDy);
          const vGeo = new THREE.PlaneGeometry(pw, vLen);
          const vMat = new THREE.MeshBasicMaterial({ color: 0xcc6633 });
          const vMesh = new THREE.Mesh(vGeo, vMat);
          vMesh.userData.partName = "Header Pipe";
          vMesh.position.set(elbow.x + vDx / 2, elbow.y + vDy / 2, -0.5);
          vMesh.rotation.z = vAngle;
          this.headerPipes.push(vMesh);
          this.group.add(vMesh);
        }

        this.headerPaths.push({
          segments: [port.clone(), elbow.clone(), collector.clone()],
          totalLength: hLen + vLen,
        });
      } else {
        // Headers disabled — thin straight pipe from port to collector
        const dx = collector.x - port.x;
        const dy = collector.y - port.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dx, dy);
        const geo = new THREE.PlaneGeometry(disabledPipeW, len);
        const mat = new THREE.MeshBasicMaterial({ color: 0x665544, transparent: true, opacity: 0.5 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.partName = "Header Pipe";
        mesh.position.set(port.x + dx / 2, port.y + dy / 2, -0.5);
        mesh.rotation.z = angle;
        this.headerPipes.push(mesh);
        this.group.add(mesh);

        this.headerPaths.push({
          segments: [port.clone(), collector.clone()],
          totalLength: len,
        });
      }
    }

    // 2. Collector — shape varies by type
    const collW = boreS * 0.18;
    const collH = boreS * 0.15;
    // Color varies by collector type: 4-1 standard, 4-2-1 brighter, log darker
    const collColor = !cfg.header.enabled ? 0x665544
      : cfg.header.collectorType === "4-2-1" ? 0xcc7733
      : cfg.header.collectorType === "log" ? 0x886633
      : 0xaa5522;
    const collGeo = new THREE.PlaneGeometry(collW, collH);
    const collMat = new THREE.MeshBasicMaterial({
      color: collColor,
      transparent: !cfg.header.enabled,
      opacity: cfg.header.enabled ? 1.0 : 0.5,
    });
    this.collector = new THREE.Mesh(collGeo, collMat);
    this.collector.userData.partName = "Collector";
    this.collector.position.set(this.collectorPos.x, this.collectorPos.y, -0.5);
    this.group.add(this.collector);

    // Collector internal lines for 4-2-1 or log styles
    if (cfg.header.enabled && cfg.header.collectorType === "4-2-1") {
      // Show merge lines for 4-2-1
      const cx = this.collectorPos.x, cy = this.collectorPos.y;
      const pts = [new THREE.Vector3(cx, cy - collH * 0.35, -0.3), new THREE.Vector3(cx, cy + collH * 0.35, -0.3)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: 0xddaa55, transparent: true, opacity: 0.5 });
      const line = new THREE.Line(geo, mat);
      line.userData.partName = "Collector";
      this.group.add(line);
    }

    // Build the horizontal exhaust chain from collector rightward
    let curX = this.collectorPos.x + collW / 2 + pipeW;
    const componentGap = boreS * 0.04;

    // Track chain waypoints for blob interpolation
    this.chainPoints = [{ x: this.collectorPos.x, y: this.chainY }];

    // 3. Mid pipe segment (collector → first component) — scaled up
    const midLen = boreS * 0.5;
    const midGeo = new THREE.PlaneGeometry(midLen, pipeW);
    const midMat = new THREE.MeshBasicMaterial({ color: 0x996633 });
    this.midPipe = new THREE.Mesh(midGeo, midMat);
    this.midPipe.userData.partName = "Mid Pipe";
    this.midPipe.position.set(curX + midLen / 2, this.chainY, -0.5);
    this.group.add(this.midPipe);
    curX += midLen + componentGap;
    this.chainPoints.push({ x: curX, y: this.chainY });

    // 4. Catalytic converter — scaled up
    if (cfg.cat.enabled) {
      const catW = boreS * 0.35;
      const catH = boreS * 0.18;
      const catGeo = new THREE.PlaneGeometry(catW, catH);
      const catMat = new THREE.MeshBasicMaterial({ color: 0x88aa44 });
      this.cat = new THREE.Mesh(catGeo, catMat);
      this.cat.userData.partName = "Catalytic Converter";
      this.cat.position.set(curX + catW / 2, this.chainY, -0.5);
      this.group.add(this.cat);

      this.addHoneycombLines(curX + catW / 2, this.chainY, catW, catH);
      curX += catW + componentGap;

      this.addConnector(curX, this.chainY, boreS * 0.1, pipeW);
      curX += boreS * 0.1 + componentGap;
      this.chainPoints.push({ x: curX, y: this.chainY });
    }

    // 5. Resonator — type affects appearance
    if (cfg.resonator.enabled) {
      // Scale resonator size with configured diameter
      const resScale = cfg.resonator.diameter / 100; // normalize around 100mm
      const resW = boreS * 0.30 * resScale;
      const resH = boreS * 0.15 * resScale;
      const resColor = cfg.resonator.type === "helmholtz" ? 0x7799aa : 0x6688bb;
      const resGeo = new THREE.PlaneGeometry(resW, resH);
      const resMat = new THREE.MeshBasicMaterial({ color: resColor });
      this.resonator = new THREE.Mesh(resGeo, resMat);
      this.resonator.userData.partName = "Resonator";
      this.resonator.position.set(curX + resW / 2, this.chainY, -0.5);
      this.group.add(this.resonator);

      // Helmholtz shows a neck line, quarter-wave shows perforations
      if (cfg.resonator.type === "helmholtz") {
        const cx = curX + resW / 2, cy = this.chainY;
        const pts = [new THREE.Vector3(cx - resW * 0.15, cy, -0.3), new THREE.Vector3(cx - resW * 0.15, cy - resH * 0.4, -0.3)];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: 0x99bbcc, transparent: true, opacity: 0.5 });
        const line = new THREE.Line(geo, mat);
        line.userData.partName = "Resonator";
        this.group.add(line);
      } else {
        // Quarter-wave: dashed perforations
        for (let d = 0; d < 3; d++) {
          const t = (d + 1) / 4;
          const cx = curX + resW * t, cy = this.chainY;
          const dotGeo = new THREE.CircleGeometry(pipeW * 0.4, 6);
          const dotMat = new THREE.MeshBasicMaterial({ color: 0x99bbcc, transparent: true, opacity: 0.4 });
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.userData.partName = "Resonator";
          dot.position.set(cx, cy, -0.3);
          this.group.add(dot);
        }
      }

      curX += resW + componentGap;

      this.addConnector(curX, this.chainY, boreS * 0.1, pipeW);
      curX += boreS * 0.1 + componentGap;
      this.chainPoints.push({ x: curX, y: this.chainY });
    }

    // 6. Muffler — type and volume affect appearance
    if (cfg.muffler.enabled) {
      // Scale muffler with volume (1-15L range)
      const volScale = 0.7 + (cfg.muffler.volume / 15) * 0.6;
      const mufW = boreS * 0.55 * volScale;
      const mufH = boreS * 0.22 * volScale;
      // Color varies by type
      const mufColor = cfg.muffler.type === "straight-through" ? 0x777799
        : cfg.muffler.type === "turbo" ? 0x667788
        : 0x666688; // chambered
      const mufGeo = this.createRoundedRectShape(mufW, mufH, boreS * 0.03);
      const mufMat = new THREE.MeshBasicMaterial({ color: mufColor });
      this.muffler = new THREE.Mesh(mufGeo, mufMat);
      this.muffler.userData.partName = "Muffler";
      this.muffler.position.set(curX + mufW / 2, this.chainY, -0.5);
      this.group.add(this.muffler);

      // Internal detail varies by type
      if (cfg.muffler.type === "chambered") {
        this.addBaffleLines(curX + mufW / 2, this.chainY, mufW, mufH);
      } else if (cfg.muffler.type === "turbo") {
        // Swirl pattern — curved line inside
        const cx = curX + mufW / 2, cy = this.chainY;
        const pts: THREE.Vector3[] = [];
        for (let a = 0; a < 8; a++) {
          const t = a / 7;
          const angle = t * Math.PI * 1.5;
          const r = mufH * 0.3 * (1 - t * 0.3);
          pts.push(new THREE.Vector3(cx + Math.cos(angle) * r * 0.8, cy + Math.sin(angle) * r, -0.3));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.4 });
        const line = new THREE.Line(geo, mat);
        line.userData.partName = "Muffler";
        this.group.add(line);
      } else if (cfg.muffler.type === "straight-through") {
        // Simple through-pipe line
        const cx = curX + mufW / 2, cy = this.chainY;
        const pts = [
          new THREE.Vector3(cx - mufW * 0.4, cy, -0.3),
          new THREE.Vector3(cx + mufW * 0.4, cy, -0.3),
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: 0x9999bb, transparent: true, opacity: 0.5 });
        const line = new THREE.Line(geo, mat);
        line.userData.partName = "Muffler";
        this.group.add(line);
      }

      curX += mufW + componentGap;

      this.addConnector(curX, this.chainY, boreS * 0.06, pipeW);
      curX += boreS * 0.06 + componentGap;
      this.chainPoints.push({ x: curX, y: this.chainY });
    }

    // 7. Tip(s) — scale with configured diameter
    const tipCount = cfg.tip.enabled
      ? (cfg.tip.type === "quad" ? 4 : cfg.tip.type === "dual" ? 2 : 1)
      : 1;
    const tipScale = cfg.tip.enabled ? cfg.tip.diameter / 80 : 0.6; // normalize around 80mm
    const tipW = boreS * 0.12 * tipScale;
    const tipH = boreS * 0.09 * tipScale;
    const tipSpacing = tipH * 1.4;
    const tipStartY = this.chainY - ((tipCount - 1) * tipSpacing) / 2;

    for (let t = 0; t < tipCount; t++) {
      const tipGeo = this.createFlaredTip(tipW, tipH);
      const tipColor = cfg.tip.enabled ? 0xcccccc : 0x888888;
      const tipMat = new THREE.MeshBasicMaterial({ color: tipColor });
      const tipMesh = new THREE.Mesh(tipGeo, tipMat);
      tipMesh.userData.partName = "Exhaust Tip";
      tipMesh.position.set(curX + tipW / 2, tipStartY + t * tipSpacing, -0.4);
      this.tips.push(tipMesh);
      this.group.add(tipMesh);
    }
    curX += tipW;
    this.chainPoints.push({ x: curX, y: this.chainY });

    // 8. Per-header gas overlays
    this.buildHeaderOverlays(pipeW);

    // 9. Post-collector chain gas overlays
    this.buildChainOverlays(pipeW, boreS);

    // 10. Blob pool — traveling hot spots
    this.buildBlobPool(boreS);

    this.extentRight = curX;
    // Record lowest Y for camera framing
    this.extentBottom = this.chainY - boreS * 0.15;
    this.prevPulseIntensities = new Array(this.cylinderCount).fill(0);
    this.headerHeat = new Array(this.cylinderCount).fill(0);
  }

  update(cylinders: CylinderData[], rpm: number): void {
    if (this.headerGasOverlays.length === 0 && this.chainGasOverlays.length === 0) return;

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
    // Pipe count per cylinder varies: 2 when headers enabled (vertical + diagonal), 1 when disabled
    const pipesPerCyl = this.headerPaths.length > 0 && this.headerPaths[0].segments.length > 2 ? 2 : 1;
    for (let h = 0; h < this.headerPipes.length; h++) {
      const hp = this.headerPipes[h];
      const hpMat = hp.material as THREE.MeshBasicMaterial;
      const cylIdx = Math.min(Math.floor(h / pipesPerCyl), cylinders.length - 1);
      const cylTemp = cylinders[cylIdx]?.exhaust_gas_temp ?? 300;
      const heat = this.headerHeat[cylIdx] ?? 0;
      const baseColor = this.config.header.enabled ? 0xcc6633 : 0x665544;
      const tintColor = temperatureColor(cylTemp * 0.8);
      hpMat.color.copy(new THREE.Color(baseColor).lerp(tintColor, Math.min(heat * 0.6, 0.6)));
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
    if (this.headerPaths.length === 0) return 0.3;
    const hp = this.headerPaths[0];
    const headerLen = hp.totalLength;
    const chainLen = this.getChainTotalLength();
    return headerLen / (headerLen + chainLen);
  }

  private getChainTotalLength(): number {
    if (this.chainPoints.length < 2) return 1;
    let total = 0;
    for (let i = 0; i < this.chainPoints.length - 1; i++) {
      const dx = this.chainPoints[i + 1].x - this.chainPoints[i].x;
      const dy = this.chainPoints[i + 1].y - this.chainPoints[i].y;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total || 1;
  }

  private spawnBlob(cylinderIndex: number, intensity: number, temp: number): void {
    if (this.blobs.length >= BLOB_POOL_SIZE) {
      // Recycle oldest
      this.blobs.shift();
      if (this.blobPool.length > 0) {
        this.blobPool[0].visible = false;
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
      // In the header pipe for this cylinder — interpolate along multi-segment path
      const t = blob.progress / headerFrac;
      const pathIdx = Math.min(blob.cylinderIndex, this.headerPaths.length - 1);
      if (pathIdx < 0) return this.collectorPos.clone();
      const path = this.headerPaths[pathIdx];
      return this.interpolateAlongSegments(path.segments, path.totalLength, t);
    }

    // In the chain (post-collector)
    const chainT = (blob.progress - headerFrac) / (1 - headerFrac);
    if (this.chainPoints.length < 2) return this.collectorPos.clone();

    const chainLen = this.getChainTotalLength();
    const targetDist = chainT * chainLen;
    let accumulated = 0;

    for (let i = 0; i < this.chainPoints.length - 1; i++) {
      const dx = this.chainPoints[i + 1].x - this.chainPoints[i].x;
      const dy = this.chainPoints[i + 1].y - this.chainPoints[i].y;
      const segDist = Math.sqrt(dx * dx + dy * dy);
      if (accumulated + segDist >= targetDist) {
        const segT = (targetDist - accumulated) / Math.max(segDist, 0.001);
        return new THREE.Vector2(
          this.chainPoints[i].x + dx * segT,
          this.chainPoints[i].y + dy * segT,
        );
      }
      accumulated += segDist;
    }

    const last = this.chainPoints[this.chainPoints.length - 1];
    return new THREE.Vector2(last.x, last.y);
  }

  /** Interpolate along a polyline of waypoints */
  private interpolateAlongSegments(segments: THREE.Vector2[], totalLen: number, t: number): THREE.Vector2 {
    const targetDist = t * totalLen;
    let accumulated = 0;

    for (let i = 0; i < segments.length - 1; i++) {
      const dx = segments[i + 1].x - segments[i].x;
      const dy = segments[i + 1].y - segments[i].y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      if (accumulated + segLen >= targetDist) {
        const segT = (targetDist - accumulated) / Math.max(segLen, 0.001);
        return new THREE.Vector2(
          segments[i].x + dx * segT,
          segments[i].y + dy * segT,
        );
      }
      accumulated += segLen;
    }

    const last = segments[segments.length - 1];
    return last.clone();
  }

  private buildHeaderOverlays(pipeW: number): void {
    this.headerGasOverlays = [];
    for (let i = 0; i < this.headerPaths.length; i++) {
      const overlays: THREE.Mesh[] = [];
      const path = this.headerPaths[i];

      for (let s = 0; s < HEADER_OVERLAY_SEGS; s++) {
        const t = (s + 0.5) / HEADER_OVERLAY_SEGS;
        const pos = this.interpolateAlongSegments(path.segments, path.totalLength, t);

        // Determine local angle from surrounding points
        const tA = Math.max(0, (s / HEADER_OVERLAY_SEGS));
        const tB = Math.min(1, ((s + 1) / HEADER_OVERLAY_SEGS));
        const pA = this.interpolateAlongSegments(path.segments, path.totalLength, tA);
        const pB = this.interpolateAlongSegments(path.segments, path.totalLength, tB);
        const dx = pB.x - pA.x;
        const dy = pB.y - pA.y;
        const angle = Math.atan2(dx, dy);

        const segLen = path.totalLength / HEADER_OVERLAY_SEGS;
        const geo = new THREE.PlaneGeometry(pipeW * 2.5, segLen * 0.85);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xff6600,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.partName = "Exhaust Gas";
        mesh.position.set(pos.x, pos.y, -0.15);
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
    const blobRadius = boreS * 0.05;

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
    const lineCount = 5;
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
    for (let i = 0; i < 3; i++) {
      const t = (i + 1) / 4;
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
