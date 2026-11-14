const params = new URLSearchParams(window.location.search);
const companyCode = params.get("entreprise") || "";
const ticketToken = params.get("billet");
const form = document.querySelector("#public-booking-form");
const select = document.querySelector("#public-departure");
const message = document.querySelector("#public-message");
const ticketPanel = document.querySelector("#public-ticket");
let companyName = "";

function money(value) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(value) || 0) + " FCFA";
}
function showMessage(value, error = false) {
  message.textContent = value;
  message.classList.toggle("public-error", error);
}
function displayTicket(ticket) {
  document.querySelector("#public-title").textContent = "Réservation enregistrée";
  document.querySelector(".public-subtitle").textContent = "Conservez ce billet. Présentez-le à votre compagnie pour effectuer le règlement avant l'embarquement.";
  form.hidden = true;
  document.querySelector("#public-ticket-company").textContent = ticket.companyName;
  document.querySelector("#public-ticket-route").textContent = ticket.origin + " → " + ticket.destination + " · " +
    new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" }).format(new Date(ticket.departureAt));
  document.querySelector("#public-ticket-passenger").textContent = "Passager : " + ticket.passengerName;
  document.querySelector("#public-ticket-seat").textContent = "Siège : " + (ticket.seatNumber || "À attribuer");
  document.querySelector("#public-ticket-amount").textContent = "Montant : " + money(ticket.totalAmount);
  document.querySelector("#public-ticket-payment").textContent = ticket.paymentStatus === "CONFIRMED"
    ? "Paiement confirmé" : "Paiement en attente — embarquement non autorisé";
  document.querySelector("#public-ticket-qr").src = ticket.qrCode;
  document.querySelector("#public-ticket-reference").textContent = "Référence : " + ticket.bookingId;
  ticketPanel.hidden = false;
}
async function loadTicket() {
  const response = await fetch(`/api/public/${encodeURIComponent(companyCode)}/ticket/${encodeURIComponent(ticketToken)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Billet introuvable.");
  displayTicket(result.data);
}
async function loadDepartures() {
  const response = await fetch(`/api/public/${encodeURIComponent(companyCode)}/departs`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Impossible de charger les départs.");
  companyName = result.data.companyName || "Votre compagnie";
  document.querySelector("#public-title").textContent = "Réserver avec " + companyName;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choisissez un départ";
  select.append(placeholder);
  for (const departure of result.data.departures) {
    const option = document.createElement("option");
    option.value = departure.id;
    option.textContent = departure.origin + " → " + departure.destination + " · " +
      new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(departure.departureAt)) +
      " · " + money(departure.fareAmount);
    select.append(option);
  }
  if (!result.data.departures.length) showMessage("Aucun départ ouvert à la réservation pour le moment.");
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#public-submit");
  submit.disabled = true;
  showMessage("Enregistrement de votre réservation…");
  try {
    const values = Object.fromEntries(new FormData(form).entries());
    const response = await fetch(`/api/public/${encodeURIComponent(companyCode)}/reservations`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "La réservation n'a pas pu être enregistrée.");
    const ticket = result.data;
    history.replaceState(null, "", `?entreprise=${encodeURIComponent(companyCode)}&billet=${encodeURIComponent(ticket.ticketToken)}`);
    displayTicket(ticket);
    showMessage(result.message);
  } catch (error) { showMessage(error.message || "Une erreur est survenue.", true); }
  finally { submit.disabled = false; }
});
document.querySelector("#public-print").addEventListener("click", () => window.print());
(async () => {
  if (!/^[a-f0-9]{32}$/i.test(companyCode)) {
    form.hidden = true;
    showMessage("Le lien de réservation de cette compagnie est invalide.", true);
    return;
  }
  try {
    if (ticketToken) await loadTicket();
    else await loadDepartures();
  } catch (error) {
    form.hidden = true;
    showMessage(error.message || "Impossible de charger cette page.", true);
  }
})();
