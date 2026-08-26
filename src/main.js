import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { WebGLPathTracer, GradientEquirectTexture } from 'three-gpu-pathtracer'
import { SPECS, SPEC_BY_ID } from './specs/index.js'
import {
  buildVessel, vesselMetrics, resolveSlot, cloneSpec, SLOTS, SLOT_LABELS,
} from './components/index.js'
import { MATERIALS, getMaterial } from './materials/index.js'

// ---- renderer / scene ------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.querySelector('#app').appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#f2ede3')

const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.55

const camera = new THREE.PerspectiveCamera(
  30,
  window.innerWidth / window.innerHeight,
  0.1,
  50,
)
camera.position.set(2.7, 1.5, 3.3)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.45, 0)
controls.enableDamping = true
controls.minDistance = 1.6
controls.maxDistance = 9
controls.maxPolarAngle = Math.PI * 0.55

// ---- studio lighting -------------------------------------------------------

const key = new THREE.DirectionalLight('#fff6e8', 2.6)
key.position.set(3.5, 5.5, 2.5)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera.left = key.shadow.camera.bottom = -2.5
key.shadow.camera.right = key.shadow.camera.top = 2.5
key.shadow.radius = 6
key.shadow.bias = -0.0004
scene.add(key)

const fill = new THREE.DirectionalLight('#dfe8f0', 0.7)
fill.position.set(-4, 2.5, -1.5)
scene.add(fill)

const rim = new THREE.DirectionalLight('#ffffff', 0.9)
rim.position.set(-1.5, 3.5, -4)
scene.add(rim)

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(8, 48).rotateX(-Math.PI / 2),
  new THREE.ShadowMaterial({ opacity: 0.14 }),
)
ground.receiveShadow = true
scene.add(ground)

// matte paper floor for photo mode (path tracer can't use ShadowMaterial)
const photoGround = new THREE.Mesh(
  new THREE.CircleGeometry(8, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: '#efe9dd', roughness: 0.95 }),
)
photoGround.visible = false
scene.add(photoGround)

// ---- state -----------------------------------------------------------------

let archiveEntry = SPECS[0] // the untouched archive spec
let spec = cloneSpec(archiveEntry) // the working copy edited by sliders
let activeMaterialKey = spec.material
let pot = null

/** get/set "slot.param" paths on the working spec */
function getPath(path) {
  const [slot, key] = path.split('.')
  return resolveSlot(spec, slot).p[key]
}
function setPath(path, value) {
  const [slot, key] = path.split('.')
  spec[slot] = spec[slot] || {}
  spec[slot][key] = value
}
function paramDef(path) {
  const [slot, key] = path.split('.')
  return resolveSlot(spec, slot).def.params[key]
}

// ---- URL specs: every design is a shareable address ------------------------
// #id=jingzhou-shipiao&mat=zini&body.bellyR=0.9&knob.rise=0.16&cam=side&ui=hide

function applyHash() {
  const h = new URLSearchParams(location.hash.slice(1))
  const id = h.get('id')
  if (id && SPEC_BY_ID[id]) archiveEntry = SPEC_BY_ID[id]
  spec = cloneSpec(archiveEntry)
  const mat = h.get('mat')
  activeMaterialKey = mat && MATERIALS[mat] ? mat : spec.material
  for (const [k, v] of h.entries()) {
    if (!k.includes('.')) continue
    const num = parseFloat(v)
    const def = paramDef(k)
    if (def && Number.isFinite(num)) {
      setPath(k, THREE.MathUtils.clamp(num, def.min, def.max))
    }
  }
  if (h.get('cam') === 'side') {
    // catalogue-style side view; elev/dist/fov let a render mimic a
    // reference photograph's camera (for photo→spec fitting)
    const elev = THREE.MathUtils.degToRad(parseFloat(h.get('elev') ?? '8'))
    const az = THREE.MathUtils.degToRad(parseFloat(h.get('az') ?? '0')) // + swings toward the spout side
    const dist = parseFloat(h.get('dist') ?? '3.9')
    const ty = parseFloat(h.get('ty') ?? '0.45')
    if (h.get('fov')) {
      camera.fov = parseFloat(h.get('fov'))
      camera.updateProjectionMatrix()
    }
    const r = dist * Math.cos(elev)
    camera.position.set(r * Math.sin(az), ty + dist * Math.sin(elev), r * Math.cos(az))
    controls.target.set(0, ty, 0)
    controls.maxDistance = Math.max(controls.maxDistance, dist + 1)
  }
  if (h.get('ui') === 'hide') document.body.classList.add('ui-hidden')
  fitMode = h.get('fit') === '1'
  pendingScene = h.get('scene') || null
  // keep scene params: writeHash() rewrites the hash before applyScene reads it
  sceneParams = Object.fromEntries([...h].filter(([k]) => k.startsWith('sc_')))
}

