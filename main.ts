// src/main.ts
import * as THREE from "three";
import Stats from "stats.js";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { extractWallsFromIFC } from "./ifc/ifcWallExtractor";
import type { IfcWallInfo } from "./ifc/ifcWallExtractor";


const container = document.getElementById("container") as HTMLElement;
const uploadInput = document.getElementById("ifc-upload") as HTMLInputElement;
const dropZone = document.getElementById("ifc-dropzone") as HTMLElement;
const wallsTableBody = document.querySelector(
  "#walls-table tbody"
) as HTMLTableSectionElement;

// global readiness promise
let fragmentsReadyResolve!: () => void;
const fragmentsReady = new Promise<void>((resolve) => {
  fragmentsReadyResolve = resolve;
});


// ---------- IFC upload + table logic ----------

function renderWallsTable(walls: IfcWallInfo[]) {
  wallsTableBody.innerHTML = "";

  if (!walls.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "No IfcWall elements found in this IFC file.";
    row.appendChild(cell);
    wallsTableBody.appendChild(row);
    return;
  }

  for (const wall of walls) {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = wall.name || "-";
    row.appendChild(nameCell);

    const typeCell = document.createElement("td");
    typeCell.textContent = wall.type || "-";
    row.appendChild(typeCell);

    const nlsfbCell = document.createElement("td");
    nlsfbCell.textContent = wall.nlsfb || "-";
    row.appendChild(nlsfbCell);

    wallsTableBody.appendChild(row);
  }
}

async function handleIfcFile(file: File) {
  try {
    // ---- UI feedback (existing logic)
    wallsTableBody.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = `Processing "${file.name}"...`;
    row.appendChild(cell);
    wallsTableBody.appendChild(row);

    // ---- 1. Extract walls (your existing functionality)
    const walls = await extractWallsFromIFC(file);
    renderWallsTable(walls);

    // ---- 2. Convert IFC → Fragments → Scene
    // const buffer = new Uint8Array(await file.arrayBuffer());
    await fragmentsReady; // blocks until fragments are initialized
    const buffer = new Uint8Array(await file.arrayBuffer());


    // // Clear previously loaded models (important!)
    // fragments.dispose();
    // Remove previously loaded fragment models
    for (const [id] of fragments.list) {
      fragments.list.delete(id);
    }

    await ifcLoader.load(buffer, false, file.name, {
      processData: {
        progressCallback: (progress) =>
          console.log(`IFC → Fragments: ${Math.round(progress * 100)}%`),
      },
    });

    // ---- 3. Frame camera after load
    const [model] = fragments.list.values();
    if (model) {
      await world.camera.controls.fitToSphere(model.object, true);
      fragments.core.update(true);
    }
  } catch (error) {
    console.error("Failed to process IFC file:", error);

    wallsTableBody.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent =
      "Error processing IFC file. Check console for details.";
    row.appendChild(cell);
    wallsTableBody.appendChild(row);
  }
}


function setupUploadUI() {
  if (!uploadInput || !dropZone) return;

  // Click -> open file dialog
  dropZone.addEventListener("click", () => {
    uploadInput.click();
  });

  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files?.[0];
    if (file) {
      await handleIfcFile(file);
    }
    uploadInput.value = "";
  });

  // Drag & drop
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove("dragover");
    });
  });

  dropZone.addEventListener("drop", async (event: DragEvent) => {
    const file = event.dataTransfer?.files?.[0];
    if (file && file.name.toLowerCase().endsWith(".ifc")) {
      await handleIfcFile(file);
    }
  });
}





// ---------- ThatOpen 3D world setup ----------

// Create the components system
const components = new OBC.Components();

// Get the Worlds manager
const worlds = components.get(OBC.Worlds);

// Create a world (TS generics for better type hints, optional)
const world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();

// Set up scene, renderer, camera using the fixed-size container
world.scene = new OBC.SimpleScene(components);
world.renderer = new OBC.SimpleRenderer(components, container);
world.camera = new OBC.SimpleCamera(components);

