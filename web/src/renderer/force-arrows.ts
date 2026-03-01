/**
 * Force vector arrows overlaid on the piston.
 * Gas force (blue), inertia force (yellow), friction force (red).
 */

import * as THREE from "three";

const ARROW_COLORS = {
  gas: 0x4488ff,
  inertia: 0xffcc00,
  friction: 0xff4444,
} as const;

// Scale: Newtons → display units (adjust for readability)
const FORCE_SCALE = 0.005;
const MIN_LENGTH = 2;

export class ForceArrows {
  private gasArrow: THREE.ArrowHelper;
  private inertiaArrow: THREE.ArrowHelper;
  private frictionArrow: THREE.ArrowHelper;
  private group: THREE.Group;
  private _visible = true;

  constructor(parent: THREE.Object3D, _scale: number) {
    const origin = new THREE.Vector3(0, 0, 1);
    const dir = new THREE.Vector3(0, -1, 0);

    this.gasArrow = new THREE.ArrowHelper(dir, origin, 1, ARROW_COLORS.gas, 6, 4);
    this.inertiaArrow = new THREE.ArrowHelper(dir, origin, 1, ARROW_COLORS.inertia, 6, 4);
    this.frictionArrow = new THREE.ArrowHelper(dir, origin, 1, ARROW_COLORS.friction, 6, 4);

    this.group = new THREE.Group();
    this.group.add(this.gasArrow, this.inertiaArrow, this.frictionArrow);
    parent.add(this.group);
  }

  update(
    pistonY: number,
    gasForce: number,
    inertiaForce: number,
    frictionForce: number
  ): void {
    if (!this._visible) return;

    this.setArrow(this.gasArrow, -30, pistonY, gasForce);
    this.setArrow(this.inertiaArrow, 0, pistonY, inertiaForce);
    this.setArrow(this.frictionArrow, 30, pistonY, frictionForce);
  }

  private setArrow(
    arrow: THREE.ArrowHelper,
    xOffset: number,
    pistonY: number,
    force: number
  ): void {
    const len = Math.max(Math.abs(force) * FORCE_SCALE, MIN_LENGTH);
    // Positive force = pushes piston down (negative Y in view)
    const dir = new THREE.Vector3(0, force >= 0 ? -1 : 1, 0);
    arrow.setDirection(dir);
    arrow.setLength(len, Math.min(len * 0.3, 8), Math.min(len * 0.15, 5));
    arrow.position.set(xOffset, pistonY, 1);
  }

  setVisible(v: boolean): void {
    this._visible = v;
    this.group.visible = v;
  }

  get visible(): boolean {
    return this._visible;
  }

}
