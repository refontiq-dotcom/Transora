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
let matchingDepartures = [];
let currentStage = 1;
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
    const active = Number(section.dataset.stage) === stage;
    section.hidden = !active;
    if (active) {
      section.classList.remove("is-entering");
      void section.offsetWidth;
      section.classList.add("is-entering");
    } else section.classList.remove("is-entering");
  });
  const compact = document.querySelector("#public-trip-compact");
  compact.hidden = stage === 1;
  if (stage > 1) updateCompactSummary();
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
function updateCompactSummary() {
  document.querySelector("#public-compact-route").textContent = document.querySelector("#public-summary-route").textContent;
  document.querySelector("#public-compact-price").textContent = document.querySelector("#public-summary-price").textContent;
  document.querySelector("#public-compact-time").textContent = document.querySelector("#public-summary-time").textContent;
}
function normalizeCity(value) {
  return String(value || "").trim().toLocaleLowerCase("fr");
}
function cityOptionsForDepartures() {
  const cities = new Map();
  publicDepartures.forEach(departure => {
    const stops = Array.isArray(departure.routeStops) ? departure.routeStops : [];
    if (stops.length) stops.forEach(stop => {
      const key = normalizeCity(stop.city);
      if (key && !cities.has(key)) cities.set(key, stop.city);
    });
    else [departure.origin, departure.destination].forEach(city => {
      const key = normalizeCity(city);
      if (key && !cities.has(key)) cities.set(key, city);
    });
  });
  const values = [...cities.values()].sort((a,b)=>a.localeCompare(b,"fr"));
  return { origins: values, destinations: values };
}
function fillCityOptions() {
  const origin = document.querySelector("#public-city-origin");
  const destination = document.querySelector("#public-city-destination");
  const options = cityOptionsForDepartures();
  const fill = (target, values, placeholder) => {
    target.replaceChildren();
    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    target.append(first);
    values.forEach(city => {
      const option = document.createElement("option");
      option.value = city;
      option.textContent = city;
      target.append(option);
    });
  };
  fill(origin, options.origins, "Choisissez votre ville de départ");
  fill(destination, options.destinations, "Choisissez votre ville d'arrivée");
  destination.disabled = true;
}
function departureSegmentForCities(departure, originCity, destinationCity) {
  const originKey = normalizeCity(originCity);
  const destinationKey = normalizeCity(destinationCity);
  const stops = Array.isArray(departure.routeStops) ? departure.routeStops : [];
  if (!originKey || !destinationKey) return null;
  if (!stops.length) return normalizeCity(departure.origin) === originKey && normalizeCity(departure.destination) === destinationKey
    ? { originStopId: "", destinationStopId: "" } : null;
  const originIndex = stops.findIndex(stop => normalizeCity(stop.city) === originKey);
  if (originIndex < 0) return null;
  const destinationIndex = stops.findIndex((stop,index) => index > originIndex && normalizeCity(stop.city) === destinationKey);
  if (destinationIndex < 0) return null;
  return { originStopId: stops[originIndex].id, destinationStopId: stops[destinationIndex].id };
}
function handleCityPairChange(preferredDepartureId = "") {
  const originCity = document.querySelector("#public-city-origin").value;
  const destinationSelect = document.querySelector("#public-city-destination");
  destinationSelect.disabled = !originCity;
  if (!originCity) {
    destinationSelect.value = "";
    matchingDepartures = [];
    select.replaceChildren();
    select.disabled = true;
    currentFareAmount = null;
    currentPublicSeats = [];
    updateTripSummary();
    updatePublicSubmitState();
    return;
  }
  const destinationCity = destinationSelect.value;
  if (!destinationCity) {
    matchingDepartures = [];
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choisissez d'abord votre destination";
    select.append(placeholder);
    select.disabled = true;
    currentFareAmount = null;
    updateTripSummary();
    updatePublicSubmitState();
    return;
  }
  matchingDepartures = publicDepartures.filter(departure => departureSegmentForCities(departure, originCity, destinationCity));
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = matchingDepartures.length ? "Choisissez votre heure de départ" : "Aucun départ pour ce trajet";
  select.append(placeholder);
  matchingDepartures.forEach(departure => {
    const option = document.createElement("option");
    option.value = departure.id;
    const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(departure.departureAt));
    option.textContent = date + " · Départ disponible";
    select.append(option);
  });
  select.disabled = !matchingDepartures.length;
  const chosen = matchingDepartures.find(departure => departure.id === preferredDepartureId) || matchingDepartures[0];
  select.value = chosen?.id || "";
  if (chosen) configurePublicStops();
  else {
    currentFareAmount = null;
    currentPublicSeats = [];
    updateTripSummary();
    showMessage("Aucun départ disponible pour cette combinaison de villes. Essayez un autre trajet.", true);
    updatePublicSubmitState();
  }
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
  const total = currentFareAmount !== null ? currentFareAmount + currentCompanyFee + currentPlatformFee : null;
  document.querySelector("#public-summary-route").textContent = origin + " → " + destination;
  document.querySelector("#public-summary-time").textContent = date;
  document.querySelector("#public-summary-price").textContent = !hasCompleteSegment ? "Choisissez votre arrivée" : total === null ? "Calcul en cours…" : money(total);
  panel.hidden = false;
  const hasSegment = !departure.routeStops?.length || (originStop && destinationStop);
  document.querySelector("#public-next-1").disabled = !hasSegment || currentFareAmount === null;
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
  const originSelect = document.querySelector("#public-origin-stop");
  const destinationSelect = document.querySelector("#public-destination-stop");
  const originCity = document.querySelector("#public-city-origin").value;
  const destinationCity = document.querySelector("#public-city-destination").value;
  selectedSeatNumber = null;
  currentPublicSeats = [];
  currentFareAmount = null;
  currentCompanyFee = 0;
  currentPlatformFee = 100;
  renderPublicSeats([]);
  document.querySelector("#public-next-2").disabled = true;
  originSelect.replaceChildren();
  destinationSelect.replaceChildren();
  if (!departure) {
    updateTripSummary();
    updatePublicSubmitState();
    return;
  }
  const segment = departureSegmentForCities(departure, originCity, destinationCity);
  if (!segment) {
    updateTripSummary();
    updatePublicSubmitState();
    return;
  }
  if (segment.originStopId && segment.destinationStopId) {
    const stops = departure.routeStops || [];
    const originIndex = stops.findIndex(stop => stop.id === segment.originStopId);
    fillStopSelect(originSelect, stops.slice(0, -1), "Choisissez votre départ");
    originSelect.value = segment.originStopId;
    fillStopSelect(destinationSelect, stops.slice(originIndex + 1), "Choisissez votre arrivée");
    destinationSelect.value = segment.destinationStopId;
  } else {
    const originOption = document.createElement("option");
    originOption.value = "";
    originSelect.append(originOption);
    const destinationOption = document.createElement("option");
    destinationOption.value = "";
    destinationSelect.append(destinationOption);
  }
  updateTripSummary();
  refreshPublicSeatAvailability();
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
  fillCityOptions();
  if (!publicDepartures.length) {
    showMessage("Aucun départ n'est ouvert à la réservation pour le moment. Contactez directement la compagnie.");
    configurePublicStops();
    return;
  }
  if (requestedDepartureId) {
    const requestedDeparture = publicDepartures.find(departure => departure.id === requestedDepartureId);
    if (!requestedDeparture) {
      showMessage("Le départ choisi depuis la plateforme partenaire n'est plus disponible. Choisissez un autre voyage.", true);
      return;
    }
    const originStop = requestedDeparture.routeStops?.find(stop => stop.id === requestedOriginStopId);
    const destinationStop = requestedDeparture.routeStops?.find(stop => stop.id === requestedDestinationStopId);
    document.querySelector("#public-city-origin").value = originStop?.city || requestedDeparture.origin;
    document.querySelector("#public-city-destination").disabled = false;
    document.querySelector("#public-city-destination").value = destinationStop?.city || requestedDeparture.destination;
    handleCityPairChange(requestedDeparture.id);
    setStage(2);
  } else {
    select.disabled = true;
    showMessage("Choisissez votre ville de départ et votre destination pour voir les départs disponibles.");
  }
}
document.querySelector("#public-city-origin").addEventListener("change", () => {
  document.querySelector("#public-city-destination").value = "";
  handleCityPairChange();
});
document.querySelector("#public-city-destination").addEventListener("change", () => handleCityPairChange());
select.addEventListener("change", configurePublicStops);
document.querySelector("#public-edit-trip").addEventListener("click", () => setStage(1));
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
  if (!departure || !hasSegment || currentFareAmount === null) {
    showMessage("Choisissez votre ville de départ et votre destination. Nous calculons le prix avant de continuer.", true);
    return;
  }
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