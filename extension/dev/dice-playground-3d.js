import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const diceAnimationMs = 7400;
const maxAnimatedDice = 20;
const dieRadius = 42;
const groundZ = dieRadius * 0.82;
const stage = document.getElementById("stage");
const status = document.getElementById("status");
const readout = document.getElementById("readout");
const regularInput = document.getElementById("regularCount");
const hungerInput = document.getElementById("hungerCount");
const autoButton = document.getElementById("autoButton");
const activeDice = new Set();
let autoTimer;
let audioContext;
let animationFrame = 0;
let lastFrame = performance.now();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 1, 2200);
camera.position.set(0, -560, 430);
camera.lookAt(0, 10, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.append(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0xd6d9df, 0x151018, 1.6);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
keyLight.position.set(-210, -260, 520);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -560;
keyLight.shadow.camera.right = 560;
keyLight.shadow.camera.top = 420;
keyLight.shadow.camera.bottom = -420;
keyLight.shadow.normalBias = 0.025;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xb30d1d, 1.3);
rimLight.position.set(360, 180, 260);
scene.add(rimLight);

const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1800, 1200),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.56 })
);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.z = 0;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

const d10Model = createD10Geometry();
const desiredResultNormal = new THREE.Vector3(0, -0.48, 0.88).normalize();
const resultLabelBaseOffset = 0.055;
const resultLabelRevealLift = 0.055;

document.getElementById("rollButton").addEventListener("click", () => playDiceAnimation(createRandomDice()));
document.getElementById("criticalButton").addEventListener("click", () =>
  playDiceAnimation([
    { kind: "regular", value: 10, sides: 10 },
    { kind: "regular", value: 10, sides: 10 },
    { kind: "hunger", value: 8, sides: 10 },
    { kind: "regular", value: 6, sides: 10 }
  ])
);
document.getElementById("failureButton").addEventListener("click", () =>
  playDiceAnimation([
    { kind: "hunger", value: 1, sides: 10 },
    { kind: "regular", value: 2, sides: 10 },
    { kind: "regular", value: 4, sides: 10 },
    { kind: "hunger", value: 3, sides: 10 }
  ])
);
document.getElementById("clearButton").addEventListener("click", clearDice);
autoButton.addEventListener("click", toggleAuto);
document.addEventListener("pointerdown", unlockDiceAudio, { capture: true, once: true });

for (const button of document.querySelectorAll("[data-step]")) {
  button.addEventListener("click", () => {
    const input = button.dataset.step === "hunger" ? hungerInput : regularInput;
    input.value = String(clampNumber(Number(input.value || 0) + Number(button.dataset.delta), 0, 20));
  });
}

window.addEventListener("resize", resizeRenderer);
resizeRenderer();
status.textContent = "Pronto para rolar d10 em 3D";
tick(performance.now());

if (new URLSearchParams(window.location.search).has("autoroll")) {
  window.setTimeout(() => playDiceAnimation(createRandomDice()), 300);
}

