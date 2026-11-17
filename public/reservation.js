const params = new URLSearchParams(window.location.search);
const companyCode = params.get("entreprise") || "";
const ticketToken = params.get("billet");
const requestedDepartureId = params.get("departureId") || "";
const requestedOriginStopId = params.get("originStopId") || "";
const requestedDestinationStopId = params.get("destinationStopId") || "";
const publicApiBase = "/api/v1/public";
const form = document.querySelector("#public-booking-form");
const select = document.querySelector("#public-departure");
const message = document.querySelector("#public-message");
const ticketPanel = document.querySelector("#public-ticket");
let companyName = "";
let publicDepartures = [];
let boardingPolicy = null;
let selectedSeatNumber = null;
let currentPublicSeats = [];
let currentFareAmount = null;
let currentCompanyFee = 0;
let currentPlatformFee = 100;
const policyAccepted = document.querySelector("#public-policy-accepted");

function money(value) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(value) || 0) + " FCFA";
}
function showMessage(value, error = false) {
  message.textContent = value;
  message.classList.toggle("public-error", error);
}
function setStage(stage) {
  currentStage = stage;
  document.querySelectorAll("[data-stage]").forEach(section => {
    section.hidden = Number(section.dataset.stage) !== stage;
  });
  document.querySelectorAll("[data-progress]").forEach(item => {
    const number = Number(item.dataset.progress);
    item.toggleAttribute("aria-current", number === stage);
    if (number === stage) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
    item.classList.toggle("is-done", number < stage);
  });
  if (stage === 3) updateConfirmationSummary();
  showMessage("");
  const heading = document.querySelector('[data-stage="' + stage + '"] h2');
  heading?.setAttribute("tabindex", "-1");
  heading?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function updateTripSummary() {
  const departure = selectedDeparture();
  const panel = document.querySelector("#public-trip-summary");
  if (!departure) {
    panel.hidden = true;
    document.querySelector("#public-next-1").disabled = true;
    return;
  }
  const originStop = departure.routeStops?.length
    ? departure.routeStops.find(stop => stop.id === document.querySelector("#public-origin-stop").value)
    : null;
  const destinationStop = departure.routeStops?.length
    ? departure.routeStops.find(stop => stop.id === document.querySelector("#public-destination-stop").value)
    : null;
  const origin = originStop?.city || departure.origin;
  const destination = destinationStop?.city || departure.destination;
  const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" }).format(new Date(departure.departureAt));
  const hasCompleteSegment = !departure.routeStops?.length || (originStop && destinationStop);
  const total = currentFareAmount !== null
    ? currentFareAmount + currentCompanyFee + currentPlatformFee
    : (Number(departure.fareAmount) || 0) + (Number(departure.companyBookingFee) || 0) + 100;
  document.querySelector("#public-summary-route").textContent = origin + " → " + destination;
  document.querySelector("#public-summary-time").textContent = date;
  document.querySelector("#public-summary-price").textContent = hasCompleteSegment ? money(total) : "Choisissez votre arrivée";
  panel.hidden = false;
  const hasSegment = !departure.routeStops?.length || (originStop && destinationStop);
  document.querySelector("#public-next-1").disabled = !hasSegment;
}
function updateConfirmationSummary() {
  const departure = selectedDeparture();
  if (!departure) return;
  const originStop = departure.routeStops?.find(stop => stop.id === document.querySelector("#public-origin-stop").value);
  const destinationStop = departure.routeStops?.find(stop => stop.id === document.querySelector("#public-destination-stop").value);
  document.querySelector("#public-confirm-route").textContent =
    (originStop?.city || departure.origin) + " → " + (destinationStop?.city || departure.destination);
  const manual = selectedSeatMode() === "manual" && selectedSeatNumber;
  document.querySelector("#public-confirm-seat").textContent = manual ? "Place " + selectedSeatNumber : "Attribuée automatiquement";
  const total = currentFareAmount !== null
    ? currentFareAmount + currentCompanyFee + currentPlatformFee
    : (Number(departure.fareAmount) || 0) + (Number(departure.companyBookingFee) || 0) + 100;
  document.querySelector("#public-confirm-price").textContent = money(total);
}
function displayTicket(ticket) {
  const isHold = ticket.bookingStatus === "HELD";
  document.querySelector("#public-title").textContent = isHold ? "Votre place est bloquée temporairement" : "Réservation enregistrée";
  document.querySelector("#public-subtitle").textContent = isHold
    ? "Vous avez 15 minutes pour finaliser le paiement auprès de la compagnie. Après ce délai, la place sera automatiquement remise à disposition."
    : "Conservez cette confirmation. L'embarquement est autorisé uniquement après confirmation du paiement.";
  form.hidden = true;
  document.querySelector("#public-progress").hidden = true;
  document.querySelector("#public-audio").hidden = true;
  document.querySelector("#public-ticket-company").textContent = ticket.companyName;
  document.querySelector("#public-ticket-route").textContent = ticket.origin + " → " + ticket.destination + " · " +
    new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" }).format(new Date(ticket.departureAt));
  document.querySelector("#public-ticket-passenger").textContent = "Passager : " + ticket.passengerName;
  document.querySelector("#public-ticket-seat").textContent = "Siège : " + (ticket.seatNumber || "À attribuer");
  document.querySelector("#public-ticket-amount").textContent = "Transport : " + money(ticket.transportAmount) + " · Frais compagnie : " + money(ticket.companyBookingFee) + " · Frais TRANSORA : " + money(ticket.platformFee) + " · Total : " + money(ticket.totalAmount);
  const expiresAt = ticket.holdExpiresAt ? new Date(ticket.holdExpiresAt) : null;
  document.querySelector("#public-ticket-payment").textContent = isHold && expiresAt
    ? "Place réservée jusqu'au " + new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(expiresAt) + ". Ce n'est pas encore un billet payé."
    : ticket.paymentStatus === "CONFIRMED"
      ? "Paiement confirmé."
      : "Paiement en attente — embarquement non autorisé.";
  const qr = document.querySelector("#public-ticket-qr");
  qr.hidden = !ticket.qrCode;
  if (ticket.qrCode) qr.src = ticket.qrCode;
  document.querySelector("#public-ticket-reference").textContent = "Référence : " + ticket.bookingId;
  ticketPanel.hidden = false;
}
function fillStopSelect(selectElement, stops, placeholder) {
  selectElement.replaceChildren();
  const option = document.createElement("option");
  option.value = "";
  option.textContent = placeholder;
  selectElement.append(option);
  stops.forEach((stop) => {
    const item = document.createElement("option");
    item.value = stop.id;
    item.textContent = stop.city + (stop.station ? " · " + stop.station : "");
    selectElement.append(item);
  });
}
function selectedDeparture() {
  return publicDepartures.find((departure) => departure.id === select.value);
}
function updateDestinationStops() {
  const departure = selectedDeparture();
  const originId = document.querySelector("#public-origin-stop").value;
  const stops = departure?.routeStops || [];
  const originIndex = stops.findIndex((stop) => stop.id === originId);
  const destinationStops = originIndex >= 0 ? stops.slice(originIndex + 1) : [];
  fillStopSelect(document.querySelector("#public-destination-stop"), destinationStops, "Choisissez votre arrivée");
  document.querySelector("#public-destination-wrap").hidden = !stops.length;
  selectedSeatNumber = null;
  currentPublicSeats = [];
  currentFareAmount = null;
  currentCompanyFee = 0;
  renderPublicSeats([]);
  document.querySelector("#public-seat-availability").textContent = "";
  updateTripSummary();
  updatePublicSubmitState();
}
function selectedSeatMode() {
  return document.querySelector('input[name="seatMode"]:checked')?.value || "auto";
}
function renderPublicSeats(seats) {
  const wrap = document.querySelector("#public-seats-wrap");
  const grid = document.querySelector("#public-seats");
  const legend = document.querySelector(".public-seat-legend");
  grid.replaceChildren();
  if (!Array.isArray(seats) || seats.length === 0) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  grid.hidden = selectedSeatMode() !== "manual";
  legend.hidden = selectedSeatMode() !== "manual";
  seats.forEach((seat, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "public-seat";
    button.textContent = String(seat.number);
    button.disabled = !seat.available;
    button.style.gridColumn = String([1, 2, 4, 5][index % 4]);
    button.style.gridRow = String(Math.floor(index / 4) + 1);
    button.classList.toggle("is-selected", seat.number === selectedSeatNumber);
    button.setAttribute("aria-pressed", String(seat.number === selectedSeatNumber));
    button.setAttribute("aria-label", "Place " + seat.number + ", " + (seat.available ? "libre" : "déjà prise"));
    button.title = seat.available ? "Place " + seat.number + " disponible" : "Place " + seat.number + " déjà prise";
    button.addEventListener("click", () => {
      selectedSeatNumber = seat.number;
      renderPublicSeats(currentPublicSeats);
      updatePublicSubmitState();
      updateConfirmationSummary();
    });
    grid.append(button);
  });
}
function updatePublicSubmitState() {
  const departure = selectedDeparture();
  const hasSegment = !departure?.routeStops?.length
    || (document.querySelector("#public-origin-stop").value && document.querySelector("#public-destination-stop").value);
  const hasAvailableSeat = currentPublicSeats.some(seat => seat.available);
  const manualSeatIsAvailable = currentPublicSeats.some(seat => seat.number === selectedSeatNumber && seat.available);
  const seatIsValid = selectedSeatMode() === "auto" ? hasAvailableSeat : manualSeatIsAvailable;
  document.querySelector("#public-next-1").disabled = !departure || !hasSegment;
  document.querySelector("#public-next-2").disabled = !seatIsValid;
  document.querySelector("#public-submit").disabled = !seatIsValid || !policyAccepted.checked;
  updateTripSummary();
}
async function refreshPublicSeatAvailability() {
  const departure = selectedDeparture();
  const originId = document.querySelector("#public-origin-stop").value;
  const destinationId = document.querySelector("#public-destination-stop").value;
  const target = document.querySelector("#public-seat-availability");
  if (!departure) {
    selectedSeatNumber = null;
    currentPublicSeats = [];
    renderPublicSeats([]);
    target.textContent = "";
    updatePublicSubmitState();
    return;
  }
  if (departure.routeStops?.length && (!originId || !destinationId)) {
    selectedSeatNumber = null;
    currentPublicSeats = [];
    renderPublicSeats([]);
    target.textContent = "Choisissez votre ville de départ et d'arrivée pour voir les places.";
    updatePublicSubmitState();
    return;
  }
  target.textContent = "Nous vérifions les places disponibles…";
  document.querySelector("#public-next-2").disabled = true;
  document.querySelector("#public-submit").disabled = true;
  try {
    const query = new URLSearchParams();
    if (departure.routeStops?.length) {
      query.set("originStopId", originId);
      query.set("destinationStopId", destinationId);
    }
    const suffix = query.toString() ? "?" + query.toString() : "";
    const response = await fetch(publicApiBase + "/" + encodeURIComponent(companyCode) + "/departs/" + encodeURIComponent(departure.id) + "/places" + suffix);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de vérifier les places.");
    currentPublicSeats = result.data.seats || [];
    currentFareAmount = Number(result.data.fareAmount) || 0;
    currentCompanyFee = Number(result.data.companyBookingFee) || 0;
    currentPlatformFee = Number(result.data.platformFee ?? 100);
    selectedSeatNumber = null;
    document.querySelector('input[name="seatMode"][value="auto"]').checked = true;
    renderPublicSeats(currentPublicSeats);
    target.textContent = result.data.availableCount + " place(s) libre(s). Le choix automatique est sélectionné par défaut. " +
      money(currentFareAmount + currentCompanyFee + currentPlatformFee) + " au total.";
    updateTripSummary();
    updatePublicSubmitState();
  } catch (error) {
    selectedSeatNumber = null;
    currentPublicSeats = [];
    currentFareAmount = null;
    currentCompanyFee = 0;
    renderPublicSeats([]);
    target.textContent = error.message || "Vérification des places impossible.";
    updatePublicSubmitState();
  }
}
function configurePublicStops() {
  const departure = selectedDeparture();
  const originWrap = document.querySelector("#public-origin-wrap");
  const destinationWrap = document.querySelector("#public-destination-wrap");
  const originSelect = document.querySelector("#public-origin-stop");
  const destinationSelect = document.querySelector("#public-destination-stop");
  const stops = departure?.routeStops || [];
  selectedSeatNumber = null;
  currentPublicSeats = [];
  currentFareAmount = null;
  currentCompanyFee = 0;
  renderPublicSeats([]);
  document.querySelector("#public-next-2").disabled = true;
  originWrap.hidden = !stops.length;
  destinationWrap.hidden = !stops.length;
  originSelect.disabled = !stops.length;
  destinationSelect.disabled = !stops.length;
  if (!stops.length) {
    originSelect.value = "";
    destinationSelect.value = "";
    updateTripSummary();
    refreshPublicSeatAvailability();
    return;
  }
  fillStopSelect(originSelect, stops.slice(0, -1), "Choisissez votre ville de départ");
  fillStopSelect(destinationSelect, [], "Choisissez d'abord votre départ");
  document.querySelector("#public-seat-availability").textContent = "Choisissez votre ville de départ et d'arrivée.";
  updateTripSummary();
}
async function loadTicket() {
  const response = await fetch(`${publicApiBase}/${encodeURIComponent(companyCode)}/ticket/${encodeURIComponent(ticketToken)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Billet introuvable.");
  displayTicket(result.data);
}
async function loadDepartures() {
  const response = await fetch(`${publicApiBase}/${encodeURIComponent(companyCode)}/departs`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Impossible de charger les départs.");
  companyName = result.data.companyName || "Votre compagnie";
  document.querySelector("#public-title").textContent = "Voyagez avec " + companyName;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choisissez votre départ";
  select.append(placeholder);
  publicDepartures = result.data.departures;
  boardingPolicy = result.data.boardingPolicy || null;
  const policySummary = document.querySelector("#public-policy-summary");
  if (boardingPolicy) {
    const refund = boardingPolicy.refundPolicy === "FULL" ? "Remboursement intégral prévu après absence." : boardingPolicy.refundPolicy === "PARTIAL" ? "Remboursement de " + boardingPolicy.refundPercentage + "% prévu après absence." : "Aucun remboursement n’est prévu après absence selon cette politique.";
    const rebooking = boardingPolicy.allowRebookingAfterNoShow ? "Report possible jusqu’à " + boardingPolicy.maxRebookings + " fois" + (Number(boardingPolicy.rebookingFeeAmount) ? " avec des frais de " + money(boardingPolicy.rebookingFeeAmount) + "." : " sans frais.") : "Aucun report n’est prévu après absence.";
    policySummary.textContent = "L’embarquement ouvre " + boardingPolicy.boardingOpenMinutesBefore + " minutes avant le départ. Présentez-vous au plus tard " + boardingPolicy.boardingDeadlineMinutesBefore + " minutes avant l’heure prévue. Délai de grâce : " + boardingPolicy.gracePeriodMinutes + " minutes. " + rebooking + " " + refund;
  } else policySummary.textContent = "Les conditions d’embarquement seront communiquées par la compagnie.";
  for (const departure of publicDepartures) {
    const option = document.createElement("option");
    option.value = departure.id;
    const departureDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(departure.departureAt));
    const price = money((Number(departure.fareAmount) || 0) + (Number(departure.companyBookingFee) || 0) + 100);
    option.textContent = departure.origin + " → " + departure.destination + " · " + departureDate + " · " + price;
    select.append(option);
  }
  if (!publicDepartures.length) {
    showMessage("Aucun départ n'est ouvert à la réservation pour le moment. Contactez directement la compagnie.");
    configurePublicStops();
    return;
  }
  if (requestedDepartureId) {
    const requestedDeparture = publicDepartures.find(departure => departure.id === requestedDepartureId);
    if (!requestedDeparture) {
      configurePublicStops();
      showMessage("Le départ choisi depuis la plateforme partenaire n'est plus disponible. Choisissez un autre voyage.", true);
      return;
    }
    select.value = requestedDeparture.id;
    configurePublicStops();
    if (requestedDeparture.routeStops?.length) {
      const originSelect = document.querySelector("#public-origin-stop");
      const validOrigin = requestedDeparture.routeStops.slice(0, -1).some(stop => stop.id === requestedOriginStopId);
      if (requestedOriginStopId && validOrigin) {
        originSelect.value = requestedOriginStopId;
        updateDestinationStops();
        const destinationSelect = document.querySelector("#public-destination-stop");
        const validDestination = Array.from(destinationSelect.options).some(option => option.value === requestedDestinationStopId && option.value);
        if (requestedDestinationStopId && validDestination) {
          destinationSelect.value = requestedDestinationStopId;
          updateTripSummary();
          await refreshPublicSeatAvailability();
        } else if (requestedDestinationStopId) {
          showMessage("La destination choisie n'est plus disponible sur ce départ. Vérifiez votre trajet.", true);
        }
      } else if (requestedOriginStopId) {
        showMessage("Le point de départ choisi n'est plus disponible. Choisissez votre gare de départ.", true);
      }
    } else {
      updateTripSummary();
      await refreshPublicSeatAvailability();
    }
  } else {
    configurePublicStops();
  }
}
select.addEventListener("change", configurePublicStops);
document.querySelector("#public-origin-stop").addEventListener("change", () => {
  updateDestinationStops();
  updateTripSummary();
});
document.querySelector("#public-destination-stop").addEventListener("change", async () => {
  updateTripSummary();
  await refreshPublicSeatAvailability();
});
document.querySelector("#public-next-1").addEventListener("click", () => {
  const departure = selectedDeparture();
  const hasSegment = !departure?.routeStops?.length
    || (document.querySelector("#public-origin-stop").value && document.querySelector("#public-destination-stop").value);
  if (!departure || !hasSegment) {
    showMessage("Choisissez votre voyage, votre ville de départ et votre destination.", true);
    return;
  }
  if (!currentPublicSeats.length) refreshPublicSeatAvailability();
  setStage(2);
});
document.querySelector("#public-next-2").addEventListener("click", () => {
  updateConfirmationSummary();
  setStage(3);
});
document.querySelector("#public-back-2").addEventListener("click", () => setStage(1));
document.querySelector("#public-back-3").addEventListener("click", () => setStage(2));
policyAccepted.addEventListener("change", updatePublicSubmitState);
document.querySelectorAll('input[name="seatMode"]').forEach(input => input.addEventListener("change", () => {
  if (selectedSeatMode() === "auto") selectedSeatNumber = null;
  renderPublicSeats(currentPublicSeats);
  updatePublicSubmitState();
  updateConfirmationSummary();
}));
document.querySelector("#public-audio").addEventListener("click", () => {
  if (!("speechSynthesis" in window)) {
    showMessage("La lecture audio n'est pas disponible sur ce téléphone.", true);
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(
    "Pour réserver, choisissez votre voyage. Ensuite, choisissez votre place ou laissez-nous choisir pour vous. Enfin, indiquez votre nom et votre numéro de téléphone, puis confirmez."
  );
  utterance.lang = "fr-FR";
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const submit = document.querySelector("#public-submit");
  submit.disabled = true;
  showMessage("Nous enregistrons votre réservation. Ne fermez pas cette page…");
  try {
    const values = Object.fromEntries(new FormData(form).entries());
    values.policyAccepted = policyAccepted.checked;
    if (selectedSeatMode() === "manual") values.seatNumber = selectedSeatNumber;
    else delete values.seatNumber;
    const response = await fetch(`${publicApiBase}/${encodeURIComponent(companyCode)}/reservations`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "La réservation n'a pas pu être enregistrée.");
    const ticket = result.data;
    history.replaceState(null, "", `?entreprise=${encodeURIComponent(companyCode)}&billet=${encodeURIComponent(ticket.ticketToken)}`);
    displayTicket(ticket);
    showMessage(result.message);
  } catch (error) {
    showMessage(error.message || "La réservation n'a pas pu être confirmée. Vérifiez son statut avant de recommencer.", true);
  } finally {
    submit.disabled = false;
  }
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
    else {
      await loadDepartures();
      updatePublicSubmitState();
    }
  } catch (error) {
    form.hidden = true;
    showMessage(error.message || "Impossible de charger cette page.", true);
  }
})();