// fit mode: flat unlit silhouette, no shadows — for photo→spec fitting tools
let fitMode = false
const fitMaterial = new THREE.MeshBasicMaterial({ color: '#c8402a' })
function applyFitMode() {
  renderer.shadowMap.enabled = !fitMode
  ground.visible = !fitMode
  if (fitMode) {
    scene.background = new THREE.Color('#ffffff')
    pot.traverse((o) => { if (o.isMesh) o.material = fitMaterial })
  } else {
    scene.background = new THREE.Color('#f2ede3')
  }
}
// synchronous render + pixel grab (drawing buffer is intact within one task)
window.__snap = () => {
  controls.update()
  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}

function writeHash() {
  const h = new URLSearchParams()
  h.set('id', archiveEntry.id)
  h.set('mat', activeMaterialKey)
  // only record what differs from the archive entry — the diff IS the design
  for (const slot of SLOTS) {
    const { p } = resolveSlot(spec, slot)
    const { p: base } = resolveSlot(archiveEntry, slot)
    for (const [k, v] of Object.entries(p)) {
      if (k !== 'type' && v !== base[k]) h.set(`${slot}.${k}`, v)
    }
  }
  if (pendingScene) {
    h.set('scene', pendingScene)
    for (const [k, val] of Object.entries(sceneParams)) h.set(k, val)
  }
  history.replaceState(null, '', '#' + h.toString())
}

function rebuild() {
  if (typeof exitPhoto === 'function') exitPhoto()
  if (pot) {
    disposePot(pot)
    scene.remove(pot)
  }
  pot = buildVessel(spec, getMaterial(activeMaterialKey))
  scene.add(pot)
  // how tall the finished pot stands, so QC can aim its close-ups at the lid,
  // the spout root and the handle roots as fractions of the pot rather than at
  // hard-coded world heights that only frame one shape correctly
  window.__potTop = new THREE.Box3().setFromObject(pot).max.y
  if (typeof scalePotForScene === 'function') scalePotForScene()
  if (typeof applyFitMode === 'function') applyFitMode()
  renderMetrics()
  if (!fitMode) writeHash()
}

function disposePot(p) {
  p.traverse((o) => {
    if (o.isMesh) o.geometry.dispose()
  })
}

// ---- UI --------------------------------------------------------------------

const shapeList = document.querySelector('#shape-list')
const swatchBox = document.querySelector('#material-swatches')
const sliderBox = document.querySelector('#sliders')
const metricsBox = document.querySelector('#metrics')
const paramTitle = document.querySelector('#param-title')
const anatomyBox = document.querySelector('#anatomy')

function renderShapeList() {
  shapeList.innerHTML = ''
  for (const entry of SPECS) {
    const b = document.createElement('button')
    b.className = 'shape-btn' + (entry === archiveEntry ? ' active' : '')
    b.innerHTML = `<strong>${entry.label}</strong><em>${entry.categoryLabel}</em>`
    b.title = entry.notes || ''
    b.addEventListener('click', () => selectEntry(entry))
    shapeList.append(b)
  }
}

function selectEntry(entry) {
  archiveEntry = entry
  spec = cloneSpec(entry)
  activeMaterialKey = spec.material
  renderShapeList()
  renderSwatches()
  renderSliders()
  renderAnatomy()
  rebuild()
}

function renderSwatches() {
  swatchBox.innerHTML = ''
  for (const [k, def] of Object.entries(MATERIALS)) {
    const wrap = document.createElement('div')
    const b = document.createElement('button')
    b.className = 'swatch' + (k === activeMaterialKey ? ' active' : '')
    b.style.background = def.base
    b.title = def.label
    b.addEventListener('click', () => {
      exitPhoto()
      activeMaterialKey = k
      swatchBox.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'))
      b.classList.add('active')
      pot.traverse((o) => {
        if (o.isMesh && !(o.material instanceof THREE.ShadowMaterial)) {
          o.material = getMaterial(k)
        }
      })
      writeHash()
    })
    const lbl = document.createElement('span')
    lbl.className = 'swatch-label'
    lbl.textContent = def.label
    wrap.append(b, lbl)
    swatchBox.append(wrap)
  }
}

