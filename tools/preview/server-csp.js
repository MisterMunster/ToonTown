// CSP probe for server/server.js: renders a small scene using the Babylon.js
// features the game uses and reports any Content-Security-Policy violation.
import "@fontsource/fredoka/700.css";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  Engine,
  GlowLayer,
  HemisphericLight,
  Matrix,
  MeshBuilder,
  ParticleSystem,
  RawTexture,
  Scene,
  ShadowGenerator,
  SSAO2RenderingPipeline,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { SkyMaterial } from "@babylonjs/materials";

const report = document.getElementById("report");
const violations = [];
document.addEventListener("securitypolicyviolation", (e) => {
  const msg = `CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || "(inline)"}`;
  violations.push(msg);
  console.error(msg);
});

async function main() {
  const canvas = document.getElementById("c");
  const engine = new Engine(canvas, true, { stencil: true });
  engine.resize();
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.56, 0.83, 1, 1);

  const camera = new ArcRotateCamera("cam", -Math.PI / 2.4, 1.1, 22, new Vector3(0, 1.5, 0), scene);
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.6;
  const sun = new DirectionalLight("sun", new Vector3(-0.6, -1, -0.4), scene);
  sun.position = new Vector3(20, 30, 15);

  // Sky material from @babylonjs/materials (custom shader).
  const sky = MeshBuilder.CreateBox("sky", { size: 400, sideOrientation: 1 }, scene);
  const skyMat = new SkyMaterial("skyMat", scene);
  skyMat.backFaceCulling = false;
  skyMat.luminance = 0.9;
  skyMat.turbidity = 4;
  skyMat.inclination = 0.1;
  sky.material = skyMat;
  sky.infiniteDistance = true;

  const mat = (hex) => {
    const m = new StandardMaterial(hex, scene);
    m.diffuseColor = Color3.FromHexString(hex);
    m.specularColor = Color3.Black();
    return m;
  };

  const ground = MeshBuilder.CreateGround("ground", { width: 40, height: 40 }, scene);
  ground.material = mat("#7ccf5b");
  ground.receiveShadows = true;

  // Thin-instanced houses + shadows.
  const house = MeshBuilder.CreateBox("house", { size: 2 }, scene);
  house.material = mat("#ffd1dc");
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    house.thinInstanceAdd(Matrix.Translation(Math.cos(a) * 9, 1, Math.sin(a) * 9));
  }
  const shadows = new ShadowGenerator(1024, sun);
  shadows.addShadowCaster(house);

  // DynamicTexture sign drawn with the bundled Fredoka font (font-src 'self').
  await document.fonts.load("700 64px Fredoka").catch(() => {});
  const signTex = new DynamicTexture("sign", { width: 512, height: 128 }, scene);
  signTex.drawText("TOON TOWN", null, 92, "700 72px Fredoka", "#1d2b3a", "#ffb703", true, true);
  const sign = MeshBuilder.CreatePlane("signPlane", { width: 8, height: 2 }, scene);
  sign.position.set(0, 5, 0);
  const signMat = new StandardMaterial("signMat", scene);
  signMat.diffuseTexture = signTex;
  signMat.emissiveColor = new Color3(0.15, 0.15, 0.15);
  sign.material = signMat;
  sign.billboardMode = TransformNode.BILLBOARDMODE_ALL;

  // RawTexture (procedural), data: URL texture (img-src data:), blob: URL texture (img-src blob:).
  const px = new Uint8Array(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 255));
  const raw = RawTexture.CreateRGBATexture(px, 16, 16, scene);
  const dot = document.createElement("canvas");
  dot.width = dot.height = 64;
  const g = dot.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const dataTex = new Texture(dot.toDataURL("image/png"), scene);
  const blob = await new Promise((r) => dot.toBlob(r, "image/png"));
  const blobTex = new Texture(URL.createObjectURL(blob), scene, { forcedExtension: ".png" });

  const ball = MeshBuilder.CreateSphere("ball", { diameter: 2 }, scene);
  ball.position.set(-3, 1, 0);
  const ballMat = mat("#ffcc33");
  ballMat.diffuseTexture = raw;
  ballMat.emissiveColor = new Color3(0.6, 0.45, 0.1); // glow layer picks this up
  ball.material = ballMat;
  shadows.addShadowCaster(ball);

  // Particles textured from a blob: URL.
  const ps = new ParticleSystem("sparkles", 300, scene);
  ps.particleTexture = blobTex;
  ps.emitter = new Vector3(3, 1, 0);
  ps.minSize = 0.1;
  ps.maxSize = 0.35;
  ps.emitRate = 80;
  ps.createPointEmitter(new Vector3(-1, 3, -1), new Vector3(1, 5, 1));
  ps.start();

  const quad = MeshBuilder.CreatePlane("dataQuad", { size: 2 }, scene);
  quad.position.set(0, 1.5, -4);
  const quadMat = new StandardMaterial("quadMat", scene);
  quadMat.diffuseTexture = dataTex;
  quad.material = quadMat;

  // Post-processing: glow, bloom + FXAA, SSAO2.
  new GlowLayer("glow", scene, { mainTextureSamples: 2 });
  const pipeline = new DefaultRenderingPipeline("default", true, scene, [camera]);
  pipeline.bloomEnabled = true;
  pipeline.fxaaEnabled = true;
  if (engine.webGLVersion >= 2) new SSAO2RenderingPipeline("ssao", scene, 0.5, [camera]);

  // WebAudio synthesis (no network), as the audio module does.
  let audioState = "unavailable";
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
    audioState = ctx.state;
  } catch (err) {
    console.warn("audio probe skipped:", err.message);
  }

  await scene.whenReadyAsync();
  let frames = 0;
  engine.runRenderLoop(() => {
    scene.render();
    if (++frames === 3) {
      const checks = {
        webgl: engine.webGLVersion,
        dataTexture: dataTex.isReady(),
        blobTexture: blobTex.isReady(),
        rawTexture: raw.isReady(),
        font: document.fonts.check("700 64px Fredoka"),
        audio: audioState,
      };
      const ok = violations.length === 0 && checks.dataTexture && checks.blobTexture && checks.font;
      report.textContent = `${ok ? "CSP probe OK" : "CSP probe FAILED"} - ${violations.length} violation(s) ${JSON.stringify(checks)}`;
      (ok ? console.log : console.error)(report.textContent);
    }
  });
  window.addEventListener("resize", () => engine.resize());
}

main().catch((err) => console.error("CSP probe failed:", err));
