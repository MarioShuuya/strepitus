/**
 * 2D cross-section engine renderer using Three.js orthographic camera.
 * Supports single and multi-cylinder rendering.
 */

import * as THREE from "three";
import { temperatureColor, pressureOpacity } from "./materials";
import { ForceArrows } from "./force-arrows";

export interface EngineViewState {
  piston_position: number;
  crank_angle: number;
  intake_valve_lift: number;
  exhaust_valve_lift: number;
  cylinder_pressure: number;
  gas_temperature: number;
  wall_temperature: number;
  stroke_phase: number;
  burn_fraction: number;
  cylinder_volume: number;
  gas_force: number;
  inertia_force: number;
  friction_force: number;
  throttle_position?: number;
  manifold_pressure?: number;
}

/** Per-cylinder data for multi-cylinder mode */
export interface CylinderData {
  piston_position: number;
  crank_angle: number;
  cylinder_pressure: number;
  gas_temperature: number;
  wall_temperature: number;
  stroke_phase: number;
  intake_valve_lift: number;
  exhaust_valve_lift: number;
  burn_fraction: number;
  cylinder_volume: number;
  gas_force: number;
  inertia_force: number;
  friction_force: number;
}

/** A set of meshes for one cylinder */
class CylinderUnit {
  cylinder: THREE.Mesh;
  piston: THREE.Mesh;
  conRod: THREE.Mesh;
  crankPin: THREE.Mesh;
  gasFill: THREE.Mesh;
  forceArrows: ForceArrows;
  group: THREE.Group;

  // Spark plug
  sparkPlug: THREE.Mesh;
  private sparkTimer = 0;
  private prevBurnFraction = 0;

  // Fuel injector
  injectorBody: THREE.Mesh;
  sprayDots: THREE.Mesh[];

  // Intake runner connection point (top of cylinder head)
  readonly headTopY: number;

