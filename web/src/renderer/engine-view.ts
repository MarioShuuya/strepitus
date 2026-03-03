/**
 * 2D cross-section engine renderer using Three.js orthographic camera.
 * Supports single and multi-cylinder rendering.
 */

import * as THREE from "three";
import { temperatureColor, pressureOpacity } from "./materials";
import { ForceArrows } from "./force-arrows";
import { ExhaustVisual } from "./exhaust-view";
import type { ExhaustSystemConfig } from "../audio/exhaust-config";

export type LayoutType = "inline" | "v" | "boxer";

export interface LayoutDefinition {
  type: LayoutType;
  label: string;
  count: number;
  offsets: number[];
  vAngle?: number;
}

// ⚠ SYNC: Offsets here are passed to Rust via crank_offsets_deg in configJson.
// Rust has a fallback table in config.rs:firing_offsets() — keep them aligned.
export const LAYOUTS: LayoutDefinition[] = [
  { type: "inline", label: "Single",   count: 1,  offsets: [] },
  { type: "inline", label: "Inline-2", count: 2,  offsets: [0, 360] },
  { type: "inline", label: "Inline-3", count: 3,  offsets: [0, 240, 480] },
  { type: "inline", label: "Inline-4", count: 4,  offsets: [0, 180, 540, 360] },
  { type: "inline", label: "Inline-6", count: 6,  offsets: [0, 120, 240, 360, 480, 600] },
  { type: "v",      label: "V6",       count: 6,  offsets: [0, 120, 240, 360, 480, 600], vAngle: 60 },
  { type: "v",      label: "V8",       count: 8,  offsets: [0, 90, 270, 180, 630, 540, 450, 360], vAngle: 90 },
  { type: "v",      label: "V10",      count: 10, offsets: [0, 72, 144, 216, 288, 360, 432, 504, 576, 648], vAngle: 90 },
  { type: "v",      label: "V12",      count: 12, offsets: [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660], vAngle: 60 },
  { type: "boxer",  label: "Flat-2",   count: 2,  offsets: [0, 360], vAngle: 180 },
  { type: "boxer",  label: "Flat-4",   count: 4,  offsets: [0, 180, 540, 360], vAngle: 180 },
  { type: "boxer",  label: "Flat-6",   count: 6,  offsets: [0, 120, 240, 360, 480, 600], vAngle: 180 },
];

export interface EnginePart {
  name: string;
  color: string;
  category: string;
}