function renderSliders() {
  paramTitle.textContent = `形制 · ${spec.label}`
  sliderBox.innerHTML = ''
  for (const path of spec.expose || []) {
    const def = paramDef(path)
    if (!def) continue
    const label = document.createElement('label')
    label.textContent = def.label

    const input = document.createElement('input')
    input.type = 'range'
    input.min = def.min
    input.max = def.max
    input.step = def.step
    input.value = getPath(path)

    const val = document.createElement('span')
    val.className = 'val'
    val.textContent = Number(getPath(path)).toFixed(2)

    input.addEventListener('input', () => {
      setPath(path, parseFloat(input.value))
      val.textContent = parseFloat(input.value).toFixed(2)
      rebuild()
    })

    label.append(input, val)
    sliderBox.append(label)
  }
}

/** 解剖 — the spec's anatomy at a glance: slot → component type */
function renderAnatomy() {
  anatomyBox.innerHTML = ''
  for (const slot of SLOTS) {
    const { def } = resolveSlot(spec, slot)
    const row = document.createElement('div')
    row.className = 'metric'
    row.innerHTML = `<span>${SLOT_LABELS[slot]}</span><span>${def.label}</span>`
    anatomyBox.append(row)
  }
}

function renderMetrics() {
  metricsBox.innerHTML = ''
  for (const m of vesselMetrics(spec)) {
    const row = document.createElement('div')
    row.className = 'metric'
    row.innerHTML = `<span>${m.label}</span><span>${m.value}</span>`
    metricsBox.append(row)
  }
}

document.querySelector('#reset').addEventListener('click', () => {
  spec = cloneSpec(archiveEntry)
  renderSliders()
  rebuild()
})