  constructor(
    scene: THREE.Scene,
    bore: number,
    stroke: number,
    scale: number,
    xOffset: number
  ) {
    this.group = new THREE.Group();
    this.group.position.x = xOffset;

    const boreS = bore * scale;
    const strokeS = stroke * scale;
    this.headTopY = strokeS; // cylinder top in local coords

    // Cylinder
    const cylGeo = new THREE.PlaneGeometry(boreS, strokeS * 1.5);
    const cylMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a2e,
      transparent: true,
      opacity: 0.6,
    });
    this.cylinder = new THREE.Mesh(cylGeo, cylMat);
    this.cylinder.position.y = strokeS / 4;

    // Piston
    const pistonGeo = new THREE.PlaneGeometry(boreS * 0.9, boreS * 0.3);
    const pistonMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
    this.piston = new THREE.Mesh(pistonGeo, pistonMat);

    // Con rod
    const rodGeo = new THREE.PlaneGeometry(4, 100);
    const rodMat = new THREE.MeshBasicMaterial({ color: 0x666666 });
    this.conRod = new THREE.Mesh(rodGeo, rodMat);

    // Crank pin
    const pinGeo = new THREE.CircleGeometry(6, 16);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });
    this.crankPin = new THREE.Mesh(pinGeo, pinMat);

    // Gas fill
    const gasFillGeo = new THREE.PlaneGeometry(boreS * 0.88, 1);
    const gasFillMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.15,
    });
    this.gasFill = new THREE.Mesh(gasFillGeo, gasFillMat);
    this.gasFill.position.z = 0.5;

    // Spark plug — small triangle at cylinder top center
    const sparkGeo = new THREE.BufferGeometry();
    const sz = boreS * 0.08;
    sparkGeo.setAttribute("position", new THREE.Float32BufferAttribute([
      0, sz, 0,  -sz * 0.6, -sz * 0.3, 0,  sz * 0.6, -sz * 0.3, 0
    ], 3));
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
    this.sparkPlug = new THREE.Mesh(sparkGeo, sparkMat);
    this.sparkPlug.position.set(0, strokeS + sz * 0.5, 1);

    // Fuel injector — small rectangle offset to the left of cylinder head
    const injW = boreS * 0.1;
    const injH = boreS * 0.2;
    const injGeo = new THREE.PlaneGeometry(injW, injH);
    const injMat = new THREE.MeshBasicMaterial({ color: 0x666666 });
    this.injectorBody = new THREE.Mesh(injGeo, injMat);
    this.injectorBody.position.set(-boreS * 0.35, strokeS + injH * 0.3, 1);

    // Spray dots — 3 small circles below injector
    this.sprayDots = [];
    for (let i = 0; i < 3; i++) {
      const dotGeo = new THREE.CircleGeometry(boreS * 0.02, 8);
      const dotMat = new THREE.MeshBasicMaterial({
        color: 0x4ade80,
        transparent: true,
        opacity: 0,
      });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(
        -boreS * 0.35 + (i - 1) * boreS * 0.06,
        strokeS - boreS * 0.05 - i * boreS * 0.04,
        1
      );
      this.sprayDots.push(dot);
      this.group.add(dot);
    }

    this.group.add(
      this.cylinder,
      this.gasFill,
      this.piston,
      this.conRod,
      this.crankPin,
      this.sparkPlug,
      this.injectorBody
    );
    scene.add(this.group);

    this.forceArrows = new ForceArrows(scene, scale);
    // Offset force arrows to match cylinder position
    this.forceArrows.setGroupOffset(xOffset);
  }

  update(
    state: CylinderData,
    bore: number,
    stroke: number,
    scale: number
  ): void {
    const s = scale;
    const r = (stroke / 2) * s;

    const pistonY = -state.piston_position * s + stroke * s * 0.5;
    this.piston.position.y = pistonY;

    const angle = state.crank_angle % (2 * Math.PI);
    const crankX = r * Math.sin(angle);
    const crankY = -r * Math.cos(angle) - stroke * s * 0.3;
    this.crankPin.position.set(crankX, crankY, 0);

    const rodCenterX = crankX / 2;
    const rodCenterY = (pistonY + crankY) / 2;
    this.conRod.position.set(rodCenterX, rodCenterY, 0);
    const dx = crankX;
    const dy = crankY - pistonY;
    const rodLength = Math.sqrt(dx * dx + dy * dy);
    this.conRod.scale.y = rodLength / 100;
    this.conRod.rotation.z = Math.atan2(dx, dy);

    // Wall color
    const wallColor = temperatureColor(state.wall_temperature);
    (this.cylinder.material as THREE.MeshBasicMaterial).color.copy(wallColor);
    (this.cylinder.material as THREE.MeshBasicMaterial).opacity = 0.4;

    // Piston color
    const pistonTemp =
      state.wall_temperature * 0.6 + state.gas_temperature * 0.4;
    (this.piston.material as THREE.MeshBasicMaterial).color.copy(
      temperatureColor(pistonTemp)
    );

    // Gas fill
    const cylinderTop = stroke * s;
    const pistonTop = pistonY + (bore * s * 0.3) / 2;
    const gasHeight = Math.max(cylinderTop - pistonTop, 1);
    this.gasFill.scale.y = gasHeight;
    this.gasFill.position.y = pistonTop + gasHeight / 2;
    const gasMat = this.gasFill.material as THREE.MeshBasicMaterial;
    gasMat.color.copy(temperatureColor(state.gas_temperature));
    gasMat.opacity = pressureOpacity(state.cylinder_pressure);

    // Force arrows
    this.forceArrows.update(
      pistonY,
      state.gas_force,
      state.inertia_force,
      state.friction_force
    );

    // Spark plug flash — trigger when burn_fraction crosses 0→>0
    if (state.burn_fraction > 0.01 && this.prevBurnFraction <= 0.01) {
      this.sparkTimer = 1.0;
    }
    this.prevBurnFraction = state.burn_fraction;
    if (this.sparkTimer > 0) {
      this.sparkTimer = Math.max(0, this.sparkTimer - 0.06);
      const sparkColor = new THREE.Color().lerpColors(
        new THREE.Color(0x888888),
        new THREE.Color(0xffff66),
        this.sparkTimer
      );
      (this.sparkPlug.material as THREE.MeshBasicMaterial).color.copy(sparkColor);
    }

    // Fuel injector spray — visible during intake (phase 0) with valve open
    const spraying = state.stroke_phase === 0 && state.intake_valve_lift > 0.001;
    (this.injectorBody.material as THREE.MeshBasicMaterial).color.setHex(
      spraying ? 0x4ade80 : 0x666666
    );
    for (let i = 0; i < this.sprayDots.length; i++) {
      const dotMat = this.sprayDots[i].material as THREE.MeshBasicMaterial;
      dotMat.opacity = spraying ? 0.4 + Math.sin(Date.now() * 0.01 + i * 2) * 0.3 : 0;
    }
  }

  setForceArrowsVisible(v: boolean): void {
    this.forceArrows.setVisible(v);
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
  }
}