function createD10Geometry() {
  const top = new THREE.Vector3(0, 0, 1.16);
  const bottom = new THREE.Vector3(0, 0, -1.16);
  const equator = [];
  const radius = 0.92;

  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 10;
    const z = index % 2 === 0 ? 0.18 : -0.18;
    equator.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z));
  }

  const vertices = [];
  const normals = [];
  const indices = [];
  const anchors = [];

  for (let faceIndex = 0; faceIndex < 10; faceIndex += 1) {
    const nextIndex = (faceIndex + 1) % 10;
    const a = top.clone();
    const b = equator[faceIndex].clone();
    const c = bottom.clone();
    const d = equator[nextIndex].clone();
    const base = vertices.length / 3;
    vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    indices.push(base, base + 1, base + 3, base + 1, base + 2, base + 3);

    const center = a.clone().add(b).add(c).add(d).multiplyScalar(0.25);
    const normal = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
    if (normal.dot(center) < 0) {
      normal.multiplyScalar(-1);
    }

    for (let vertexIndex = 0; vertexIndex < 4; vertexIndex += 1) {
      normals.push(normal.x, normal.y, normal.z);
    }

    anchors.push({
      center,
      normal,
      twist: Math.atan2(center.y, center.x) + Math.PI / 2
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);

  return { geometry, faceAnchors: anchors };
}

function createRandomDice() {
  const regularCount = clampNumber(Number(regularInput.value || 0), 0, 20);
  const hungerCount = clampNumber(Number(hungerInput.value || 0), 0, 20);
  const dice = [];

  for (let index = 0; index < regularCount; index += 1) {
    dice.push({ kind: "regular", value: randomDieValue(), sides: 10 });
  }

  for (let index = 0; index < hungerCount; index += 1) {
    dice.push({ kind: "hunger", value: randomDieValue(), sides: 10 });
  }

  return shuffle(dice);
}

function playDiceAnimation(dice) {
  const pool = dice.slice(0, maxAnimatedDice);
  if (pool.length === 0) {
    status.textContent = "Escolha pelo menos um dado";
    return;
  }

  const animatedDice = pool.map((die, index) => createAnimatedDie(die, index, pool.length));
  for (const die of animatedDice) {
    activeDice.add(die);
    scene.add(die.group);
  }

  renderReadout(pool);
  playDiceRollSound(animatedDice.length);
  window.setTimeout(() => reportCanvasPixelStats("roll"), 700);
}

function createAnimatedDie(die, index, total) {
  const group = createDieMesh(die);
  const bounds = getWorldBounds();
  const angle = (Math.PI * 2 * index) / Math.max(1, total) + (Math.random() - 0.5) * 0.9;
  const startRadius = 16 + Math.random() * 76;
  const spread = 90 + Math.random() * 190;
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = bounds.top + (bounds.bottom - bounds.top) * 0.34;
  const startX = clampNumber(centerX + Math.cos(angle) * startRadius, bounds.left + dieRadius, bounds.right - dieRadius);
  const startY = clampNumber(centerY + Math.sin(angle) * startRadius, bounds.top + dieRadius, bounds.bottom - dieRadius);

  group.position.set(startX, startY, groundZ + 120 + Math.random() * 110);
  group.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

  return {
    group,
    value: die.value,
    kind: die.kind,
    x: startX,
    y: startY,
    z: group.position.z,
    vx: Math.cos(angle) * spread + (Math.random() - 0.5) * 110,
    vy: Math.sin(angle) * spread + (Math.random() - 0.5) * 110,
    vz: -430 - Math.random() * 260,
    angularVelocity: new THREE.Vector3(
      randomSigned(4.4, 8.8),
      randomSigned(5.0, 9.6),
      randomSigned(4.0, 8.8)
    ),
    birth: performance.now(),
    settled: false,
    settleAnchor: undefined,
    settleAnchorLocked: false,
    resultRevealed: false,
    revealStart: 0,
    resultLabel: undefined,
    resultAnchor: undefined,
    fadeStarted: false
  };
}

function createDieMesh(die) {
  const group = new THREE.Group();
  group.scale.setScalar(dieRadius);

  const palette = getDiePalette(die.kind);
  const material = new THREE.MeshStandardMaterial({
    color: palette.body,
    emissive: palette.emissive,
    emissiveIntensity: palette.emissiveIntensity,
    roughness: 0.48,
    metalness: 0.16,
    flatShading: false,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(d10Model.geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: palette.edge,
    transparent: true,
    opacity: 0.64
  });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(d10Model.geometry, 18), edgeMaterial);
  edges.scale.setScalar(1.006);
  group.add(edges);

  return group;
}

function createFaceLabel({ value, color, glow, scale = 1 }) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.shadowColor = glow;
  context.shadowBlur = 12;
  context.strokeStyle = "rgba(0, 0, 0, 0.72)";
  context.lineWidth = 8;
  context.fillStyle = color;
  context.font = "900 118px Georgia, serif";
  context.strokeText(String(value), 128, 90);
  context.fillText(String(value), 128, 90);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.98 * scale, 0.66 * scale),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    })
  );
  label.renderOrder = 8;
  return label;
}

