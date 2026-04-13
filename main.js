import OBR from "https://esm.sh/@owlbear-rodeo/sdk";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const FIREBASE_CONFIG = {
  apiKey: "COLE_SUA_API_KEY",
  authDomain: "SEU-PROJETO.firebaseapp.com",
  projectId: "SEU-PROJETO",
  storageBucket: "SEU-PROJETO.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:exemplo"
};

let db = null;
let roomId = "sala-teste";
let selectedSheetId = null;
let sheetsCache = [];
let currentSheet = null;
let unsubSheets = null;
let unsubCurrent = null;
let saveTimer = null;

const els = {
  firebaseStatus: document.getElementById("firebaseStatus"),
  roomStatus: document.getElementById("roomStatus"),
  currentUserName: document.getElementById("currentUserName"),
  currentRole: document.getElementById("currentRole"),
  sheetList: document.getElementById("sheetList"),
  newSheetBtn: document.getElementById("newSheetBtn"),
  duplicateBtn: document.getElementById("duplicateBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  sheetTitle: document.getElementById("sheetTitle"),
  saveStatus: document.getElementById("saveStatus"),
  emptyState: document.getElementById("emptyState"),
  sheetPanel: document.getElementById("sheetPanel"),
  permList: document.getElementById("permList"),
  permName: document.getElementById("permName"),
  permMode: document.getElementById("permMode"),
  addPermBtn: document.getElementById("addPermBtn")
};

const defaults = () => ({
  identity: { name: "Nova ficha", player: "", race: "", archetype: "", background: "", faith: "" },
  attributes: { FOR: 30, DES: 30, CON: 30, TAM: 30, FE: 30, INT: 30, EDU: 30, CAR: 30 },
  derived: { hp: 6, defense: 6, initiative: 30, movement: "9 m" },
  skills: {
    visao: 25, ouvir: 20, furtividade: 20, atletismo: 20, acrobacia: 15, sobrevivencia: 10,
    esquiva: 10, vigor: 10, persuasao: 10, intimidacao: 10, intuicao: 10, investigacao: 10
  },
  notes: { feats: "", gear: "", story: "", scars: "" },
  permissions: {},
  updatedAt: null,
  createdAt: null
});

function getCurrentUser() {
  return {
    name: els.currentUserName.value.trim(),
    role: els.currentRole.value
  };
}

function isGM() {
  return getCurrentUser().role === "gm";
}

function canView(sheet) {
  if (!sheet) return false;
  if (isGM()) return true;
  const u = getCurrentUser().name;
  if (!u) return false;
  const perm = sheet.permissions?.[u];
  return perm === "view" || perm === "edit";
}

function canEdit(sheet) {
  if (!sheet) return false;
  if (isGM()) return true;
  const u = getCurrentUser().name;
  if (!u) return false;
  return sheet.permissions?.[u] === "edit";
}

function setByPath(obj, path, value) {
  const parts = path.split(".");
  let ref = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    ref[parts[i]] ??= {};
    ref = ref[parts[i]];
  }
  ref[parts.at(-1)] = value;
}

function getByPath(obj, path) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function updateVisibility() {
  const visible = currentSheet && canView(currentSheet);
  els.emptyState.classList.toggle("hidden", !!visible);
  els.sheetPanel.classList.toggle("hidden", !visible);

  document.querySelectorAll("[data-field]").forEach(el => {
    el.disabled = !canEdit(currentSheet);
  });
  els.addPermBtn.disabled = !isGM() || !currentSheet;
  els.permName.disabled = !isGM() || !currentSheet;
  els.permMode.disabled = !isGM() || !currentSheet;
  els.deleteBtn.disabled = !isGM() || !currentSheet;
  els.duplicateBtn.disabled = !currentSheet;
}

function renderList() {
  const user = getCurrentUser();
  const visibleSheets = sheetsCache.filter(s => user.role === "gm" || (user.name && (s.permissions?.[user.name] === "view" || s.permissions?.[user.name] === "edit")));
  els.sheetList.innerHTML = visibleSheets.length ? "" : '<div class="muted">Nenhuma ficha visível para você.</div>';

  visibleSheets.forEach(sheet => {
    const div = document.createElement("div");
    div.className = "sheet-item" + (sheet.id === selectedSheetId ? " active" : "");
    const perm = user.role === "gm" ? "mestre" : (sheet.permissions?.[user.name] || "sem acesso");
    div.innerHTML = `<strong>${sheet.identity?.name || 'Sem nome'}</strong><br><small>${sheet.identity?.player || 'Sem jogador'} • ${perm}</small>`;
    div.onclick = () => selectSheet(sheet.id);
    els.sheetList.appendChild(div);
  });
}

function renderSheet() {
  if (!currentSheet || !canView(currentSheet)) {
    els.sheetTitle.textContent = "Sem acesso à ficha";
    updateVisibility();
    return;
  }
  els.sheetTitle.textContent = currentSheet.identity?.name || "Ficha";
  document.querySelectorAll("[data-field]").forEach(el => {
    const val = getByPath(currentSheet, el.dataset.field);
    el.value = val ?? "";
  });
  renderPermissions();
  updateVisibility();
}