export class EngineView {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;

  private units: CylinderUnit[] = [];
  private _forceArrowsVisible = true;

  private readonly scale = 1000;
  private bore: number;
  private stroke: number;
  private cylinderCount: number;

  // Throttle body visuals
  private throttleGroup: THREE.Group;
  private throttlePlate: THREE.Mesh;
  private intakeRunners: THREE.Mesh[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    bore: number,
    stroke: number,
    cylinderCount = 1
  ) {
    this.bore = bore;
    this.stroke = stroke;
    this.cylinderCount = cylinderCount;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0a);

    const aspect = canvas.clientWidth / canvas.clientHeight;
    const viewSize = this.computeViewSize();
    const centerY = this.computeCenterY();
    this.camera = new THREE.OrthographicCamera(
      -viewSize * aspect,
      viewSize * aspect,
      viewSize,
      -viewSize,
      0.1,
      1000
    );
    this.camera.position.set(0, centerY, 10);
    this.camera.lookAt(0, centerY, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // Init throttle group (populated in buildCylinders)
    this.throttleGroup = new THREE.Group();
    this.throttlePlate = new THREE.Mesh();
    this.scene.add(this.throttleGroup);

    this.buildCylinders();

    window.addEventListener("resize", () => this.onResize(canvas));
  }

  private computeViewSize(): number {
    // Scale view to fit all cylinders with some padding
    const boreS = this.bore * this.scale;
    const strokeS = this.stroke * this.scale;
    const baseSize = 0.3 * this.scale;
    if (this.cylinderCount <= 1) return baseSize;
    // Need to fit: horizontal spread + vertical extent (crank below to throttle above)
    const horizontalHalf = (this.cylinderCount - 1) * boreS * 1.3 / 2 + boreS;
    const verticalHalf = strokeS * 1.2 + boreS; // crank below + cylinder + throttle above
    return Math.max(horizontalHalf, verticalHalf, baseSize);
  }

  /** Compute the vertical center of the engine geometry */
  private computeCenterY(): number {
    const strokeS = this.stroke * this.scale;
    const boreS = this.bore * this.scale;
    // Engine extends from ~-stroke*0.3*scale (crankshaft) to ~strokeS + boreS*0.8 (throttle body)
    const bottom = -strokeS * 0.4;
    const top = strokeS + boreS * 0.9;
    return (bottom + top) / 2;
  }

  private buildCylinders(): void {
    const spacing = this.bore * this.scale * 1.3;
    const totalWidth = spacing * (this.cylinderCount - 1);
    const startX = -totalWidth / 2;

    for (let i = 0; i < this.cylinderCount; i++) {
      const xOffset = startX + i * spacing;
      const unit = new CylinderUnit(
        this.scene,
        this.bore,
        this.stroke,
        this.scale,
        xOffset
      );
      unit.setForceArrowsVisible(this._forceArrowsVisible);
      this.units.push(unit);
    }

    this.buildThrottleBody(startX, spacing);
  }