components.init();

// Setup lights, etc.
world.scene.setup();

// Slightly dark background
world.scene.three.background = new THREE.Color("#020617");



// new for ifcloader
const ifcLoader = components.get(OBC.IfcLoader);

ifcLoader.onIfcImporterInitialized.add((importer) => {
  console.log(importer.classes);
});

await ifcLoader.setup({
  autoSetWasm: false,
  wasm: {
    path: "https://unpkg.com/web-ifc@0.0.72/",
    absolute: true,
  },
});

// Load fragments worker (local copy)
const workerUrl = "/engine_fragment/worker.mjs";
const fragments = components.get(OBC.FragmentsManager);
fragments.init(workerUrl);

fragmentsReadyResolve();  // signal readiness


// Keep fragments updated with camera rest events
world.camera.controls.addEventListener("rest", () =>
  fragments.core.update(true)
);

// When a fragments model is set, attach it to the scene
fragments.list.onItemSet.add(({ value: model }) => {
  model.useCamera(world.camera.three);
  world.scene.three.add(model.object);
  fragments.core.update(true);
});


setupUploadUI();


const downloadFragments = async () => {
  // fragments.list holds all the fragments loaded
  const [model] = fragments.list.values();
  if (!model) return;
  const fragsBuffer = await model.getBuffer(false);
  const file = new File([fragsBuffer], "school_str.frag");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(link.href);
};
// end of new for ifcloader



// ---------- ThatOpen UI panel ----------

BUI.Manager.init();

const [panel, updatePanel] = BUI.Component.create<BUI.PanelSection, {}>((_) => {  // new for ifcloader
// const [panel, updatedPanel] = BUI.Component.create<BUI.PanelSection>(() => {
  let downloadBtn: BUI.TemplateResult | undefined;
  if (fragments.list.size > 0) {
    downloadBtn = BUI.html`
      <bim-button label="Download Fragments" @click=${downloadFragments}></bim-button>
    `;
  }

  return BUI.html`
    <bim-panel label="Worlds Tutorial" class="options-menu">
      <bim-panel-section label="Controls">
        
        ${downloadBtn}
        <bim-color-input 
          label="Background Color" color="#202932" 
          @input="${({ target }: { target: BUI.ColorInput }) => {
            world.scene.config.backgroundColor = new THREE.Color(target.color);
          }}">
        </bim-color-input>
        
        <bim-number-input 
          slider step="0.1" label="Directional lights intensity" value="1.5" min="0.1" max="10"
          @change="${({ target }: { target: BUI.NumberInput }) => {
            world.scene.config.directionalLight.intensity = target.value;
          }}">
        </bim-number-input>
        
        <bim-number-input 
          slider step="0.1" label="Ambient light intensity" value="1" min="0.1" max="5"
          @change="${({ target }: { target: BUI.NumberInput }) => {
            world.scene.config.ambientLight.intensity = target.value;
          }}">
        </bim-number-input>
        
      </bim-panel-section>
    </bim-panel>
  `;
// });
}, {}); // new for ifcloader

document.body.append(panel);
fragments.list.onItemSet.add(() => updatePanel());  // new for ifcloader

// Phone menu button allowing to show or hide the menu (kept from your original demo)
const button = BUI.Component.create<BUI.PanelSection>(() => {
  return BUI.html`
      <bim-button class="phone-menu-toggler" icon="solar:settings-bold"
        @click="${() => {
          if (panel.classList.contains("options-menu-visible")) {
            panel.classList.remove("options-menu-visible");
          } else {
            panel.classList.add("options-menu-visible");
          }
        }}">
      </bim-button>
    `;
});

document.body.append(button);

// ---------- Stats.js performance panel ----------

const stats = new Stats();
stats.showPanel(2);
document.body.append(stats.dom);
stats.dom.style.left = "0px";
stats.dom.style.zIndex = "unset";

world.renderer.onBeforeUpdate.add(() => stats.begin());
world.renderer.onAfterUpdate.add(() => stats.end());

