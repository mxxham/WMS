"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { CameraControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { BinSummary, ColorMode, Layout } from "@/lib/warehouse-types";
import { binColor } from "./colors";

type Props = {
  bins: BinSummary[]; layout: Layout; mode: ColorMode;
  highlighted: Set<string>; focusKey: number; onSelect: (b: BinSummary) => void;
};

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

/** Size of one pallet box, derived from the layout config. */
function boxSize(l: Layout): [number, number, number] {
  return [(l.bay_width_m / l.positions_per_bay) * 0.86, l.level_height_m * 0.7, l.rack_depth_m * 0.85];
}

/** Box centre: pos_y is the beam level, so lift the pallet to sit on it. */
function centre(b: BinSummary, l: Layout): [number, number, number] {
  const [, h] = boxSize(l);
  return [Number(b.pos_x), Number(b.pos_y) + h / 2 + 0.05, Number(b.pos_z)];
}

/**
 * All bins drawn as ONE instanced mesh (2.5k boxes -> 1 draw call).
 * Colours are per-instance; clicking returns the instance index.
 */
function Bins({ bins, layout, mode, onSelect }: Pick<Props, "bins" | "layout" | "mode" | "onSelect">) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((st) => st.invalidate); // frameloop="demand": redraw after instance updates
  const size = boxSize(layout);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    bins.forEach((b, i) => {
      dummy.position.set(...centre(b, layout));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // needed for raycasting after moving instances
    invalidate();
  }, [bins, layout, invalidate]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    bins.forEach((b, i) => mesh.setColorAt(i, tmpColor.set(binColor(b, mode))));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [bins, mode, invalidate]);

  return (
    <instancedMesh
      ref={ref} args={[undefined, undefined, bins.length]}
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (e.instanceId !== undefined) onSelect(bins[e.instanceId]); }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial roughness={0.8} />
    </instancedMesh>
  );
}

/** Wireframe cages around searched/selected bins (a second, small instanced mesh). */
function Highlights({ bins, layout }: { bins: BinSummary[]; layout: Layout }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((st) => st.invalidate);
  const [w, h, d] = boxSize(layout);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    bins.forEach((b, i) => { dummy.position.set(...centre(b, layout)); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [bins, layout, invalidate]);
  if (bins.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, bins.length]} raycast={() => null}>
      <boxGeometry args={[w * 1.25, h * 1.25, d * 1.25]} />
      <meshBasicMaterial color="#D7263D" wireframe />
    </instancedMesh>
  );
}

/** Upright posts at every bay boundary, instanced. */
function Uprights({ bins, layout }: { bins: BinSummary[]; layout: Layout }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((st) => st.invalidate);
  const posts = useMemo(() => {
    // One rack face per (aisle, z): a back-to-back block has two faces, each
    // bays_per_side bays long. Posts stand at every bay boundary, front and back.
    const faces = new Map<string, { z: number; maxX: number; top: number }>();
    for (const b of bins) {
      if (!b.rack || b.pos_x === null || b.pos_z === null) continue;
      const k = `${b.zone}|${b.pos_z}`;
      const f = faces.get(k) ?? { z: Number(b.pos_z), maxX: 0, top: 0 };
      f.maxX = Math.max(f.maxX, Number(b.pos_x));
      f.top = Math.max(f.top, Number(b.pos_y));
      faces.set(k, f);
    }
    const out: { x: number; z: number; h: number }[] = [];
    for (const f of faces.values()) {
      const h = f.top + layout.level_height_m;
      const bays = Math.ceil(f.maxX / layout.bay_width_m);
      for (let r = 0; r <= bays; r++) for (const side of [-1, 1]) out.push({ x: r * layout.bay_width_m, z: f.z + (side * layout.rack_depth_m) / 2, h });
    }
    return out;
  }, [bins, layout]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    posts.forEach((p, i) => { dummy.position.set(p.x, p.h / 2, p.z); dummy.scale.set(1, p.h, 1); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
    dummy.scale.set(1, 1, 1);
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [posts, invalidate]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, posts.length]} raycast={() => null}>
      <boxGeometry args={[0.08, 1, 0.08]} />
      <meshStandardMaterial color="#F07C1B" />
    </instancedMesh>
  );
}