function tick(now) {
  const dt = Math.min(0.034, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  updateAnimatedDice(now, dt);
  renderer.render(scene, camera);
  animationFrame = requestAnimationFrame(tick);
}

function reportCanvasPixelStats(label) {
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixel = new Uint8Array(4);
  let visibleSamples = 0;
  let brightSamples = 0;
  const steps = 15;

  for (let y = 1; y < steps; y += 1) {
    for (let x = 1; x < steps; x += 1) {
      gl.readPixels(
        Math.floor((width * x) / steps),
        Math.floor((height * y) / steps),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel
      );
      if (pixel[3] > 0) {
        visibleSamples += 1;
      }
      if (pixel[0] + pixel[1] + pixel[2] > 80) {
        brightSamples += 1;
      }
    }
  }

  stage.dataset.pixelStats = `${label}:visible=${visibleSamples};bright=${brightSamples}`;
  console.log(`[dice-playground] ${stage.dataset.pixelStats}`);
}

function updateAnimatedDice(now, dt) {
  const bounds = getWorldBounds();

  for (const die of activeDice) {
    if (!die.settled) {
      die.vz -= 2250 * dt;
      die.x += die.vx * dt;
      die.y += die.vy * dt;
      die.z += die.vz * dt;
      die.group.rotation.x += die.angularVelocity.x * dt;
      die.group.rotation.y += die.angularVelocity.y * dt;
      die.group.rotation.z += die.angularVelocity.z * dt;

      if (die.x < bounds.left + dieRadius) {
        die.x = bounds.left + dieRadius;
        die.vx = Math.abs(die.vx) * 0.5;
        die.angularVelocity.z *= -0.58;
        playDiceImpactSound(0.08);
      }
      if (die.x > bounds.right - dieRadius) {
        die.x = bounds.right - dieRadius;
        die.vx = -Math.abs(die.vx) * 0.5;
        die.angularVelocity.z *= -0.58;
        playDiceImpactSound(0.08);
      }
      if (die.y < bounds.top + dieRadius) {
        die.y = bounds.top + dieRadius;
        die.vy = Math.abs(die.vy) * 0.5;
        die.angularVelocity.x *= -0.58;
      }
      if (die.y > bounds.bottom - dieRadius) {
        die.y = bounds.bottom - dieRadius;
        die.vy = -Math.abs(die.vy) * 0.5;
        die.angularVelocity.x *= -0.58;
      }
      if (die.z <= groundZ) {
        die.z = groundZ;
        if (Math.abs(die.vz) > 120) {
          playDiceImpactSound(clampNumber(Math.abs(die.vz) / 2300, 0.06, 0.24));
        }
        die.vz = Math.abs(die.vz) * 0.24;
        die.vx *= 0.68;
        die.vy *= 0.68;
        die.angularVelocity.multiplyScalar(0.58);
      }

      const drag = die.z <= groundZ + 1 ? Math.pow(0.045, dt) : Math.pow(0.58, dt);
      die.vx *= drag;
      die.vy *= drag;
      die.angularVelocity.multiplyScalar(Math.pow(die.z <= groundZ + 1 ? 0.08 : 0.72, dt));
      stabilizeDieOnGround(die, now, dt);

      if (
        now - die.birth > 2300 &&
        die.z <= groundZ + 1 &&
        Math.abs(die.vz) < 95 &&
        Math.hypot(die.vx, die.vy) < 72 &&
        die.angularVelocity.length() < 1.15
      ) {
        beginSettle(die, now);
      }
      if (now - die.birth > 5000) {
        beginSettle(die, now);
      }
    }

    if (die.resultLabel && !die.fadeStarted) {
      renderDieResultReveal(die, now);
    }

    die.group.position.set(die.x, die.y, die.z);

    if (!die.fadeStarted && now - die.birth > diceAnimationMs - 900) {
      die.fadeStarted = true;
      fadeDie(die);
    }

    if (now - die.birth > diceAnimationMs) {
      scene.remove(die.group);
      disposeObject(die.group);
      activeDice.delete(die);
    }
  }

  resolveDieCollisions();
}

function beginSettle(die, now) {
  if (die.settled) {
    return;
  }
  const anchor = die.settleAnchor ?? getVisibleResultAnchor(die);
  die.settleAnchor = anchor;
  if (!isDieFaceStable(die) && now - die.birth < 6500) {
    return;
  }

  die.settled = true;
  die.x += die.vx * 0.016;
  die.y += die.vy * 0.016;
  die.z = groundZ;
  die.vx = 0;
  die.vy = 0;
  die.vz = 0;
  die.angularVelocity.set(0, 0, 0);
  revealDieResult(die, now);
  playDiceImpactSound(0.045);
}

function revealDieResult(die, now) {
  if (die.resultRevealed) {
    return;
  }

  const anchor = die.settleAnchor ?? getVisibleResultAnchor(die);
  const palette = getDiePalette(die.kind);
  const label = createFaceLabel({
    value: die.value,
    color: palette.ink,
    glow: palette.inkGlow
  });

  label.position.copy(anchor.center).addScaledVector(anchor.normal, resultLabelBaseOffset);
  label.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), anchor.normal);
  label.rotateZ(anchor.twist);
  setObjectOpacity(label, 0);

  die.group.add(label);
  die.resultAnchor = anchor;
  die.resultLabel = label;
  die.revealStart = now;
  die.resultRevealed = true;
}