function renderPermissions() {
  els.permList.innerHTML = "";
  const entries = Object.entries(currentSheet?.permissions || {});
  if (!entries.length) {
    els.permList.innerHTML = '<div class="muted">Nenhuma permissão específica ainda.</div>';
    return;
  }
  entries.forEach(([name, mode]) => {
    const row = document.createElement("div");
    row.className = "perm-row";
    row.innerHTML = `<div>${name}</div><div><span class="badge">${mode}</span></div><div></div>`;
    if (isGM()) {
      const btn = document.createElement("button");
      btn.className = "danger";
      btn.textContent = "Remover";
      btn.onclick = async () => {
        const next = { ...(currentSheet.permissions || {}) };
        delete next[name];
        await updateDoc(doc(db, `rooms/${roomId}/sheets/${selectedSheetId}`), { permissions: next, updatedAt: serverTimestamp() });
      };
      row.lastElementChild.appendChild(btn);
    }
    els.permList.appendChild(row);
  });
}

async function createSheet(base = null) {
  if (!db) return;
  const data = base ? structuredClone(base) : defaults();
  delete data.id;
  data.createdAt = serverTimestamp();
  data.updatedAt = serverTimestamp();
  const ref = await addDoc(collection(db, `rooms/${roomId}/sheets`), data);
  selectedSheetId = ref.id;
}

async function selectSheet(id) {
  selectedSheetId = id;
  if (unsubCurrent) unsubCurrent();
  unsubCurrent = onSnapshot(doc(db, `rooms/${roomId}/sheets/${id}`), snap => {
    if (!snap.exists()) {
      currentSheet = null;
      renderSheet();
      return;
    }
    currentSheet = { id: snap.id, ...snap.data() };
    renderSheet();
  });
  renderList();
}

function queueSave(path, value, asNumber = false) {
  if (!currentSheet || !canEdit(currentSheet)) return;
  setByPath(currentSheet, path, asNumber ? Number(value || 0) : value);
  els.sheetTitle.textContent = currentSheet.identity?.name || "Ficha";
  els.saveStatus.textContent = "Alterações pendentes...";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await updateDoc(doc(db, `rooms/${roomId}/sheets/${selectedSheetId}`), {
      ...currentSheet,
      updatedAt: serverTimestamp()
    });
    els.saveStatus.textContent = "Salvo em tempo real.";
  }, 250);
}

async function initFirebase() {
  try {
    const missing = Object.values(FIREBASE_CONFIG).some(v => String(v).includes("COLE_SUA") || String(v).includes("SEU-PROJETO") || String(v).includes("000000"));
    if (missing) {
      els.firebaseStatus.textContent = "Configure o Firebase no arquivo main.js antes de usar.";
      return;
    }
    const app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
    els.firebaseStatus.innerHTML = '<span class="status-ok">Firebase conectado.</span>';
  } catch (e) {
    console.error(e);
    els.firebaseStatus.textContent = "Erro ao iniciar Firebase.";
  }
}

async function initRoom() {
  try {
    if (OBR.isAvailable) {
      roomId = await OBR.room.getId();
      els.roomStatus.innerHTML = `<span class="status-ok">Sala: ${roomId}</span>`;
    } else {
      els.roomStatus.textContent = "Fora do Owlbear: usando sala-teste.";
    }
  } catch (e) {
    els.roomStatus.textContent = "Não foi possível ler a sala. Usando sala-teste.";
  }
}

function listenSheets() {
  if (!db) return;
  if (unsubSheets) unsubSheets();
  const q = query(collection(db, `rooms/${roomId}/sheets`), orderBy("createdAt", "asc"));
  unsubSheets = onSnapshot(q, snap => {
    sheetsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
    if (!selectedSheetId && sheetsCache.length) selectSheet(sheetsCache[0].id);
  });
}

function bindUI() {
  els.newSheetBtn.onclick = async () => {
    if (!isGM()) return alert("Somente o mestre cria fichas.");
    await createSheet();
  };

  els.duplicateBtn.onclick = async () => {
    if (!currentSheet) return;
    const clone = structuredClone(currentSheet);
    clone.identity.name = `${clone.identity.name || 'Ficha'} (Cópia)`;
    await createSheet(clone);
  };

  els.deleteBtn.onclick = async () => {
    if (!currentSheet || !isGM()) return;
    if (!confirm("Excluir esta ficha?")) return;
    await deleteDoc(doc(db, `rooms/${roomId}/sheets/${selectedSheetId}`));
    selectedSheetId = null;
    currentSheet = null;
    renderSheet();
  };

  els.addPermBtn.onclick = async () => {
    if (!isGM() || !currentSheet) return;
    const name = els.permName.value.trim();
    const mode = els.permMode.value;
    if (!name) return;
    const next = { ...(currentSheet.permissions || {}), [name]: mode };
    await updateDoc(doc(db, `rooms/${roomId}/sheets/${selectedSheetId}`), { permissions: next, updatedAt: serverTimestamp() });
    els.permName.value = "";
  };

  document.querySelectorAll("[data-field]").forEach(el => {
    const numeric = el.type === "number";
    el.addEventListener("input", e => queueSave(el.dataset.field, e.target.value, numeric));
  });

  els.currentUserName.addEventListener("input", () => {
    renderList();
    renderSheet();
  });
  els.currentRole.addEventListener("change", () => {
    renderList();
    renderSheet();
  });
}

async function init() {
  bindUI();
  await initFirebase();
  await initRoom();
  listenSheets();
  renderList();
  renderSheet();
}

init();