function ZoneLabels({ bins }: { bins: BinSummary[] }) {
  const labels = useMemo(() => {
    // Label each aisle at the start of its block, centred across both faces.
    const m = new Map<string, { x: number; zMin: number; zMax: number }>();
    for (const b of bins) {
      if (b.pos_x === null || b.pos_z === null) continue;
      const x = Number(b.pos_x), z = Number(b.pos_z);
      const cur = m.get(b.zone);
      if (!cur) m.set(b.zone, { x, zMin: z, zMax: z });
      else { cur.x = Math.min(cur.x, x); cur.zMin = Math.min(cur.zMin, z); cur.zMax = Math.max(cur.zMax, z); }
    }
    return [...m.entries()].map(([zone, p]) => [zone, { x: p.x, z: (p.zMin + p.zMax) / 2 }] as const);
  }, [bins]);
  return (
    <>
      {labels.map(([zone, p]) => (
        <Text key={zone} position={[p.x - (zone.length > 2 ? 4 : 2.2), 0.02, p.z]} rotation={[-Math.PI / 2, 0, 0]} fontSize={zone.length > 2 ? 0.8 : 1.4} color="#1F2A33" anchorX="center" anchorY="middle">
          {zone}
        </Text>
      ))}
    </>
  );
}

/** Flies the camera to frame the highlighted bins whenever focusKey changes. */
function Focus({ controls, bins, layout, focusKey }: { controls: React.RefObject<CameraControls | null>; bins: BinSummary[]; layout: Layout; focusKey: number }) {
  useEffect(() => {
    const c = controls.current;
    if (!c || bins.length === 0) return;
    const box = new THREE.Box3();
    bins.forEach((b) => box.expandByPoint(new THREE.Vector3(...centre(b, layout))));
    const target = box.getCenter(new THREE.Vector3());
    const span = Math.max(box.getSize(new THREE.Vector3()).length(), 4);
    c.setLookAt(target.x - span * 0.6, target.y + span * 0.7 + 3, target.z + span * 0.9 + 6, target.x, target.y, target.z, true);
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function WarehouseScene({ bins, layout, mode, highlighted, focusKey, onSelect }: Props) {
  const controls = useRef<CameraControls>(null);
  const placed = useMemo(() => bins.filter((b) => b.pos_x !== null && b.pos_y !== null && b.pos_z !== null), [bins]);
  const hi = useMemo(() => placed.filter((b) => highlighted.has(b.id)), [placed, highlighted]);
  const extent = useMemo(() => {
    const xs = placed.map((b) => Number(b.pos_x)), zs = placed.map((b) => Number(b.pos_z));
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...zs) + Math.max(...zs)) / 2, w: Math.max(...xs) - Math.min(...xs) + 20, d: Math.max(...zs) - Math.min(...zs) + 20 };
  }, [placed]);

  return (
    <Canvas frameloop="demand" camera={{ position: [extent.cx - 30, 45, extent.cz + 55], fov: 45, near: 0.1, far: 2000 }} dpr={[1, 2]}>
      <color attach="background" args={["#F5F8F6"]} />
      <hemisphereLight args={["#ffffff", "#A8B6B0", 1.1]} />
      <directionalLight position={[40, 60, 30]} intensity={1.2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[extent.cx, 0, extent.cz]} receiveShadow>
        <planeGeometry args={[extent.w, extent.d]} />
        <meshStandardMaterial color="#D9DDD6" />
      </mesh>
      <Uprights bins={placed} layout={layout} />
      <Bins bins={placed} layout={layout} mode={mode} onSelect={onSelect} />
      <Highlights bins={hi} layout={layout} />
      <ZoneLabels bins={placed} />
      <CameraControls ref={controls} makeDefault maxPolarAngle={Math.PI / 2.05} minDistance={3} maxDistance={400} />
      <Focus controls={controls} bins={hi} layout={layout} focusKey={focusKey} />
    </Canvas>
  );
}
