import OBR from "https://esm.sh/@owlbear-rodeo/sdk";

const statusEl = document.getElementById("status");
const btn = document.getElementById("btn");

async function init() {
  try {
    statusEl.textContent = OBR.isAvailable
      ? "SDK conectado ao Owlbear Rodeo."
      : "Página aberta fora do Owlbear Rodeo ou SDK indisponível.";

    btn.addEventListener("click", async () => {
      if (OBR.isAvailable) {
        await OBR.notification.show("Olá! A extensão hospedada no GitHub Pages está funcionando.");
      } else {
        alert("A página abriu, mas você ainda não está dentro do Owlbear.");
      }
    });
  } catch (err) {
    statusEl.textContent = "Erro ao iniciar a extensão.";
    console.error(err);
  }
}

init();