  private buildThrottleBody(startX: number, spacing: number): void {
    // Clear previous
    while (this.throttleGroup.children.length > 0) {
      this.throttleGroup.remove(this.throttleGroup.children[0]);
    }
    this.intakeRunners = [];

    const boreS = this.bore * this.scale;
    const strokeS = this.stroke * this.scale;
    const throttleY = strokeS + boreS * 0.8;
    const throttleX = startX - boreS * 0.6;

    // Manifold body — horizontal rectangle
    const bodyW = boreS * 0.6;
    const bodyH = boreS * 0.25;
    const bodyGeo = new THREE.PlaneGeometry(bodyW, bodyH);
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(throttleX, throttleY, 0);
    this.throttleGroup.add(body);

    // Throttle plate — thin rectangle that rotates inside the body
    const plateW = bodyH * 0.85;
    const plateH = boreS * 0.04;
    const plateGeo = new THREE.PlaneGeometry(plateW, plateH);
    const plateMat = new THREE.MeshBasicMaterial({ color: 0x999999 });
    this.throttlePlate = new THREE.Mesh(plateGeo, plateMat);
    this.throttlePlate.position.set(throttleX, throttleY, 0.5);
    this.throttleGroup.add(this.throttlePlate);

    // Intake runners — lines from throttle body down to each cylinder head
    for (let i = 0; i < this.cylinderCount; i++) {
      const cylX = startX + i * spacing;
      const cylTopY = strokeS;

      // Runner: vertical line from throttle level down to cylinder top
      const runnerH = throttleY - cylTopY;
      const midY = cylTopY + runnerH / 2;

      // Horizontal segment from throttle to above cylinder
      const hSegW = Math.abs(cylX - throttleX);
      if (hSegW > 1) {
        const hGeo = new THREE.PlaneGeometry(hSegW, boreS * 0.03);
        const hMat = new THREE.MeshBasicMaterial({
          color: 0x444444,
          transparent: true,
          opacity: 0.8,
        });
        const hSeg = new THREE.Mesh(hGeo, hMat);
        hSeg.position.set((throttleX + cylX) / 2, throttleY, 0);
        this.throttleGroup.add(hSeg);
      }

      // Vertical segment down to cylinder head
      const vGeo = new THREE.PlaneGeometry(boreS * 0.03, runnerH);
      const vMat = new THREE.MeshBasicMaterial({
        color: 0x444444,
        transparent: true,
        opacity: 0.8,
      });
      const vSeg = new THREE.Mesh(vGeo, vMat);
      vSeg.position.set(cylX, midY, 0);
      this.intakeRunners.push(vSeg);
      this.throttleGroup.add(vSeg);
    }
  }

  /** Single-cylinder update (backward compatible) */
  update(state: EngineViewState): void {
    if (this.units.length === 0) return;
    this.units[0].update(state, this.bore, this.stroke, this.scale);
    this.updateThrottlePlate(state.throttle_position ?? 1.0);
    this.updateRunnerColors([state]);
  }

  /** Multi-cylinder update */
  updateMulti(cylinders: CylinderData[]): void {
    for (let i = 0; i < this.units.length && i < cylinders.length; i++) {
      this.units[i].update(cylinders[i], this.bore, this.stroke, this.scale);
    }
  }

  /** Update shared throttle-position data for multi-cyl (called from main.ts) */
  updateThrottle(throttlePosition: number, cylinders?: CylinderData[]): void {
    this.updateThrottlePlate(throttlePosition);
    if (cylinders) this.updateRunnerColors(cylinders);
  }

  private updateThrottlePlate(throttle: number): void {
    // Rotation: 0 (closed) = perpendicular (PI/2), 1 (WOT) = parallel (0)
    const angle = (1.0 - Math.min(1, Math.max(0, throttle))) * Math.PI * 0.5;
    this.throttlePlate.rotation.z = angle;
  }

  private updateRunnerColors(cylinders: (EngineViewState | CylinderData)[]): void {
    for (let i = 0; i < this.intakeRunners.length && i < cylinders.length; i++) {
      const cyl = cylinders[i];
      const intakeOpen = cyl.intake_valve_lift > 0.001;
      const mat = this.intakeRunners[i].material as THREE.MeshBasicMaterial;
      mat.color.setHex(intakeOpen ? 0x3388aa : 0x444444);
      mat.opacity = intakeOpen ? 1.0 : 0.8;
    }
  }

  setForceArrowsVisible(visible: boolean): void {
    this._forceArrowsVisible = visible;
    for (const u of this.units) u.setForceArrowsVisible(visible);
  }

  get forceArrowsVisible(): boolean {
    return this._forceArrowsVisible;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private onResize(canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const aspect = w / h;
    const viewSize = this.computeViewSize();
    this.camera.left = -viewSize * aspect;
    this.camera.right = viewSize * aspect;
    this.camera.top = viewSize;
    this.camera.bottom = -viewSize;
    const centerY = this.computeCenterY();
    this.camera.position.set(0, centerY, 10);
    this.camera.lookAt(0, centerY, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    for (const u of this.units) u.dispose();
    this.units = [];
    this.scene.remove(this.throttleGroup);
    this.intakeRunners = [];
    this.renderer.dispose();
  }
}