document.querySelector('#export').addEventListener('click', () => {
  const out = cloneSpec(spec)
  out.material = activeMaterialKey
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${spec.id}.json`
  a.click()
  URL.revokeObjectURL(a.href)
})


// ---- scene mode: the pot composited into a photographed place ---------------
// A scene is a backplate photo plus the HDRI light probe shot at the same spot,
// so the pot's lighting and the background agree by construction. The pot is
// scaled from its spec (units → metres), stands on an invisible shadow
// catcher, and the canvas is composited over the plate.

const backplate = document.querySelector('#backplate')
let pendingScene = null
let sceneParams = {}
let sceneCfg = null
let shadowCatcher = null
let sunLight = null

function scalePotForScene() {
  if (!pot) return
  pot.scale.setScalar(sceneCfg ? (spec.scaleCm ?? 8) / 100 : 1)
  if (!sceneCfg) {
    pot.position.set(0, 0, 0)
    return
  }
  // the pot stands where we put it on the table, not wherever the camera aims:
  // the camera is the photograph's camera, the pot is furniture on the plane
  const at = sceneCfg.potPos ?? [0, 0, 0]
  const px = 'sc_px' in sceneParams ? parseFloat(sceneParams.sc_px) : at[0]
  const pz = 'sc_pz' in sceneParams ? parseFloat(sceneParams.sc_pz) : (at[2] ?? 0)
  pot.position.set(px, at[1] ?? 0, pz)
}

async function applyScene(id) {
  const base = `scenes/${id}/`
  const cfg = await (await fetch(base + 'scene.json')).json()
  sceneCfg = cfg
  backplate.src = base + cfg.plate
  backplate.hidden = false

  const hdr = await new RGBELoader().loadAsync(base + cfg.hdri)
  hdr.mapping = THREE.EquirectangularReflectionMapping
  scene.environment = pmrem.fromEquirectangular(hdr).texture
  scene.environmentRotation = new THREE.Euler(0, cfg.envRotation ?? 0, 0)
  scene.environmentIntensity = 1
  hdr.dispose()
  scene.background = null
  renderer.setClearAlpha(0)
  renderer.toneMappingExposure = cfg.exposure ?? 1

  for (const l of [key, fill, rim]) l.visible = false
  if (!sunLight) {
    sunLight = new THREE.DirectionalLight(0xffffff, 1)
    sunLight.castShadow = true
    sunLight.shadow.mapSize.set(2048, 2048)
    const c = sunLight.shadow.camera
    c.left = c.bottom = -0.35
    c.right = c.top = 0.35
    c.near = 0.01
    c.far = 5
    sunLight.shadow.bias = -0.0004
    sunLight.shadow.normalBias = 0.004
    scene.add(sunLight)
  }
  const sun = cfg.sun ?? {}
  const el = THREE.MathUtils.degToRad(sun.elev ?? 35)
  const az = THREE.MathUtils.degToRad(sun.az ?? 45)
  sunLight.position
    .set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
    .multiplyScalar(2)
  sunLight.intensity = sun.intensity ?? 2
  sunLight.color.set(sun.color ?? '#ffffff')
  sunLight.shadow.radius = cfg.shadow?.softness ?? 4

  ground.visible = false
  photoGround.visible = false
  if (!shadowCatcher) {
    shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.4 }),
    )
    shadowCatcher.receiveShadow = true
    scene.add(shadowCatcher)
  }
  shadowCatcher.material.opacity = cfg.shadow?.opacity ?? 0.4
  shadowCatcher.visible = true

  // Match the photograph's camera, not an orbit around the pot. The plate is a
  // crop of a larger frame, so the optical axis is off-centre: setViewOffset
  // reproduces exactly that crop. Café/interior plates are shot level (their
  // verticals stay parallel), so the default pose is a level camera at
  // `height` above the table surface, `dist` back from the world origin.
  const num = (k, d) => (k in sceneParams ? parseFloat(sceneParams[k]) : d)
  const cam = cfg.camera
  const full = cam.frame ?? [1, 1]
  const crop = cam.crop ?? [0, 0, full[0], full[1]]
  const sensorH = cam.sensor?.[1] ?? 36
  const focal = num('sc_focal', cam.focal ?? 24)
  camera.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(sensorH / 2 / focal))
  camera.aspect = full[0] / full[1]
  camera.setViewOffset(full[0], full[1], crop[0], crop[1], crop[2], crop[3])
  const height = num('sc_h', cam.height ?? 0.6)     // metres above the table top
  const dist = num('sc_dist', cam.dist ?? 2.0)      // metres back from the origin
  const yaw = THREE.MathUtils.degToRad(num('sc_yaw', cam.yaw ?? 0))
  const tilt = THREE.MathUtils.degToRad(num('sc_tilt', cam.tilt ?? 0))
  camera.position.set(dist * Math.sin(yaw), height, dist * Math.cos(yaw))
  controls.target.set(
    camera.position.x - Math.sin(yaw) * 1,
    height + Math.tan(-tilt) * 1,
    camera.position.z - Math.cos(yaw) * 1,
  )
  controls.minDistance = 0.05
  controls.maxDistance = 20
  renderer.toneMappingExposure = num('sc_exp', cfg.exposure ?? 1)
  scalePotForScene()
  window.__sceneReady = true
}

// ---- 拍照 photo mode: progressive path tracing -----------------------------

const photoBtn = document.querySelector('#photo')
const renderStatus = document.querySelector('#render-status')

let photoMode = false
let pathTracer = null
let targetSamples = 300
let attemptCleared = false
let lastInteraction = 0
let ptNeedsReset = false
let sampleClock = 0
let adaptiveChecked = false
const IDLE_MS = 600

// Android's GPU watchdog kills long single GPU jobs, so phones get the work
// chopped into tiles at reduced scale; desktops keep full quality.
const IS_MOBILE =
  /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900)

// crash ladder: if the tab died during a photo attempt, the marker survives
// in localStorage and the next visit picks a more conservative profile
const CRASH_KEY = 'taoqi-photo-crash-level'
const ATTEMPT_KEY = 'taoqi-photo-attempt'
if (localStorage.getItem(ATTEMPT_KEY) !== null) {
  const lvl = Math.min(2, (parseInt(localStorage.getItem(CRASH_KEY), 10) || 0) + 1)
  localStorage.setItem(CRASH_KEY, String(lvl))
  localStorage.removeItem(ATTEMPT_KEY)
}

function photoProfile() {
  const lvl = parseInt(localStorage.getItem(CRASH_KEY), 10) || 0
  if (lvl >= 2) return { scale: 0.3, tiles: 5, bounces: 3, mis: false, samples: 80 }
  if (lvl === 1) return { scale: 0.4, tiles: 4, bounces: 4, mis: false, samples: 120 }
  return IS_MOBILE
    ? { scale: 0.55, tiles: 3, bounces: 5, mis: false, samples: 150 }
    : { scale: 1, tiles: 1, bounces: 8, mis: true, samples: 300 }
}

// soft studio dome: bright warm above, paper below
const studioEnv = new GradientEquirectTexture()
studioEnv.topColor.set('#fffdf5')
studioEnv.bottomColor.set('#c9c2b2')
studioEnv.update()

const realtimeEnv = scene.environment

function enterPhoto() {
  photoMode = true
  ground.visible = false
  photoGround.visible = true
  scene.environment = studioEnv
  scene.environmentIntensity = 1.0

  const prof = photoProfile()
  targetSamples = prof.samples
  attemptCleared = false
  localStorage.setItem(ATTEMPT_KEY, '1') // cleared once sampling proves stable

  pathTracer = pathTracer || new WebGLPathTracer(renderer)
  pathTracer.bounces = prof.bounces
  pathTracer.renderScale = prof.scale
  pathTracer.tiles.set(prof.tiles, prof.tiles)
  pathTracer.multipleImportanceSampling = prof.mis
  pathTracer.filterGlossyFactor = 0.5
  pathTracer.setScene(scene, camera) // builds the BVH; brief pause is normal

  lastInteraction = 0
  ptNeedsReset = false
  sampleClock = performance.now()
  adaptiveChecked = false
  photoBtn.classList.add('active')
  photoBtn.textContent = '返回'
  renderStatus.hidden = false
}

function exitPhoto() {
  if (!photoMode) return
  photoMode = false
  localStorage.removeItem(ATTEMPT_KEY) // orderly exit, not a crash
  ground.visible = true
  photoGround.visible = false
  scene.environment = realtimeEnv
  scene.environmentIntensity = 0.55
  photoBtn.classList.remove('active')
  photoBtn.textContent = '拍照'
  renderStatus.hidden = true
}

function setPhotoLabel(text) {
  if (renderStatus.textContent !== text) renderStatus.textContent = text
}

photoBtn.addEventListener('click', () => (photoMode ? exitPhoto() : enterPhoto()))
// leaving the page normally is not a crash either (a real GPU-process crash
// kills the page before this event can fire)
window.addEventListener('pagehide', () => {
  if (photoMode && !attemptCleared) localStorage.removeItem(ATTEMPT_KEY)
})

// camera moves inside photo mode switch to the raster preview for composing;
// sampling restarts by itself once the camera settles (see the render loop)
controls.addEventListener('change', () => {
  if (photoMode) {
    lastInteraction = performance.now()
    ptNeedsReset = true
  }
})

applyHash()
renderShapeList()
renderSwatches()
renderSliders()
renderAnatomy()
rebuild()
if (pendingScene) applyScene(pendingScene)

// fitting tools drive the page by rewriting the hash in one browser session
window.addEventListener('hashchange', () => {
  applyHash()
  renderShapeList()
  renderSwatches()
  renderSliders()
  renderAnatomy()
  rebuild()
  window.__potReady = (window.__potReady || 0) + 1
})
window.__potReady = 1

// ---- tap canvas to toggle fullscreen view ----------------------------------

{
  const canvas = renderer.domElement
  let downX = 0
  let downY = 0
  let downT = 0
  let activePointers = 0
  let multiTouch = false

  canvas.addEventListener('pointerdown', (e) => {
    activePointers++
    if (activePointers > 1) multiTouch = true
    downX = e.clientX
    downY = e.clientY
    downT = performance.now()
  })
  canvas.addEventListener('pointerup', (e) => {
    activePointers = Math.max(0, activePointers - 1)
    if (activePointers > 0) return
    const quick = performance.now() - downT < 350
    const still = Math.hypot(e.clientX - downX, e.clientY - downY) < 8
    if (!multiTouch && quick && still) document.body.classList.toggle('ui-hidden')
    multiTouch = false
  })
  canvas.addEventListener('pointercancel', () => {
    activePointers = Math.max(0, activePointers - 1)
    if (activePointers === 0) multiTouch = false
  })
}

// ---- loop ------------------------------------------------------------------

window.addEventListener('resize', () => {
  exitPhoto()
  if (!sceneCfg) camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

renderer.setAnimationLoop(() => {
  if (photoMode) {
    if (performance.now() - lastInteraction < IDLE_MS) {
      // composing the shot — fast raster preview
      controls.update()
      renderer.render(scene, camera)
      setPhotoLabel('取景中…')
      return
    }
    if (ptNeedsReset) {
      ptNeedsReset = false
      pathTracer.updateCamera() // resets accumulation for the new angle
      sampleClock = performance.now()
      adaptiveChecked = false
    }
    pathTracer.renderSample()
    const samples = pathTracer.samples
    if (!attemptCleared && samples >= 3) {
      attemptCleared = true
      localStorage.removeItem(ATTEMPT_KEY) // survived — this profile is stable
    }
    // integrated-GPU laptops: shorten the climb instead of grinding to 300
    if (!adaptiveChecked && samples >= 6) {
      adaptiveChecked = true
      const msPerSample = (performance.now() - sampleClock) / samples
      if (msPerSample > 130) targetSamples = Math.min(targetSamples, 120)
    }
    const s = Math.min(samples | 0, targetSamples)
    setPhotoLabel(s < targetSamples ? `渲染 · ${s}/${targetSamples}` : '完成 · 可截屏')
    return
  }
  controls.update()
  renderer.render(scene, camera)
})