export const ENGINE_PARTS: EnginePart[] = [
  // Block
  { name: "Cylinder Wall", color: "#556688", category: "Block" },
  { name: "Cylinder Head", color: "#556688", category: "Block" },
  { name: "Cylinder Body", color: "#1a1a2e", category: "Block" },
  // Reciprocating
  { name: "Piston", color: "#a0aab8", category: "Reciprocating" },
  { name: "Connecting Rod", color: "#708090", category: "Reciprocating" },
  // Crankshaft
  { name: "Crank Pin", color: "#cccccc", category: "Crankshaft" },
  { name: "Crank Arm", color: "#8090a0", category: "Crankshaft" },
  { name: "Counterweight", color: "#606870", category: "Crankshaft" },
  { name: "Crank Center", color: "#dddddd", category: "Crankshaft" },
  // Valvetrain
  { name: "Intake Valve", color: "#5599ff", category: "Valvetrain" },
  { name: "Exhaust Valve", color: "#ff7733", category: "Valvetrain" },
  { name: "Spark Plug", color: "#bbbbbb", category: "Valvetrain" },
  // Fuel
  { name: "Fuel Injector", color: "#666666", category: "Fuel" },
  { name: "Fuel Spray", color: "#4ade80", category: "Fuel" },
  // Combustion
  { name: "Gas Fill", color: "#4488ff", category: "Combustion" },
  { name: "Combustion Glow", color: "#ff8800", category: "Combustion" },
  // Intake
  { name: "Throttle Body", color: "#333333", category: "Intake" },
  { name: "Throttle Plate", color: "#999999", category: "Intake" },
  { name: "Intake Runner", color: "#444444", category: "Intake" },
];

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
  exhaust_pulse_intensity?: number;
  exhaust_gas_temp?: number;
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
  exhaust_pulse_intensity: number;
  exhaust_gas_temp: number;
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

  // Spark arc effect (#12)
  private sparkArc: THREE.Line;
  private sparkArcTimer = 0;

  // Combustion glow overlay (#9)
  private combustionGlow: THREE.Mesh;

  // Valve stems (#10)
  private intakeValveStem: THREE.Mesh;
  private exhaustValveStem: THREE.Mesh;
  private readonly valveBaseY: number;

  // Crankshaft arm + counterweight (#11)
  private crankArm: THREE.Mesh;
  private counterWeight: THREE.Mesh;
  private crankCenter: THREE.Mesh;

  // Fuel injector
  injectorBody: THREE.Mesh;
  sprayDots: THREE.Mesh[];

  // Cylinder wall outlines
  private leftWall: THREE.Mesh;
  private rightWall: THREE.Mesh;
  private headWall: THREE.Mesh;

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

    // Cylinder body — dark background fill
    const cylGeo = new THREE.PlaneGeometry(boreS, strokeS * 1.5);
    const cylMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a2e,
      transparent: true,
      opacity: 0.6,
    });
    this.cylinder = new THREE.Mesh(cylGeo, cylMat);
    this.cylinder.userData.partName = "Cylinder Body";
    this.cylinder.position.y = strokeS / 4;

    // Cylinder wall outlines — bright edges to define the bore shape
    const wallThick = Math.max(boreS * 0.04, 3);
    const wallHeight = strokeS * 1.5;
    const wallColor = 0x556688;
    const wallZ = 1.2;
    const lwGeo = new THREE.PlaneGeometry(wallThick, wallHeight);
    const lwMat = new THREE.MeshBasicMaterial({ color: wallColor });
    this.leftWall = new THREE.Mesh(lwGeo, lwMat);
    this.leftWall.userData.partName = "Cylinder Wall";
    this.leftWall.position.set(-boreS / 2 - wallThick / 2, strokeS / 4, wallZ);

    const rwGeo = new THREE.PlaneGeometry(wallThick, wallHeight);
    const rwMat = new THREE.MeshBasicMaterial({ color: wallColor });
    this.rightWall = new THREE.Mesh(rwGeo, rwMat);
    this.rightWall.userData.partName = "Cylinder Wall";
    this.rightWall.position.set(boreS / 2 + wallThick / 2, strokeS / 4, wallZ);

    const hwGeo = new THREE.PlaneGeometry(boreS + wallThick * 2, wallThick);
    const hwMat = new THREE.MeshBasicMaterial({ color: wallColor });
    this.headWall = new THREE.Mesh(hwGeo, hwMat);
    this.headWall.userData.partName = "Cylinder Head";
    this.headWall.position.set(0, strokeS + wallThick / 2, wallZ);

    // Piston — solid silver-blue, thicker for visibility
    const pistonGeo = new THREE.PlaneGeometry(boreS * 0.9, boreS * 0.3);
    const pistonMat = new THREE.MeshBasicMaterial({ color: 0xa0aab8 });
    this.piston = new THREE.Mesh(pistonGeo, pistonMat);
    this.piston.userData.partName = "Piston";
    this.piston.position.z = 0.8;

    // Con rod — wider, distinct steel color
    const rodWidth = Math.max(boreS * 0.08, 6);
    const rodGeo = new THREE.PlaneGeometry(rodWidth, 100);
    const rodMat = new THREE.MeshBasicMaterial({ color: 0x708090 });
    this.conRod = new THREE.Mesh(rodGeo, rodMat);
    this.conRod.userData.partName = "Connecting Rod";
    this.conRod.position.z = 0.6;

    // Crank pin — larger, bright accent
    const pinRadius = Math.max(boreS * 0.06, 8);
    const pinGeo = new THREE.CircleGeometry(pinRadius, 20);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
    this.crankPin = new THREE.Mesh(pinGeo, pinMat);
    this.crankPin.userData.partName = "Crank Pin";
    this.crankPin.position.z = 0.7;

    // Gas fill
    const gasFillGeo = new THREE.PlaneGeometry(boreS * 0.88, 1);
    const gasFillMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.15,
    });
    this.gasFill = new THREE.Mesh(gasFillGeo, gasFillMat);
    this.gasFill.userData.partName = "Gas Fill";
    this.gasFill.position.z = 0.5;

    // Spark plug — larger triangle at cylinder top center
    const sparkGeo = new THREE.BufferGeometry();
    const sz = boreS * 0.1;
    sparkGeo.setAttribute("position", new THREE.Float32BufferAttribute([
      0, sz, 0,  -sz * 0.6, -sz * 0.3, 0,  sz * 0.6, -sz * 0.3, 0
    ], 3));
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xbbbbbb });
    this.sparkPlug = new THREE.Mesh(sparkGeo, sparkMat);
    this.sparkPlug.userData.partName = "Spark Plug";
    this.sparkPlug.position.set(0, strokeS + sz * 0.3, 1.6);

    // Fuel injector — small rectangle offset to the left of cylinder head
    const injW = boreS * 0.1;
    const injH = boreS * 0.2;
    const injGeo = new THREE.PlaneGeometry(injW, injH);
    const injMat = new THREE.MeshBasicMaterial({ color: 0x666666 });
    this.injectorBody = new THREE.Mesh(injGeo, injMat);
    this.injectorBody.userData.partName = "Fuel Injector";
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
      dot.userData.partName = "Fuel Spray";
      dot.position.set(
        -boreS * 0.35 + (i - 1) * boreS * 0.06,
        strokeS - boreS * 0.05 - i * boreS * 0.04,
        1
      );
      this.sprayDots.push(dot);
      this.group.add(dot);
    }

    // #9 Combustion glow overlay — semi-transparent plane behind gas fill
    const glowGeo = new THREE.PlaneGeometry(boreS * 0.88, 1);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0,
    });
    this.combustionGlow = new THREE.Mesh(glowGeo, glowMat);
    this.combustionGlow.userData.partName = "Combustion Glow";
    this.combustionGlow.position.z = 0.3; // behind gas fill (z=0.5)

    // #10 Valve stems — wider with distinct colors
    const stemW = boreS * 0.06;
    const stemH = boreS * 0.28;
    this.valveBaseY = strokeS + stemH * 0.15;
    const intakeStemGeo = new THREE.PlaneGeometry(stemW, stemH);
    const intakeStemMat = new THREE.MeshBasicMaterial({ color: 0x5599ff });
    this.intakeValveStem = new THREE.Mesh(intakeStemGeo, intakeStemMat);
    this.intakeValveStem.userData.partName = "Intake Valve";
    this.intakeValveStem.position.set(-boreS * 0.22, this.valveBaseY, 1.5);

    const exhaustStemGeo = new THREE.PlaneGeometry(stemW, stemH);
    const exhaustStemMat = new THREE.MeshBasicMaterial({ color: 0xff7733 });
    this.exhaustValveStem = new THREE.Mesh(exhaustStemGeo, exhaustStemMat);
    this.exhaustValveStem.userData.partName = "Exhaust Valve";
    this.exhaustValveStem.position.set(boreS * 0.22, this.valveBaseY, 1.5);

    // #11 Crankshaft arm + counterweight + center pivot
    const armWidth = Math.max(boreS * 0.08, 6);
    const armGeo = new THREE.PlaneGeometry(armWidth, strokeS * 0.5);
    const armMat = new THREE.MeshBasicMaterial({ color: 0x8090a0 });
    this.crankArm = new THREE.Mesh(armGeo, armMat);
    this.crankArm.userData.partName = "Crank Arm";

    const cwRadius = strokeS * 0.22;
    const cwGeo = new THREE.CircleGeometry(cwRadius, 16, 0, Math.PI);
    const cwMat = new THREE.MeshBasicMaterial({ color: 0x606870 });
    this.counterWeight = new THREE.Mesh(cwGeo, cwMat);
    this.counterWeight.userData.partName = "Counterweight";

    const centerRadius = Math.max(boreS * 0.06, 7);
    const centerGeo = new THREE.CircleGeometry(centerRadius, 20);
    const centerMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    this.crankCenter = new THREE.Mesh(centerGeo, centerMat);
    this.crankCenter.userData.partName = "Crank Center";
    this.crankCenter.position.set(0, -strokeS * 0.3, 0.3);

    // #12 Spark arc effect — jagged line
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(18), 3)); // 6 points
    const arcMat = new THREE.LineBasicMaterial({
      color: 0xccddff,
      transparent: true,
      opacity: 0,
    });
    this.sparkArc = new THREE.Line(arcGeo, arcMat);
    this.sparkArc.position.set(0, strokeS - boreS * 0.05, 2);

    this.group.add(
      this.cylinder,
      this.leftWall,
      this.rightWall,
      this.headWall,
      this.combustionGlow,
      this.gasFill,
      this.piston,
      this.conRod,
      this.crankPin,
      this.crankArm,
      this.counterWeight,
      this.crankCenter,
      this.sparkPlug,
      this.injectorBody,
      this.intakeValveStem,
      this.exhaustValveStem,
      this.sparkArc
    );
    scene.add(this.group);

    this.forceArrows = new ForceArrows(this.group, scale);
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

    // Wall color — cylinder fill tinted by temperature
    const wallColor = temperatureColor(state.wall_temperature);
    (this.cylinder.material as THREE.MeshBasicMaterial).color.copy(wallColor);
    (this.cylinder.material as THREE.MeshBasicMaterial).opacity = 0.35;

    // Piston color — blend between metallic base and temperature tint
    const pistonTemp =
      state.wall_temperature * 0.6 + state.gas_temperature * 0.4;
    const pistonTempColor = temperatureColor(pistonTemp);
    const pistonBase = new THREE.Color(0xa0aab8);
    (this.piston.material as THREE.MeshBasicMaterial).color.copy(
      pistonBase.lerp(pistonTempColor, 0.4)
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

    // Spark plug flash + spark arc — trigger when burn_fraction crosses 0→>0
    if (state.burn_fraction > 0.01 && this.prevBurnFraction <= 0.01) {
      this.sparkTimer = 1.0;
      this.sparkArcTimer = 1.0;
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

    // #12 Spark arc effect — jagged blue-white line that fades
    if (this.sparkArcTimer > 0) {
      this.sparkArcTimer = Math.max(0, this.sparkArcTimer - 0.05);
      const arcMat = this.sparkArc.material as THREE.LineBasicMaterial;
      arcMat.opacity = this.sparkArcTimer;
      arcMat.color.lerpColors(
        new THREE.Color(0x4466ff),
        new THREE.Color(0xeeeeff),
        this.sparkArcTimer
      );
      // Randomize the jagged path each frame
      const pos = this.sparkArc.geometry.attributes.position;
      const boreS = bore * s;
      const arcH = boreS * 0.15;
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        pos.setXYZ(
          i,
          (Math.random() - 0.5) * boreS * 0.08,
          -t * arcH,
          0
        );
      }
      pos.needsUpdate = true;
    } else {
      (this.sparkArc.material as THREE.LineBasicMaterial).opacity = 0;
    }

    // #9 Combustion glow overlay
    const tempRatio = Math.max(0, (state.gas_temperature - 400) / 2000);
    const glowOpacity = state.burn_fraction * tempRatio * 0.6;
    const glowMat = this.combustionGlow.material as THREE.MeshBasicMaterial;
    glowMat.opacity = Math.min(glowOpacity, 0.5);
    // Color shifts orange→yellow during peak combustion
    glowMat.color.lerpColors(
      new THREE.Color(0xff6600),
      new THREE.Color(0xffdd00),
      state.burn_fraction
    );
    // Position glow to match gas fill
    const glowTop = stroke * s;
    const glowPistonTop = pistonY + (bore * s * 0.3) / 2;
    const glowH = Math.max(glowTop - glowPistonTop, 1);
    this.combustionGlow.scale.y = glowH;
    this.combustionGlow.position.y = glowPistonTop + glowH / 2;

    // #10 Animated valve stems
    // Valve lift is in meters (max ~0.010m); convert to display units with scale
    const maxValveDrop = bore * s * 0.15;
    const intakeDrop = Math.min(state.intake_valve_lift * s, maxValveDrop);
    const exhaustDrop = Math.min(state.exhaust_valve_lift * s, maxValveDrop);
    this.intakeValveStem.position.y = this.valveBaseY - intakeDrop;
    this.exhaustValveStem.position.y = this.valveBaseY - exhaustDrop;

    // #11 Crankshaft arm + counterweight rotation
    const crankCenterY = -stroke * s * 0.3;
    // Arm from center to crank pin
    const armMidX = crankX / 2;
    const armMidY = (crankCenterY + crankY) / 2;
    const armLen = Math.sqrt(crankX * crankX + (crankY - crankCenterY) * (crankY - crankCenterY));
    this.crankArm.position.set(armMidX, armMidY, 0.1);
    this.crankArm.scale.y = armLen / (stroke * s * 0.5);
    this.crankArm.rotation.z = Math.atan2(crankX, crankY - crankCenterY);
    // Counterweight opposite the pin
    this.counterWeight.position.set(-crankX * 0.6, crankCenterY - (crankY - crankCenterY) * 0.6, 0.1);
    this.counterWeight.rotation.z = angle + Math.PI;

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

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private partHoverCallback: ((partName: string | null) => void) | null = null;
  private highlightedPart: string | null = null;
  private savedOpacities = new Map<THREE.Object3D, number>();

  private readonly scale = 1000;
  private bore: number;
  private stroke: number;
  private cylinderCount: number;
  private layoutType: LayoutType;
  private vAngle: number;

  // Throttle body visuals
  private throttleGroup: THREE.Group;
  private throttlePlate: THREE.Mesh;
  private intakeRunners: THREE.Mesh[] = [];

  // Exhaust system visual
  private exhaustVisual!: ExhaustVisual;
  private lastRpm = 800;

  constructor(
    canvas: HTMLCanvasElement,
    bore: number,
    stroke: number,
    cylinderCount = 1,
    layoutType: LayoutType = "inline",
    vAngle = 0
  ) {
    this.bore = bore;
    this.stroke = stroke;
    this.cylinderCount = cylinderCount;
    this.layoutType = layoutType;
    this.vAngle = vAngle;

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
    const boreS = this.bore * this.scale;
    const strokeS = this.stroke * this.scale;
    const baseSize = 0.3 * this.scale;
    // Exhaust extends below — account for vertical extent
    const exhaustBottom = -strokeS * 1.4 - boreS * 0.15;
    const padding = boreS * 0.3;

    if (this.cylinderCount <= 1) {
      const engineTop = strokeS + boreS * 0.9;
      const verticalHalf = (engineTop - exhaustBottom) / 2 + padding;
      return Math.max(verticalHalf, baseSize);
    }

    if (this.layoutType === "boxer") {
      const pairs = Math.ceil(this.cylinderCount / 2);
      const cylLength = strokeS * 1.5 + boreS;
      const horizontalHalf = cylLength + boreS * 0.5;
      const verticalHalf = pairs * boreS * 1.3 / 2 + boreS;
      const exhaustVertHalf = (verticalHalf - exhaustBottom) / 2 + padding;
      return Math.max(horizontalHalf, exhaustVertHalf, baseSize);
    } else if (this.layoutType === "v") {
      const halfCount = Math.ceil(this.cylinderCount / 2);
      const spacing = boreS * 1.3;
      const horizontalHalf = (halfCount - 1) * spacing / 2 + boreS * 1.5;
      const angleRad = (this.vAngle / 2) * Math.PI / 180;
      const cylHeight = strokeS * 1.5;
      const engineTop = Math.cos(angleRad) * cylHeight + Math.sin(angleRad) * boreS + boreS * 0.5;
      const verticalHalf = (engineTop - exhaustBottom) / 2 + padding;
      return Math.max(horizontalHalf, verticalHalf, baseSize);
    } else {
      const horizontalHalf = (this.cylinderCount - 1) * boreS * 1.3 / 2 + boreS;
      const engineTop = strokeS + boreS * 0.9;
      const verticalHalf = (engineTop - exhaustBottom) / 2 + padding;
      return Math.max(horizontalHalf, verticalHalf, baseSize);
    }
  }

  /** Compute the vertical center of the engine geometry (includes exhaust below) */
  private computeCenterY(): number {
    const strokeS = this.stroke * this.scale;
    const boreS = this.bore * this.scale;
    const exhaustBottom = -strokeS * 1.4 - boreS * 0.15;

    if (this.layoutType === "boxer") {
      const pairs = Math.ceil(this.cylinderCount / 2);
      const extent = pairs * boreS * 1.3 / 2;
      return (extent * 0.3 + exhaustBottom) / 2;
    } else if (this.layoutType === "v") {
      const top = strokeS * 1.2 + boreS * 0.5;
      return (top + exhaustBottom) / 2;
    } else {
      const top = strokeS + boreS * 0.9;
      return (top + exhaustBottom) / 2;
    }
  }

  private buildCylinders(): void {
    const boreS = this.bore * this.scale;
    const spacing = boreS * 1.3;

    if (this.layoutType === "boxer") {
      this.buildBoxerLayout(spacing);
    } else if (this.layoutType === "v") {
      this.buildVLayout(spacing);
    } else {
      this.buildInlineLayout(spacing);
    }

    this.buildThrottleBody();
    this.buildExhaust();
  }

  private buildExhaust(): void {
    this.exhaustVisual = new ExhaustVisual(
      this.scale, this.bore, this.stroke,
      this.cylinderCount, this.layoutType, this.vAngle,
    );
    const ports = this.getExhaustPortPositions();
    this.exhaustVisual.build(ports);
    this.scene.add(this.exhaustVisual.group);
  }

  /** Compute exhaust port world positions for each cylinder */
  private getExhaustPortPositions(): THREE.Vector2[] {
    const boreS = this.bore * this.scale;
    const strokeS = this.stroke * this.scale;
    const spacing = boreS * 1.3;
    const positions: THREE.Vector2[] = [];

    if (this.layoutType === "boxer") {
      const pairs = Math.ceil(this.cylinderCount / 2);
      const totalHeight = spacing * (pairs - 1);
      for (let i = 0; i < this.cylinderCount; i++) {
        const bankIndex = i % 2;
        const pairIndex = Math.floor(i / 2);
        const cylY = -totalHeight / 2 + pairIndex * spacing;
        // Exhaust port is at the far end of the cylinder (opposite intake)
        // Bank 0 faces left, bank 1 faces right; exhaust exits outward
        const headX = bankIndex === 0 ? -(strokeS + boreS * 0.3) : (strokeS + boreS * 0.3);
        positions.push(new THREE.Vector2(headX, cylY));
      }
    } else if (this.layoutType === "v") {
      const halfAngle = (this.vAngle / 2) * Math.PI / 180;
      const halfCount = Math.ceil(this.cylinderCount / 2);
      const totalWidth = spacing * (halfCount - 1);
      const startX = -totalWidth / 2;
      for (let i = 0; i < this.cylinderCount; i++) {
        const bankIndex = i % 2;
        const pairIndex = Math.floor(i / 2);
        const cylX = startX + pairIndex * spacing;
        const angle = bankIndex === 0 ? halfAngle : -halfAngle;
        // Exhaust valve stem is at boreS * 0.22 offset from cylinder center
        const portLocalX = boreS * 0.22;
        const portLocalY = strokeS;
        const worldX = cylX + Math.sin(angle) * portLocalY + Math.cos(angle) * portLocalX;
        const worldY = Math.cos(angle) * portLocalY - Math.sin(angle) * portLocalX;
        positions.push(new THREE.Vector2(worldX, worldY));
      }
    } else {
      // Inline
      const totalWidth = spacing * (this.cylinderCount - 1);
      const startX = -totalWidth / 2;
      for (let i = 0; i < this.cylinderCount; i++) {
        const cylX = startX + i * spacing;
        // Exhaust valve is at right side of cylinder head (boreS * 0.22)
        positions.push(new THREE.Vector2(cylX + boreS * 0.22, strokeS));
      }
    }
    return positions;
  }

  private buildInlineLayout(spacing: number): void {
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
  }

  private buildVLayout(spacing: number): void {
    const halfAngle = (this.vAngle / 2) * Math.PI / 180;
    const halfCount = Math.ceil(this.cylinderCount / 2);
    const totalWidth = spacing * (halfCount - 1);
    const startX = -totalWidth / 2;

    // Create all cylinder units at origin, then rotate their groups
    for (let i = 0; i < this.cylinderCount; i++) {
      const bankIndex = i % 2; // 0 = left bank, 1 = right bank
      const pairIndex = Math.floor(i / 2);
      const xOffset = startX + pairIndex * spacing;

      const unit = new CylinderUnit(
        this.scene,
        this.bore,
        this.stroke,
        this.scale,
        xOffset
      );

      // Rotate: left bank tilts one way, right bank the other
      const angle = bankIndex === 0 ? halfAngle : -halfAngle;
      unit.group.rotation.z = angle;

      unit.setForceArrowsVisible(this._forceArrowsVisible);
      this.units.push(unit);
    }
  }

  private buildBoxerLayout(spacing: number): void {
    const pairs = Math.ceil(this.cylinderCount / 2);
    const totalHeight = spacing * (pairs - 1);
    const startY = -totalHeight / 2;

    for (let i = 0; i < this.cylinderCount; i++) {
      const bankIndex = i % 2; // 0 = left bank, 1 = right bank
      const pairIndex = Math.floor(i / 2);

      // Each cylinder placed at origin, then the group is rotated and positioned
      const unit = new CylinderUnit(
        this.scene,
        this.bore,
        this.stroke,
        this.scale,
        0 // x offset handled by group position
      );

      // Rotate: left bank faces left (+90°), right bank faces right (-90°)
      const angle = bankIndex === 0 ? Math.PI / 2 : -Math.PI / 2;
      unit.group.rotation.z = angle;
      // Position along the crankshaft axis (vertical in boxer view)
      unit.group.position.y = startY + pairIndex * spacing;

      unit.setForceArrowsVisible(this._forceArrowsVisible);
      this.units.push(unit);
    }
  }

  private buildThrottleBody(): void {
    // Clear previous
    while (this.throttleGroup.children.length > 0) {
      this.throttleGroup.remove(this.throttleGroup.children[0]);
    }
    this.intakeRunners = [];

    const boreS = this.bore * this.scale;
    const strokeS = this.stroke * this.scale;
    const spacing = boreS * 1.3;

    if (this.layoutType === "boxer") {
      this.buildThrottleBoxer(boreS, strokeS, spacing);
    } else if (this.layoutType === "v") {
      this.buildThrottleV(boreS, strokeS, spacing);
    } else {
      this.buildThrottleInline(boreS, strokeS, spacing);
    }
  }

  private addThrottleBodyMesh(x: number, y: number, boreS: number): void {
    const bodyW = boreS * 0.6;
    const bodyH = boreS * 0.25;
    const bodyGeo = new THREE.PlaneGeometry(bodyW, bodyH);
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.userData.partName = "Throttle Body";
    body.position.set(x, y, 0);
    this.throttleGroup.add(body);

    const plateW = bodyH * 0.85;
    const plateH = boreS * 0.04;
    const plateGeo = new THREE.PlaneGeometry(plateW, plateH);
    const plateMat = new THREE.MeshBasicMaterial({ color: 0x999999 });
    this.throttlePlate = new THREE.Mesh(plateGeo, plateMat);
    this.throttlePlate.userData.partName = "Throttle Plate";
    this.throttlePlate.position.set(x, y, 0.5);
    this.throttleGroup.add(this.throttlePlate);
  }

  private buildThrottleInline(boreS: number, strokeS: number, spacing: number): void {
    const totalWidth = spacing * (this.cylinderCount - 1);
    const startX = -totalWidth / 2;
    const throttleY = strokeS + boreS * 0.8;
    const throttleX = startX - boreS * 0.6;

    this.addThrottleBodyMesh(throttleX, throttleY, boreS);

    for (let i = 0; i < this.cylinderCount; i++) {
      const cylX = startX + i * spacing;
      const cylTopY = strokeS;
      const runnerH = throttleY - cylTopY;
      const midY = cylTopY + runnerH / 2;

      const hSegW = Math.abs(cylX - throttleX);
      if (hSegW > 1) {
        const hGeo = new THREE.PlaneGeometry(hSegW, boreS * 0.03);
        const hMat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.8 });
        const hSeg = new THREE.Mesh(hGeo, hMat);
        hSeg.userData.partName = "Intake Runner";
        hSeg.position.set((throttleX + cylX) / 2, throttleY, 0);
        this.throttleGroup.add(hSeg);
      }

      const vGeo = new THREE.PlaneGeometry(boreS * 0.03, runnerH);
      const vMat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.8 });
      const vSeg = new THREE.Mesh(vGeo, vMat);
      vSeg.userData.partName = "Intake Runner";
      vSeg.position.set(cylX, midY, 0);
      this.intakeRunners.push(vSeg);
      this.throttleGroup.add(vSeg);
    }
  }

  private buildThrottleV(boreS: number, strokeS: number, spacing: number): void {
    const halfCount = Math.ceil(this.cylinderCount / 2);
    const totalWidth = spacing * (halfCount - 1);
    const startX = -totalWidth / 2;
    // Plenum centered above the V
    const throttleY = strokeS * 1.1 + boreS * 0.5;
    const throttleX = 0;

    this.addThrottleBodyMesh(throttleX, throttleY, boreS);

    // Runners branch to each bank
    const halfAngle = (this.vAngle / 2) * Math.PI / 180;
    for (let i = 0; i < this.cylinderCount; i++) {
      const bankIndex = i % 2;
      const pairIndex = Math.floor(i / 2);
      const cylX = startX + pairIndex * spacing;
      const angle = bankIndex === 0 ? halfAngle : -halfAngle;
      // Cylinder head position after rotation
      const headLocalY = strokeS;
      const headX = cylX + Math.sin(angle) * headLocalY;
      const headY = Math.cos(angle) * headLocalY;

      // Runner from plenum to cylinder head
      const dx = headX - throttleX;
      const dy = headY - throttleY;
      const runnerLen = Math.sqrt(dx * dx + dy * dy);
      const runnerAngle = Math.atan2(dx, dy);

      const rGeo = new THREE.PlaneGeometry(boreS * 0.03, runnerLen);
      const rMat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.8 });
      const rSeg = new THREE.Mesh(rGeo, rMat);
      rSeg.userData.partName = "Intake Runner";
      rSeg.position.set(throttleX + dx / 2, throttleY + dy / 2, 0);
      rSeg.rotation.z = runnerAngle;
      this.intakeRunners.push(rSeg);
      this.throttleGroup.add(rSeg);
    }
  }

  private buildThrottleBoxer(boreS: number, strokeS: number, spacing: number): void {
    const pairs = Math.ceil(this.cylinderCount / 2);
    const totalHeight = spacing * (pairs - 1);
    // Plenum above the crankshaft line
    const throttleY = totalHeight / 2 + boreS * 0.8;
    const throttleX = 0;

    this.addThrottleBodyMesh(throttleX, throttleY, boreS);

    // Runners go left/right to horizontally opposed cylinders
    for (let i = 0; i < this.cylinderCount; i++) {
      const bankIndex = i % 2;
      const pairIndex = Math.floor(i / 2);
      const cylY = -totalHeight / 2 + pairIndex * spacing;
      // Cylinder heads extend outward (left bank = -x, right bank = +x)
      const headX = bankIndex === 0 ? -(strokeS + boreS * 0.3) : (strokeS + boreS * 0.3);

      // Vertical segment from plenum down to cylinder's Y level
      const vLen = Math.abs(throttleY - cylY);
      if (vLen > 1) {
        const vGeo = new THREE.PlaneGeometry(boreS * 0.03, vLen);
        const vMat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.8 });
        const vSeg = new THREE.Mesh(vGeo, vMat);
        vSeg.userData.partName = "Intake Runner";
        vSeg.position.set(0, (throttleY + cylY) / 2, 0);
        this.throttleGroup.add(vSeg);
      }

      // Horizontal segment from center to cylinder head
      const hLen = Math.abs(headX);
      const hGeo = new THREE.PlaneGeometry(hLen, boreS * 0.03);
      const hMat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.8 });
      const hSeg = new THREE.Mesh(hGeo, hMat);
      hSeg.userData.partName = "Intake Runner";
      hSeg.position.set(headX / 2, cylY, 0);
      this.intakeRunners.push(hSeg);
      this.throttleGroup.add(hSeg);
    }
  }

  /** Single-cylinder update (backward compatible) */
  update(state: EngineViewState): void {
    if (this.units.length === 0) return;
    const cylData: CylinderData = {
      ...state,
      exhaust_pulse_intensity: state.exhaust_pulse_intensity ?? 0,
      exhaust_gas_temp: state.exhaust_gas_temp ?? 300,
    };
    this.units[0].update(cylData, this.bore, this.stroke, this.scale);
    this.updateThrottlePlate(state.throttle_position ?? 1.0);
    this.updateRunnerColors([state]);
    this.exhaustVisual.update([cylData], this.lastRpm);
  }

  /** Multi-cylinder update */
  updateMulti(cylinders: CylinderData[]): void {
    for (let i = 0; i < this.units.length && i < cylinders.length; i++) {
      this.units[i].update(cylinders[i], this.bore, this.stroke, this.scale);
    }
    this.exhaustVisual.update(cylinders, this.lastRpm);
  }

  /** Update exhaust config and rebuild visual */
  setExhaustConfig(config: ExhaustSystemConfig): void {
    const ports = this.getExhaustPortPositions();
    this.exhaustVisual.rebuild(config, ports);
  }

  /** Set the current RPM for exhaust animation speed */
  setRpm(rpm: number): void {
    this.lastRpm = rpm;
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

  /** Register callback for when mouse hovers over engine parts */
  setPartHoverCallback(cb: (partName: string | null) => void): void {
    this.partHoverCallback = cb;
  }

  /** Handle mouse move for part raycast detection */
  handleMouseMove(event: MouseEvent, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    let hitPart: string | null = null;
    for (const hit of intersects) {
      if (hit.object.userData.partName) {
        hitPart = hit.object.userData.partName as string;
        break;
      }
    }

    if (this.partHoverCallback) {
      this.partHoverCallback(hitPart);
    }
  }

  /** Highlight a specific part by name, dimming all others. Pass null to restore. */
  highlightPart(partName: string | null): void {
    if (partName === this.highlightedPart) return;
    this.highlightedPart = partName;

    // Traverse all meshes in the scene
    this.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh || obj instanceof THREE.Line)) return;
      const mat = obj.material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial;
      if (!mat || mat.transparent === undefined) return;

      const objPartName = obj.userData.partName as string | undefined;

      if (partName === null) {
        // Restore all — reset opacity to saved value or 1
        if (this.savedOpacities.has(obj)) {
          mat.opacity = this.savedOpacities.get(obj)!;
        }
      } else {
        // Save original opacity on first highlight pass
        if (!this.savedOpacities.has(obj)) {
          this.savedOpacities.set(obj, mat.opacity);
        }
        if (objPartName === partName) {
          // Brighten matching part
          mat.opacity = Math.max(this.savedOpacities.get(obj)!, 0.9);
        } else if (objPartName) {
          // Dim non-matching parts
          mat.opacity = 0.15;
        }
      }
      mat.transparent = true;
    });

    if (partName === null) {
      this.savedOpacities.clear();
    }
  }

  dispose(): void {
    for (const u of this.units) u.dispose();
    this.units = [];
    this.scene.remove(this.throttleGroup);
    this.intakeRunners = [];
    this.exhaustVisual.dispose();
    this.renderer.dispose();
  }
}