function getVisibleResultAnchor(die) {
  let bestAnchor = d10Model.faceAnchors[0];
  let bestScore = -Infinity;
  const targetNormal = getDieSettleNormal(die);

  for (const anchor of d10Model.faceAnchors) {
    const score = getFaceAnchorScore(die, anchor, targetNormal);
    if (score > bestScore) {
      bestScore = score;
      bestAnchor = anchor;
    }
  }

  return bestAnchor;
}

function getFaceAnchorScore(die, anchor, targetNormal) {
  return anchor.normal.clone().applyQuaternion(die.group.quaternion).normalize().dot(targetNormal);
}

function stabilizeDieOnGround(die, now, dt) {
  if (die.z > groundZ + 2 || now - die.birth < 900) {
    return;
  }

  const motion = Math.hypot(die.vx, die.vy) + Math.abs(die.vz) * 0.2 + die.angularVelocity.length() * 24;
  const candidateAnchor = getVisibleResultAnchor(die);
  const targetNormal = getDieSettleNormal(die);
  const candidateScore = getFaceAnchorScore(die, candidateAnchor, targetNormal);
  const currentScore = die.settleAnchor ? getFaceAnchorScore(die, die.settleAnchor, targetNormal) : -Infinity;

  if (!die.settleAnchor || (!die.settleAnchorLocked && candidateScore > currentScore + 0.08)) {
    die.settleAnchor = candidateAnchor;
  }

  if (motion < 185 || now - die.birth > 2600) {
    die.settleAnchorLocked = true;
  }

  const anchor = die.settleAnchor;
  const anchorScore = getFaceAnchorScore(die, anchor, targetNormal);
  if (anchorScore < 0.24) {
    return;
  }

  const slowFactor = clampNumber((280 - motion) / 260, 0, 1);
  const ageFactor = clampNumber((now - die.birth - 1100) / 2300, 0, 1);
  const maxStep = clampNumber((0.012 + slowFactor * 0.055 + ageFactor * 0.035) * dt * 60, 0, 0.095);
  if (maxStep <= 0) {
    return;
  }

  die.group.quaternion.rotateTowards(createFaceUpQuaternion(die, anchor), maxStep);
  die.angularVelocity.multiplyScalar(1 - maxStep * 2.3);
}

function isDieFaceStable(die) {
  const anchor = die.settleAnchor ?? getVisibleResultAnchor(die);
  const normal = anchor.normal.clone().applyQuaternion(die.group.quaternion).normalize();
  return normal.dot(getDieSettleNormal(die)) > 0.965;
}

function getDieSettleNormal(die) {
  return desiredResultNormal.clone();
}

function createFaceUpQuaternion(die, anchor) {
  const current = die.group.quaternion.clone();
  const currentNormal = anchor.normal.clone().applyQuaternion(current).normalize();
  const alignFace = new THREE.Quaternion().setFromUnitVectors(currentNormal, getDieSettleNormal(die));
  return alignFace.multiply(current).normalize();
}

function renderDieResultReveal(die, now) {
  if (!die.resultLabel || !die.resultAnchor) {
    return;
  }

  const progress = clampNumber((now - die.revealStart) / 460, 0, 1);
  const eased = 1 - Math.pow(1 - progress, 3);
  die.resultLabel.position
    .copy(die.resultAnchor.center)
    .addScaledVector(die.resultAnchor.normal, resultLabelBaseOffset + eased * resultLabelRevealLift);
  setObjectOpacity(die.resultLabel, eased);
}

function setObjectOpacity(object, opacity) {
  object.traverse((child) => {
    if (!child.material) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = true;
      material.opacity = opacity;
    }
  });
}

