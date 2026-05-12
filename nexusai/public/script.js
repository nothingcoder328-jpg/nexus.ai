// public/script.js

// fullpage.js init
new fullpage('#fullpage', {
  autoScrolling: true,
  navigation: true,
  scrollingSpeed: 700,
});

// Three.js basic scene (rotating cube)
const canvas = document.getElementById('three-canvas');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio || 1);

const geometry = new THREE.BoxGeometry(1.6, 1.6, 1.6);
const material = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.4, metalness: 0.2 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// simple lighting
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(5, 10, 7.5);
scene.add(dir);

camera.position.z = 4;

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize);

function animate() {
  requestAnimationFrame(animate);
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.015;
  renderer.render(scene, camera);
}
animate();
// public/script.js (append or merge)
async function createLocusCheckpoint() {
  const resultEl = document.getElementById('checkpoint-result');
  const amountInput = document.getElementById('amount');
  const amount = Number(amountInput.value);

  resultEl.textContent = 'Creating checkpoint...';

  try {
    const resp = await fetch('/api/locus/checkpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'INR', metadata: { source: 'web' } }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      resultEl.textContent = `Error: ${data.error || 'Locus API error'}`;
      console.error('Checkpoint failed', data);
      return;
    }

    // Show success details (adjust to the actual response shape)
    resultEl.innerHTML = `Checkpoint created: <pre style="display:inline">${JSON.stringify(data, null, 2)}</pre>`;
  } catch (err) {
    console.error('Network error creating checkpoint', err);
    resultEl.textContent = 'Network error. Check console.';
  }
}

document.getElementById('create-checkpoint').addEventListener('click', createLocusCheckpoint);