function resolveDieCollisions() {
  const dice = [...activeDice].filter((die) => !die.fadeStarted);
  for (let i = 0; i < dice.length; i += 1) {
    for (let j = i + 1; j < dice.length; j += 1) {
      const first = dice[i];
      const second = dice[j];
      if ((first.settled && second.settled) || Math.abs(first.z - second.z) > dieRadius * 2.05) {
        continue;
      }

      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.hypot(dx, dy) || 1;
      const minDistance = dieRadius * 1.92;
      if (distance >= minDistance) {
        continue;
      }

      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      const firstMobility = first.settled ? 0.18 : 1;
      const secondMobility = second.settled ? 0.18 : 1;
      const mobility = firstMobility + secondMobility;
      const firstShift = (overlap * firstMobility) / mobility;
      const secondShift = (overlap * secondMobility) / mobility;
      first.x -= nx * firstShift;
      first.y -= ny * firstShift;
      second.x += nx * secondShift;
      second.y += ny * secondShift;

      const relativeVelocity = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
      if (relativeVelocity < 0) {
        const impulse = -(1.22 * relativeVelocity) / mobility;
        if (!first.settled) {
          first.vx -= impulse * nx * firstMobility;
          first.vy -= impulse * ny * firstMobility;
          first.angularVelocity.z += impulse * 0.022;
          first.settleAnchorLocked = false;
        }
        if (!second.settled) {
          second.vx += impulse * nx * secondMobility;
          second.vy += impulse * ny * secondMobility;
          second.angularVelocity.z -= impulse * 0.022;
          second.settleAnchorLocked = false;
        }
        if (Math.abs(relativeVelocity) > 120) {
          playDiceImpactSound(clampNumber(Math.abs(relativeVelocity) / 3000, 0.04, 0.13));
        }
      }
    }
  }
}

function fadeDie(die) {
  const fadeMaterials = [];
  die.group.traverse((child) => {
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material.transparent = true;
        fadeMaterials.push(material);
      }
    }
  });

  const start = performance.now();
  const step = () => {
    const progress = clampNumber((performance.now() - start) / 700, 0, 1);
    for (const material of fadeMaterials) {
      material.opacity = 1 - progress;
    }
    if (progress < 1 && activeDice.has(die)) {
      requestAnimationFrame(step);
    }
  };
  step();
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material.map) {
          material.map.dispose();
        }
        material.dispose();
      }
    }
  });
}

function getWorldBounds() {
  const rect = stage.getBoundingClientRect();
  const aspect = Math.max(0.8, rect.width / Math.max(1, rect.height));
  const height = 480;
  const width = height * aspect;
  return {
    left: -width / 2 + 44,
    right: width / 2 - 44,
    top: -height / 2 + 28,
    bottom: height / 2 - 96
  };
}

function resizeRenderer() {
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function renderReadout(dice) {
  const tens = dice.filter((die) => die.value === 10).length;
  const successes = dice.filter((die) => die.value >= 6).length + Math.floor(tens / 2) * 2;
  const hungerOnes = dice.filter((die) => die.kind === "hunger" && die.value === 1).length;
  const hungerTens = dice.filter((die) => die.kind === "hunger" && die.value === 10).length;
  const outcome =
    successes <= 0 && hungerOnes > 0
      ? "Falha bestial"
      : hungerTens > 0 && tens >= 2
        ? "Critico bestial"
        : successes > 0
          ? "Sucesso"
          : "Falha";
  status.textContent = `${dice.length}d10, ${successes} sucessos, ${outcome}`;
  readout.innerHTML = dice
    .map((die) => `<span class="chip"><strong>${die.kind === "hunger" ? "H" : "N"}${die.value}</strong> ${dieFaceLabel(getDieFace(die))}</span>`)
    .join("");
}

function clearDice() {
  for (const die of [...activeDice]) {
    scene.remove(die.group);
    disposeObject(die.group);
    activeDice.delete(die);
  }
  readout.innerHTML = "";
  status.textContent = "Mesa limpa";
}

function toggleAuto() {
  if (autoTimer) {
    window.clearInterval(autoTimer);
    autoTimer = undefined;
    autoButton.classList.remove("active");
    status.textContent = "Auto parado";
    return;
  }
  playDiceAnimation(createRandomDice());
  autoTimer = window.setInterval(() => playDiceAnimation(createRandomDice()), 1800);
  autoButton.classList.add("active");
}

function getDiePalette(kind) {
  if (kind === "hunger") {
    return {
      body: 0x970b17,
      emissive: 0x230005,
      emissiveIntensity: 0.2,
      edge: 0x240004,
      ink: "#030305",
      inkGlow: "rgba(0, 0, 0, 0.55)"
    };
  }

  return {
    body: 0x040506,
    emissive: 0x080000,
    emissiveIntensity: 0.16,
    edge: 0x3d050b,
    ink: "#b20d1b",
    inkGlow: "rgba(178, 13, 27, 0.62)"
  };
}

function playDiceRollSound(diceCount) {
  const context = getAudioContext();
  if (!context) {
    return;
  }
  context.resume().catch(() => {});
  playDiceRattleSound(diceCount);
  const hits = Math.min(18, Math.max(6, diceCount * 3));
  for (let index = 0; index < hits; index += 1) {
    window.setTimeout(() => playDiceImpactSound(0.02 + Math.random() * 0.045), 80 + Math.random() * 900);
  }
}

function playDiceRattleSound(diceCount) {
  const context = getAudioContext();
  if (!context || context.state === "closed") {
    return;
  }
  const duration = clampNumber(0.28 + diceCount * 0.035, 0.3, 0.72);
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
  const data = buffer.getChannelData(0);
  let grain = 0;
  for (let index = 0; index < data.length; index += 1) {
    if (index % Math.max(1, Math.floor(context.sampleRate / (180 + diceCount * 24))) === 0) {
      grain = Math.random() * 2 - 1;
    }
    const progress = index / data.length;
    const envelope = Math.sin(Math.PI * progress) * (1 - progress * 0.35);
    data[index] = (grain * 0.62 + (Math.random() * 2 - 1) * 0.38) * envelope;
  }

  const source = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  highpass.type = "highpass";
  highpass.frequency.value = 260;
  lowpass.type = "lowpass";
  lowpass.frequency.value = 2400 + Math.random() * 900;
  gain.gain.setValueAtTime(clampNumber(0.045 + diceCount * 0.006, 0.05, 0.12), context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(context.destination);
  source.start();
  source.stop(context.currentTime + duration + 0.02);
}

function playDiceImpactSound(volume) {
  const context = getAudioContext();
  if (!context || context.state === "closed") {
    return;
  }
  const duration = 0.045 + Math.random() * 0.045;
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    const progress = index / data.length;
    const envelope = Math.pow(1 - progress, 2.2);
    data[index] = (Math.random() * 2 - 1) * envelope;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const thud = context.createOscillator();
  const thudGain = context.createGain();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 750 + Math.random() * 1500;
  filter.Q.value = 5 + Math.random() * 6;
  thud.type = "triangle";
  thud.frequency.setValueAtTime(120 + Math.random() * 80, context.currentTime);
  thud.frequency.exponentialRampToValueAtTime(58, context.currentTime + duration);
  thudGain.gain.setValueAtTime(clampNumber(volume * 0.9, 0.01, 0.13), context.currentTime);
  thudGain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration * 1.25);
  gain.gain.setValueAtTime(clampNumber(volume, 0.015, 0.18), context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  thud.connect(thudGain);
  thudGain.connect(context.destination);
  source.start();
  thud.start();
  source.stop(context.currentTime + duration + 0.01);
  thud.stop(context.currentTime + duration * 1.3);
}

function getAudioContext() {
  if (audioContext) {
    return audioContext;
  }
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return undefined;
  }
  audioContext = new AudioContextConstructor();
  return audioContext;
}

function unlockDiceAudio() {
  const context = getAudioContext();
  if (context) {
    context.resume();
  }
}

function randomDieValue() {
  return 1 + Math.floor(Math.random() * 10);
}

function randomSigned(min, max) {
  const value = min + Math.random() * (max - min);
  return Math.random() > 0.5 ? value : -value;
}

function getDieFace(die) {
  if (die.kind === "hunger" && die.value === 1) {
    return "skull";
  }
  if (die.value === 10) {
    return "critical";
  }
  if (die.value >= 6 && die.value <= 9) {
    return "success";
  }
  return "blank";
}

function faceSymbol(face) {
  if (face === "skull") {
    return "\u2620";
  }
  if (face === "critical") {
    return "\u2625\u2726";
  }
  if (face === "success") {
    return "\u2625";
  }
  return "\u2736";
}

function dieFaceLabel(face) {
  if (face === "skull") {
    return "caveira";
  }
  if (face === "critical") {
    return "critico";
  }
  if (face === "success") {
    return "sucesso";
  }
  return "vazio";
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

window.__diceAnimationPlayground = {
  roll: () => playDiceAnimation(createRandomDice()),
  clear: clearDice,
  activeDice,
  renderer,
  scene
};
