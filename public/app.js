let rows = Array.from(document.querySelectorAll("#departure-rows tr"));
const globalSearch = document.querySelector("#global-search");
const emptyState = document.querySelector("#empty-state");
const toast = document.querySelector("#toast");
const loginButton = document.querySelector("#login-button");
const authDialog = document.querySelector("#auth-dialog");
const authForm = document.querySelector("#auth-form");
const authToggle = document.querySelector("#auth-toggle");
let isRegistration = false;
let toastTimer;
let voyageDepartures = [];
let selectedDeparture;
let voyageLoadError = false;
let fleetVehicles = [];
let fleetLoadError = false;
let editingVehicleId;
let payments = [];
let paymentLoadError = false;
let selectedPayment;
let reportOperations = [];
let reportLoadError = false;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function filterDepartures(value) {
  const search = value.trim().toLocaleLowerCase("fr");
  let visibleRows = 0;
  rows.forEach((row) => {
    const matches = row.textContent.toLocaleLowerCase("fr").includes(search);
    row.hidden = !matches;
    if (matches) visibleRows += 1;
  });
  const authenticated = Boolean(localStorage.getItem("transora_token"));
  const table = document.querySelector("#overview-departures-table");
  const message = document.querySelector("#overview-departures-message");
  table.hidden = !authenticated;
  emptyState.hidden = !authenticated || visibleRows !== 0;
  message.hidden = authenticated;
}

function updateActivity(activity) {
  const groups = Array.from(document.querySelectorAll(".bar-group"));
  const period = Number(document.querySelector("#period-select").value);
  const bucketCount = Math.min(groups.length, activity.length);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = Math.floor(index * activity.length / bucketCount);
    const end = Math.floor((index + 1) * activity.length / bucketCount);
    const values = activity.slice(start, end);
    return {
      firstDay: values[0]?.day,
      lastDay: values.at(-1)?.day,
      departures: values.reduce((total, item) => total + item.departures, 0),
      bookings: values.reduce((total, item) => total + item.bookings, 0)
    };
  });
  const maxValue = Math.max(0, ...buckets.flatMap((item) => [item.departures, item.bookings]));
  const scaleMax = Math.max(1, maxValue);
  const axisStep = Math.ceil(maxValue / 4);
  const yAxis = document.querySelector(".y-axis");
  yAxis.replaceChildren(...Array.from({ length: 5 }, (_, index) => {
    const label = document.createElement("span");
    label.textContent = String(axisStep * (4 - index));
    return label;
  }));
  const points = [];

  groups.forEach((group, index) => {
    const item = buckets[index];
    const bars = group.querySelectorAll("i");
    if (!item) {
      bars[0].style.height = "0%";
      bars[1].style.height = "0%";
      group.querySelector("span").textContent = "";
      group.setAttribute("aria-label", "Aucune donnée");
      return;
    }

    bars[0].style.height = `${item.departures ? Math.max(3, (item.departures / scaleMax) * 90) : 0}%`;
    bars[1].style.height = `${item.bookings ? Math.max(3, (item.bookings / scaleMax) * 90) : 0}%`;
    const firstDate = new Date(`${item.firstDay}T12:00:00`);
    const lastDate = new Date(`${item.lastDay}T12:00:00`);
    const label = period === 7
      ? new Intl.DateTimeFormat("fr-FR", { weekday: "short" }).format(firstDate)
      : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(firstDate);
    group.querySelector("span").textContent = label;
    group.setAttribute("aria-label", `${firstDate.toLocaleDateString("fr-FR")} au ${lastDate.toLocaleDateString("fr-FR")} : ${item.departures} départs, ${item.bookings} réservations payées`);
    const x = 48 + index * (604 / Math.max(1, buckets.length - 1));
    const y = 145 - (item.bookings / scaleMax) * 120;
    points.push(`${index === 0 ? "M" : "L"}${x} ${y}`);
  });

  const line = document.querySelector(".line-stroke");
  const fill = document.querySelector(".line-fill");
  const path = points.join(" ");
  if (points.length) {
    line.setAttribute("d", path);
    fill.setAttribute("d", `${path} L652 170 L48 170 Z`);
  } else {
    line.setAttribute("d", "");
    fill.setAttribute("d", "");
  }
  document.querySelector("#overview-chart-insight").textContent = activity.length
    ? `${period} derniers jours · ${buckets.reduce((total, item) => total + item.departures, 0)} départs et ${buckets.reduce((total, item) => total + item.bookings, 0)} réservations payées`
    : "Aucune donnée sur cette période.";
}

function renderDepartures(departures) {
  const body = document.querySelector("#departure-rows");
  body.replaceChildren();

  const statusLabels = {
    SCHEDULED: ["À l'heure", "ready"],
    BOARDING: ["Embarquement", "boarding"],
    DEPARTED: ["Parti", "ready"],
    CANCELLED: ["Annulé", "delayed"]
  };
  const routeClasses = ["route-marker", "route-marker marker-gold", "route-marker marker-blue", "route-marker marker-purple"];
  const timeFormatter = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

  departures.forEach((departure, index) => {
    const row = document.createElement("tr");
    const routeCell = document.createElement("td");
    const route = document.createElement("span");
    route.className = "route-name";
    const marker = document.createElement("span");
    marker.className = routeClasses[index % routeClasses.length];
    marker.textContent = departure.origin.slice(0, 1).toUpperCase();
    const routeText = document.createElement("span");
    const routeName = document.createElement("strong");
    routeName.append(
      document.createTextNode(departure.origin),
      document.createTextNode(" → "),
      document.createTextNode(departure.destination)
    );
    const routeDescription = document.createElement("small");
    routeDescription.textContent = `Capacité · ${departure.capacity} places`;
    routeText.append(routeName, routeDescription);
    route.append(marker, routeText);
    routeCell.append(route);

    const departureCell = document.createElement("td");
    const departureTime = document.createElement("strong");
    departureTime.textContent = timeFormatter.format(new Date(departure.departureAt));
    const departureDate = document.createElement("small");
    departureDate.className = "muted-cell";
    departureDate.textContent = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(new Date(departure.departureAt));
    departureCell.append(departureTime, departureDate);

    const vehicleCell = document.createElement("td");
    const vehicle = document.createElement("span");
    vehicle.className = "vehicle-code";
    vehicle.textContent = departure.vehicleCode;
    vehicleCell.append(vehicle);

    const occupancyCell = document.createElement("td");
    const occupancy = document.createElement("span");
    occupancy.className = "capacity-cell";
    const track = document.createElement("span");
    track.className = "capacity-track";
    const progress = document.createElement("i");
    progress.style.width = `${Math.min(100, departure.occupancyRate)}%`;
    track.append(progress);
    const percentage = document.createElement("strong");
    percentage.textContent = `${departure.occupancyRate}%`;
    occupancy.append(track, percentage);
    occupancyCell.append(occupancy);

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    const [statusText, statusClass] = statusLabels[departure.status] || ["À confirmer", "boarding"];
    status.className = `pill ${statusClass}`;
    status.textContent = statusText;
    statusCell.append(status);

    row.append(routeCell, departureCell, vehicleCell, occupancyCell, statusCell);
    body.append(row);
  });

  rows = Array.from(body.querySelectorAll("tr"));
  filterDepartures(globalSearch.value);
}

function setAuthenticatedState(authenticated) {
  loginButton.lastChild.textContent = authenticated
    ? " Données en direct · Déconnexion"
    : " Mode démonstration · Connexion";
  loginButton.querySelector("span").style.background = authenticated ? "#55b968" : "#e6ad58";
}

function applyDashboard(data) {
  const { metrics, departures, activity } = data;
  const formatInteger = (value) => new Intl.NumberFormat("fr-FR").format(value);
  document.querySelector("#metric-departures").textContent = formatInteger(metrics.departuresToday);
  document.querySelector("#metric-passengers").textContent = formatInteger(metrics.passengersToday);
  document.querySelector("#passenger-metric-label").textContent = "Passagers transportés";
  document.querySelector("#passenger-metric-foot").textContent = "Réservations payées";
  document.querySelector("#metric-revenue").textContent = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(metrics.revenueTodayFcfa / 1_000_000);
  document.querySelector("#metric-occupancy").textContent = String(metrics.occupancyRate);
  document.querySelector("#metric-seats-reserved").textContent = formatInteger(metrics.reservedSeatsToday);
  document.querySelector("#metric-seats-available").textContent = formatInteger(metrics.availableSeatsToday);
  document.querySelector("#metric-vehicles").textContent = formatInteger(metrics.activeVehicles);
  document.querySelector(".donut-value").style.strokeDasharray =
    `${(402 * Math.min(100, metrics.occupancyRate)) / 100} 402`;
  document.querySelector(".donut").setAttribute(
    "aria-label",
    `Occupation des départs sélectionnés : ${metrics.occupancyRate} pour cent`
  );
  document.querySelector("#dashboard-date").value = data.selectedDate;
  document.querySelector("#overview-data-status").textContent =
    `Données du ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(`${data.selectedDate}T12:00:00`))}`;
  updateActivity(activity);
  renderDepartures(departures);
  document.body.classList.add("live-data");
  document.querySelector("#occupancy-note-text").textContent =
    `${formatInteger(metrics.reservedSeatsToday)} places réservées sur ${formatInteger(metrics.capacityToday)} pour les départs de la journée.`;
  document.querySelector(".network-heading p").textContent = "APERÇU ILLUSTRATIF";
  document.querySelector(".live-pill").textContent = "Aperçu";
  document.querySelector(".network-footer").textContent = "La carte réseau sera connectée dans une prochaine étape.";
  if (data.tenant?.name) {
    document.querySelector(".workspace-copy strong").textContent = data.tenant.name;
    document.querySelector(".breadcrumbs").firstChild.textContent = data.tenant.name;
  }
  const savedUser = localStorage.getItem("transora_user");
  if (savedUser) {
    try {
      const user = JSON.parse(savedUser);
      if (user.name) {
        document.querySelector(".profile-copy strong").textContent = user.name;
        document.querySelector("h1").firstChild.textContent = `Bonjour, ${user.name.split(" ")[0]} `;
      }
    } catch {
      localStorage.removeItem("transora_user");
    }
  }
  setAuthenticatedState(true);
}

async function loadDashboard() {
  const token = localStorage.getItem("transora_token");
  const refresh = document.querySelector("#dashboard-refresh");
  if (!token) {
    document.querySelector("#overview-data-status").textContent = "Connectez-vous pour charger vos données.";
    document.querySelector("#occupancy-note-text").textContent = "Les indicateurs apparaîtront après connexion.";
    document.querySelector("#metric-departures").textContent = "—";
    document.querySelector("#metric-passengers").textContent = "—";
    document.querySelector("#metric-revenue").textContent = "—";
    document.querySelector("#metric-occupancy").textContent = "—";
    document.querySelector("#metric-seats-reserved").textContent = "—";
    document.querySelector("#metric-seats-available").textContent = "—";
    document.querySelector("#metric-vehicles").textContent = "—";
    document.querySelector(".donut-value").style.strokeDasharray = "0 402";
    document.querySelector(".donut").setAttribute("aria-label", "Occupation indisponible sans connexion");
    document.querySelector("#overview-chart-insight").textContent = "Connectez-vous pour consulter l'activité.";
    updateActivity([]);
    renderDepartures([]);
    return;
  }

  refresh.disabled = true;
  document.querySelector("#overview-data-status").textContent = "Chargement des données…";
  try {
    const params = new URLSearchParams({
      date: document.querySelector("#dashboard-date").value,
      period: document.querySelector("#period-select").value
    });
    const response = await fetch(`/api/v1/dashboard?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem("transora_token");
        setAuthenticatedState(false);
      }
      throw new Error(result.message || "Impossible de charger le tableau de bord.");
    }
    applyDashboard(result.data);
    await loadVoyages();
  } catch (error) {
    document.querySelector("#overview-data-status").textContent = "Erreur de chargement des données.";
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    refresh.disabled = false;
  }
}

function renderVoyages() {
  const body = document.querySelector("#voyage-rows");
  const search = document.querySelector("#voyage-search").value.trim().toLocaleLowerCase("fr");
  const selectedDate = document.querySelector("#voyage-date").value;
  const selectedStatus = document.querySelector("#voyage-status").value;
  const statusLabels = {
    SCHEDULED: ["À l'heure", "ready"],
    BOARDING: ["Embarquement", "boarding"],
    DEPARTED: ["Parti", "ready"],
    CANCELLED: ["Annulé", "delayed"]
  };
  const routeClasses = ["route-marker", "route-marker marker-gold", "route-marker marker-blue", "route-marker marker-purple"];
  const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  const matches = voyageDepartures.filter((departure) => {
    const departureDate = new Date(departure.departureAt);
    const route = `${departure.origin} ${departure.destination} ${departure.vehicleCode}`.toLocaleLowerCase("fr");
    return route.includes(search)
      && (!selectedDate || departureDate.toLocaleDateString("en-CA") === selectedDate)
      && (!selectedStatus || departure.status === selectedStatus);
  });

  body.replaceChildren();
  matches.forEach((departure, index) => {
    const row = document.createElement("tr");
    const routeCell = document.createElement("td");
    const route = document.createElement("span");
    route.className = "route-name";
    const marker = document.createElement("span");
    marker.className = routeClasses[index % routeClasses.length];
    marker.textContent = departure.origin.slice(0, 1).toUpperCase();
    const routeText = document.createElement("span");
    const routeName = document.createElement("strong");
    routeName.textContent = `${departure.origin} → ${departure.destination}`;
    const routeDescription = document.createElement("small");
    routeDescription.textContent = `Départ · ${departure.availableSeats} place${departure.availableSeats === 1 ? "" : "s"} disponible${departure.availableSeats === 1 ? "" : "s"}`;
    routeText.append(routeName, routeDescription);
    route.append(marker, routeText);
    routeCell.append(route);

    const departureCell = document.createElement("td");
    const departureDate = document.createElement("strong");
    departureDate.textContent = dateFormatter.format(new Date(departure.departureAt));
    departureCell.append(departureDate);

    const vehicleCell = document.createElement("td");
    const vehicle = document.createElement("span");
    vehicle.className = "vehicle-code";
    vehicle.textContent = departure.vehicleCode;
    vehicleCell.append(vehicle);

    const seatsCell = document.createElement("td");
    seatsCell.textContent = `${departure.availableSeats} / ${departure.capacity}`;

    const occupancyCell = document.createElement("td");
    const occupancy = document.createElement("span");
    occupancy.className = "capacity-cell";
    const track = document.createElement("span");
    track.className = "capacity-track";
    const progress = document.createElement("i");
    progress.style.width = `${Math.min(100, departure.occupancyRate)}%`;
    track.append(progress);
    const percentage = document.createElement("strong");
    percentage.textContent = `${departure.occupancyRate}%`;
    occupancy.append(track, percentage);
    occupancyCell.append(occupancy);

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    const [statusText, statusClass] = statusLabels[departure.status] || ["À confirmer", "boarding"];
    status.className = `pill ${statusClass}`;
    status.textContent = statusText;
    statusCell.append(status);

    const optionsCell = document.createElement("td");
    const options = document.createElement("div");
    options.className = "voyage-options";
    const bookingButton = document.createElement("button");
    bookingButton.className = "voyage-action";
    bookingButton.type = "button";
    bookingButton.dataset.departureId = departure.id;
    bookingButton.textContent = "Réserver";
    bookingButton.disabled = departure.status !== "SCHEDULED"
      || departure.availableSeats < 1
      || new Date(departure.departureAt) <= new Date();
    options.append(bookingButton);
    optionsCell.append(options);

    row.append(routeCell, departureCell, vehicleCell, seatsCell, occupancyCell, statusCell, optionsCell);
    body.append(row);
  });

  const today = new Date().toLocaleDateString("en-CA");
  document.querySelector("#voyage-total").textContent = String(voyageDepartures.length);
  document.querySelector("#voyage-today").textContent = String(
    voyageDepartures.filter((departure) => new Date(departure.departureAt).toLocaleDateString("en-CA") === today).length
  );
  document.querySelector("#voyage-seats").textContent = new Intl.NumberFormat("fr-FR").format(
    voyageDepartures.reduce((total, departure) => total + departure.availableSeats, 0)
  );
  const authenticated = Boolean(localStorage.getItem("transora_token"));
  const countBadge = document.querySelector("#voyage-count-badge");
  countBadge.textContent = String(voyageDepartures.length);
  countBadge.hidden = !authenticated || voyageDepartures.length === 0;
  document.querySelector("#voyage-list-caption").textContent = authenticated
    ? `${matches.length} départ${matches.length === 1 ? "" : "s"} affiché${matches.length === 1 ? "" : "s"} sur ${voyageDepartures.length}`
    : "Connectez-vous pour consulter les départs.";
  document.querySelector("#voyage-empty").hidden = !authenticated || voyageLoadError || matches.length > 0;
  const loginMessage = document.querySelector("#voyage-login-message");
  loginMessage.textContent = voyageLoadError
    ? "Impossible de charger les départs. Vérifiez votre connexion puis actualisez la liste."
    : "Connectez-vous pour afficher et gérer les voyages de votre entreprise.";
  loginMessage.hidden = authenticated && !voyageLoadError;
  body.hidden = !authenticated;
}

async function loadVoyages() {
  const token = localStorage.getItem("transora_token");
  if (!token) {
    voyageDepartures = [];
    voyageLoadError = false;
    renderVoyages();
    return;
  }

  const refresh = document.querySelector("#voyage-refresh");
  refresh.disabled = true;
  voyageLoadError = false;
  try {
    const response = await fetch("/api/v1/voyages/departures", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem("transora_token");
        setAuthenticatedState(false);
      }
      throw new Error(result.message || "Impossible de charger les départs.");
    }
    voyageDepartures = result.data.departures;
    renderVoyages();
  } catch (error) {
    voyageLoadError = true;
    renderVoyages();
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    refresh.disabled = false;
  }
}

function renderFleet() {
  const body = document.querySelector("#fleet-rows");
  if (!body) return;
  const search = document.querySelector("#fleet-search").value.trim().toLocaleLowerCase("fr");
  const selectedStatus = document.querySelector("#fleet-status-filter").value;
  const statusLabels = {
    disponible: ["Disponible", "ready"],
    en_service: ["En service", "boarding"],
    en_maintenance: ["En maintenance", "maintenance"],
    hors_service: ["Hors service", "out-of-service"]
  };
  const matches = fleetVehicles.filter((vehicle) => {
    const searchable = `${vehicle.immatriculation} ${vehicle.modele} ${vehicle.annee || ""}`.toLocaleLowerCase("fr");
    return searchable.includes(search)
      && (!selectedStatus || vehicle.statut === selectedStatus);
  });

  body.replaceChildren();
  matches.forEach((vehicle) => {
    const row = document.createElement("tr");
    const modelCell = document.createElement("td");
    const model = document.createElement("span");
    model.className = "fleet-model";
    const modelName = document.createElement("strong");
    modelName.textContent = vehicle.modele;
    const modelSubtext = document.createElement("small");
    modelSubtext.textContent = `Ajouté ${new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(new Date(vehicle.crééLe))}`;
    model.append(modelName, modelSubtext);
    modelCell.append(model);

    const registrationCell = document.createElement("td");
    const registration = document.createElement("span");
    registration.className = "vehicle-code";
    registration.textContent = vehicle.immatriculation;
    registrationCell.append(registration);

    const capacityCell = document.createElement("td");
    capacityCell.textContent = `${vehicle.capacite} places`;

    const yearCell = document.createElement("td");
    yearCell.textContent = vehicle.annee ? String(vehicle.annee) : "—";

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    const [statusText, statusClass] = statusLabels[vehicle.statut] || ["Non renseigné", "boarding"];
    status.className = `pill ${statusClass}`;
    status.textContent = statusText;
    statusCell.append(status);

    const optionsCell = document.createElement("td");
    const options = document.createElement("div");
    options.className = "fleet-options";
    const editButton = document.createElement("button");
    editButton.className = "fleet-action";
    editButton.type = "button";
    editButton.dataset.action = "edit";
    editButton.dataset.vehicleId = vehicle.id;
    editButton.textContent = "Modifier";
    const removeButton = document.createElement("button");
    removeButton.className = "fleet-action remove";
    removeButton.type = "button";
    removeButton.dataset.action = "remove";
    removeButton.dataset.vehicleId = vehicle.id;
    removeButton.textContent = "Retirer";
    options.append(editButton, removeButton);
    optionsCell.append(options);

    row.append(modelCell, registrationCell, capacityCell, yearCell, statusCell, optionsCell);
    body.append(row);
  });

  const countByStatus = (status) => fleetVehicles.filter((vehicle) => vehicle.statut === status).length;
  document.querySelector("#fleet-total").textContent = String(fleetVehicles.length);
  document.querySelector("#fleet-available").textContent = String(countByStatus("disponible"));
  document.querySelector("#fleet-active").textContent = String(countByStatus("en_service"));
  document.querySelector("#fleet-maintenance").textContent = String(countByStatus("en_maintenance"));
  const authenticated = Boolean(localStorage.getItem("transora_token"));
  const badge = document.querySelector("#fleet-count-badge");
  if (badge) {
    badge.textContent = String(fleetVehicles.length);
    badge.hidden = !authenticated || fleetVehicles.length === 0;
  }
  document.querySelector("#fleet-list-caption").textContent = authenticated
    ? `${matches.length} véhicule${matches.length === 1 ? "" : "s"} affiché${matches.length === 1 ? "" : "s"} sur ${fleetVehicles.length}`
    : "Connectez-vous pour consulter les véhicules enregistrés.";
  document.querySelector("#fleet-empty").hidden =
    !authenticated || fleetLoadError || matches.length > 0;
  const message = document.querySelector("#fleet-message");
  message.textContent = fleetLoadError
    ? "Impossible de charger la flotte. Vérifiez votre connexion puis actualisez la liste."
    : "Connectez-vous pour afficher et gérer les véhicules de votre entreprise.";
  message.hidden = authenticated && !fleetLoadError;
  body.hidden = !authenticated;
}

async function loadFleet() {
  const token = localStorage.getItem("transora_token");
  if (!token) {
    fleetVehicles = [];
    fleetLoadError = false;
    renderFleet();
    return;
  }

  const refresh = document.querySelector("#fleet-refresh");
  refresh.disabled = true;
  fleetLoadError = false;
  try {
    const response = await fetch("/api/v1/flotte", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem("transora_token");
        setAuthenticatedState(false);
      }
      throw new Error(result.message || "Impossible de charger les véhicules.");
    }
    fleetVehicles = result.data.vehicules;
    renderFleet();
  } catch (error) {
    fleetLoadError = true;
    renderFleet();
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    refresh.disabled = false;
  }
}

function formatFcfa(amount) {
  return `${new Intl.NumberFormat("fr-FR").format(Number(amount) || 0)} FCFA`;
}

function renderPayments() {
  const body = document.querySelector("#payment-rows");
  if (!body) return;
  const search = document.querySelector("#payment-search").value.trim().toLocaleLowerCase("fr");
  const selectedStatus = document.querySelector("#payment-status-filter").value;
  let canConfirm = false;
  try {
    canConfirm = JSON.parse(localStorage.getItem("transora_user") || "{}").role === "administrateur";
  } catch {
    localStorage.removeItem("transora_user");
  }
  const statusLabels = {
    NOT_INITIATED: ["À encaisser", "boarding"],
    PENDING: ["À confirmer", "boarding"],
    CONFIRMED: ["Confirmé", "ready"],
    CANCELLED: ["Annulé", "delayed"]
  };
  const methodLabels = {
    cash: "Espèces",
    card: "Carte",
    mobile_money: "Mobile Money",
    bank_transfer: "Virement"
  };
  const matches = payments.filter((payment) => {
    const normalizedStatus = payment.statut === "NOT_INITIATED"
      ? "UNPAID"
      : payment.statut;
    const searchable = `${payment.passager} ${payment.origine} ${payment.destination} ${payment.moyenPaiement || ""}`
      .toLocaleLowerCase("fr");
    return searchable.includes(search)
      && (!selectedStatus || selectedStatus === normalizedStatus);
  });

  body.replaceChildren();
  matches.forEach((payment) => {
    const row = document.createElement("tr");
    const passengerCell = document.createElement("td");
    const party = document.createElement("span");
    party.className = "payment-party";
    const passenger = document.createElement("strong");
    passenger.textContent = payment.passager;
    const route = document.createElement("small");
    route.textContent = `${payment.origine} → ${payment.destination}`;
    party.append(passenger, route);
    passengerCell.append(party);

    const departureCell = document.createElement("td");
    departureCell.textContent = new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(payment.départLe));

    const transportCell = document.createElement("td");
    transportCell.textContent = formatFcfa(payment.montantTransport);
    const feesCell = document.createElement("td");
    feesCell.textContent = formatFcfa(payment.fraisTransora);
    const totalCell = document.createElement("td");
    totalCell.textContent = formatFcfa(Number(payment.montantTransport) + Number(payment.fraisTransora));
    const methodCell = document.createElement("td");
    methodCell.textContent = methodLabels[payment.moyenPaiement] || "—";

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    const [statusText, statusClass] = statusLabels[payment.statut] || ["Non renseigné", "boarding"];
    status.className = `pill ${statusClass}`;
    status.textContent = statusText;
    statusCell.append(status);

    const actionCell = document.createElement("td");
    if (payment.statut === "NOT_INITIATED" || (payment.statut === "PENDING" && canConfirm)) {
      const action = document.createElement("button");
      action.className = "payment-action";
      action.type = "button";
      action.dataset.bookingId = payment.billetId;
      action.textContent = payment.statut === "PENDING" ? "Confirmer" : "Encaisser";
      actionCell.append(action);
    } else if (payment.statut === "PENDING") {
      actionCell.textContent = "Validation admin";
    } else if (payment.statut === "CONFIRMED") {
      actionCell.textContent = payment.confirméLe
        ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" }).format(new Date(payment.confirméLe))
        : "Terminé";
    }

    row.append(passengerCell, departureCell, transportCell, feesCell, totalCell, methodCell, statusCell, actionCell);
    body.append(row);
  });

  const unpaidCount = payments.filter((payment) =>
    payment.statut === "NOT_INITIATED" || payment.statut === "PENDING"
  ).length;
  document.querySelector("#payment-pending-total").textContent = String(unpaidCount);
  const authenticated = Boolean(localStorage.getItem("transora_token"));
  document.querySelector("#payment-list-caption").textContent = !authenticated
    ? "Connectez-vous pour consulter les paiements."
    : paymentLoadError
    ? "Erreur de chargement. Actualisez pour réessayer."
    : `${matches.length} réservation${matches.length === 1 ? "" : "s"} affichée${matches.length === 1 ? "" : "s"} sur ${payments.length}`;
  document.querySelector("#payment-empty").hidden =
    !authenticated || paymentLoadError || matches.length > 0;
  const message = document.querySelector("#payment-message");
  message.textContent = paymentLoadError
    ? "Impossible de charger les paiements. Vérifiez la connexion puis actualisez."
    : "Connectez-vous pour consulter et gérer les paiements de votre entreprise.";
  message.hidden = authenticated && !paymentLoadError;
  body.hidden = !authenticated;
}

function renderReportOperations() {
  const body = document.querySelector("#report-rows");
  if (!body) return;
  const selectedType = document.querySelector("#report-type-filter").value;
  const matches = reportOperations.filter((operation) => !selectedType || operation.type === selectedType);
  const typeLabels = {
    revenu: "Revenu",
    dépense: "Dépense",
    remboursement: "Remboursement",
    commission: "Commission",
    frais_transora: "Frais TRANSORA"
  };
  body.replaceChildren();
  matches.forEach((operation) => {
    const row = document.createElement("tr");
    const dateCell = document.createElement("td");
    dateCell.textContent = operation.createdAt
      ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" })
        .format(new Date(operation.createdAt))
      : "—";
    const typeCell = document.createElement("td");
    const type = document.createElement("span");
    type.className = `report-type${operation.type === "dépense" ? " expense" : operation.type === "remboursement" ? " refund" : ""}`;
    type.textContent = typeLabels[operation.type] || operation.type;
    typeCell.append(type);
    const descriptionCell = document.createElement("td");
    descriptionCell.textContent = operation.description || "—";
    const categoryCell = document.createElement("td");
    categoryCell.textContent = operation.category || "—";
    const referenceCell = document.createElement("td");
    referenceCell.textContent = operation.reference || "—";
    const amountCell = document.createElement("td");
    amountCell.textContent = formatFcfa(operation.amount);
    row.append(dateCell, typeCell, descriptionCell, categoryCell, referenceCell, amountCell);
    body.append(row);
  });

  const authenticated = Boolean(localStorage.getItem("transora_token"));
  document.querySelector("#report-list-caption").textContent = !authenticated
    ? "Connectez-vous pour consulter les rapports."
    : reportLoadError
    ? "Erreur de chargement. Actualisez pour réessayer."
    : `${matches.length} opération${matches.length === 1 ? "" : "s"} affichée${matches.length === 1 ? "" : "s"} sur ${reportOperations.length}`;
  document.querySelector("#report-empty").hidden =
    !authenticated || reportLoadError || matches.length > 0;
  const message = document.querySelector("#report-message");
  message.textContent = reportLoadError
    ? "Impossible de charger le rapport. Vérifiez la connexion puis actualisez."
    : "Connectez-vous pour consulter les rapports de votre entreprise.";
  message.hidden = authenticated && !reportLoadError;
  body.hidden = !authenticated;
}

async function loadReports() {
  const token = localStorage.getItem("transora_token");
  if (!token) {
    reportOperations = [];
    reportLoadError = false;
    [
      "#report-tickets",
      "#report-revenue",
      "#report-fees",
      "#report-expenses",
      "#report-refunds",
      "#report-net"
    ].forEach((selector) => {
      document.querySelector(selector).textContent = "—";
    });
    renderReportOperations();
    return;
  }

  const startDate = document.querySelector("#report-start-date").value;
  const endDate = document.querySelector("#report-end-date").value;
  if (startDate && endDate && startDate > endDate) {
    showToast("La date de début doit précéder ou être égale à la date de fin.");
    return;
  }
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const queryString = params.toString();
  const suffix = queryString ? `?${queryString}` : "";
  const refresh = document.querySelector("#report-refresh");
  refresh.disabled = true;
  reportLoadError = false;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const [statsResponse, operationsResponse] = await Promise.all([
      fetch(`/api/v1/finance/stats${suffix}`, { headers }),
      fetch(`/api/v1/finance${suffix}`, { headers })
    ]);
    const [statsResult, operationsResult] = await Promise.all([
      statsResponse.json(),
      operationsResponse.json()
    ]);
    if (!statsResponse.ok || !operationsResponse.ok) {
      const failedResponse = !statsResponse.ok ? statsResponse : operationsResponse;
      const failedResult = !statsResponse.ok ? statsResult : operationsResult;
      if (failedResponse.status === 401) {
        localStorage.removeItem("transora_token");
        setAuthenticatedState(false);
      }
      throw new Error(failedResult.message || "Impossible de charger les rapports.");
    }

    const summary = statsResult.data.résumé;
    const formatNumber = (value) => new Intl.NumberFormat("fr-FR").format(Number(value) || 0);
    document.querySelector("#report-tickets").textContent = formatNumber(summary.billetsTraités);
    document.querySelector("#report-revenue").textContent = formatFcfa(summary.revenusTransport);
    document.querySelector("#report-fees").textContent = formatFcfa(summary.fraisTransora);
    document.querySelector("#report-expenses").textContent = formatFcfa(summary.dépensesTotales);
    document.querySelector("#report-refunds").textContent = formatFcfa(summary.remboursements);
    document.querySelector("#report-net").textContent = formatFcfa(summary.bénéficeNetEntreprise);
    reportOperations = operationsResult.data.opérations;
    renderReportOperations();
  } catch (error) {
    reportOperations = [];
    reportLoadError = true;
    [
      "#report-tickets",
      "#report-revenue",
      "#report-fees",
      "#report-expenses",
      "#report-refunds",
      "#report-net"
    ].forEach((selector) => {
      document.querySelector(selector).textContent = "—";
    });
    renderReportOperations();
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    refresh.disabled = false;
  }
}

async function exportFinancialReport() {
  const token = localStorage.getItem("transora_token");
  if (!token) {
    showToast("Connectez-vous pour exporter le rapport.");
    return;
  }
  const params = new URLSearchParams({ format: "csv" });
  const startDate = document.querySelector("#report-start-date").value;
  const endDate = document.querySelector("#report-end-date").value;
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (startDate && endDate && startDate > endDate) {
    showToast("La date de début doit précéder ou être égale à la date de fin.");
    return;
  }

  const button = document.querySelector("#report-export");
  button.disabled = true;
  try {
    const response = await fetch(`/api/v1/finance/rapportexport?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const result = await response.json();
      if (response.status === 401) {
        localStorage.removeItem("transora_token");
        setAuthenticatedState(false);
      }
      throw new Error(result.message || "Impossible d'exporter le rapport.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "transora-rapport-financier.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("Rapport financier exporté.");
  } catch (error) {
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    button.disabled = false;
  }
}

async function loadPayments() {
  const token = localStorage.getItem("transora_token");
  if (!token) {
    payments = [];
    paymentLoadError = false;
    document.querySelector("#payment-revenue-total").textContent = "—";
    document.querySelector("#payment-fees-total").textContent = "—";
    renderPayments();
    return;
  }

  const refresh = document.querySelector("#payments-refresh");
  refresh.disabled = true;
  paymentLoadError = false;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const [listResponse, statsResponse] = await Promise.all([
      fetch("/api/v1/paiements", { headers }),
      fetch("/api/v1/paiements/stats", { headers })
    ]);
    const [listResult, statsResult] = await Promise.all([listResponse.json(), statsResponse.json()]);
    if (!listResponse.ok) {
      if (listResponse.status === 401) {
        localStorage.removeItem("transora_token");
        setAuthenticatedState(false);
      }
      throw new Error(listResult.message || "Impossible de charger les paiements.");
    }
    if (!statsResponse.ok) {
      throw new Error(statsResult.message || "Impossible de charger les statistiques de paiement.");
    }
    payments = listResult.data.paiements;
    document.querySelector("#payment-revenue-total").textContent =
      new Intl.NumberFormat("fr-FR").format(statsResult.data.résumés.revenusTransport);
    document.querySelector("#payment-fees-total").textContent =
      new Intl.NumberFormat("fr-FR").format(statsResult.data.résumés.fraisTransora);
    renderPayments();
  } catch (error) {
    payments = [];
    paymentLoadError = true;
    document.querySelector("#payment-revenue-total").textContent = "—";
    document.querySelector("#payment-fees-total").textContent = "—";
    renderPayments();
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    refresh.disabled = false;
  }
}

function openPaymentForm(payment) {
  selectedPayment = payment;
  const form = document.querySelector("#payment-form");
  const isPending = payment.statut === "PENDING";
  const total = Number(payment.montantTransport) + Number(payment.fraisTransora);
  document.querySelector("#payment-dialog-title").textContent = isPending
    ? "Confirmer le règlement"
    : "Encaisser la réservation";
  document.querySelector("#payment-dialog-description").textContent =
    `${payment.passager} · ${payment.origine} → ${payment.destination} · Total : ${formatFcfa(total)} (dont ${formatFcfa(payment.fraisTransora)} de frais).`;
  form.elements.moyenPaiement.value = payment.moyenPaiement || "cash";
  form.elements.moyenPaiement.disabled = isPending;
  form.elements.preuvePaiement.value = payment.preuve || "";
  document.querySelector("#payment-submit").textContent = isPending
    ? "Confirmer le paiement"
    : "Enregistrer et confirmer";
  document.querySelector("#payment-dialog").showModal();
}

function openFleetForm(vehicle) {
  const form = document.querySelector("#fleet-form");
  editingVehicleId = vehicle?.id;
  form.reset();
  document.querySelector("#fleet-form-eyebrow").textContent = vehicle ? "MODIFICATION DU VÉHICULE" : "NOUVEAU VÉHICULE";
  document.querySelector("#fleet-form-title").textContent = vehicle ? "Modifier le véhicule" : "Ajouter un véhicule";
  document.querySelector("#fleet-submit").textContent = vehicle ? "Enregistrer les modifications" : "Enregistrer le véhicule";
  if (vehicle) {
    form.elements.immatriculation.value = vehicle.immatriculation;
    form.elements.modele.value = vehicle.modele;
    form.elements.capacite.value = vehicle.capacite;
    form.elements.annee.value = vehicle.annee || "";
    form.elements.statut.value = vehicle.statut;
  }
  document.querySelector("#fleet-dialog").showModal();
}

function setAuthMode(register) {
  isRegistration = register;
  document.querySelector("#auth-title").textContent = register ? "Créer votre espace" : "Connexion à Transora";
  document.querySelector("#auth-description").textContent = register
    ? "Créez un espace entreprise pour démarrer."
    : "Connectez-vous pour charger les données de votre entreprise.";
  document.querySelector("#auth-submit").textContent = register ? "Créer l'espace" : "Se connecter";
  document.querySelector("#auth-toggle").textContent = register
    ? "J'ai déjà un compte"
    : "Créer un espace entreprise";
  document.querySelector("#name-field").hidden = !register;
  document.querySelector("#company-field").hidden = !register;
  document.querySelector("#siret-field").hidden = !register;
  authForm.elements.name.required = register;
  authForm.elements.companyName.required = register;
  authForm.elements.password.autocomplete = register ? "new-password" : "current-password";
}

globalSearch.addEventListener("input", (event) => {
  filterDepartures(event.currentTarget.value);
});

function localDateValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

document.querySelector("#dashboard-date").value = localDateValue();
const reportToday = new Date();
document.querySelector("#report-end-date").value = localDateValue(reportToday);
document.querySelector("#report-start-date").value = localDateValue(
  new Date(reportToday.getFullYear(), reportToday.getMonth(), 1)
);
document.querySelector("#dashboard-date").addEventListener("change", loadDashboard);
document.querySelector("#period-select").addEventListener("change", loadDashboard);
document.querySelector("#dashboard-refresh").addEventListener("click", loadDashboard);

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => window.setTimeout(showCurrentView, 0));
});

function showCurrentView() {
  const hash = window.location.hash || "#overview";
  const isVoyages = hash === "#voyages";
  const isFleet = hash === "#flotte";
  const isPayments = hash === "#payments";
  const isReports = hash === "#reports";
  document.querySelector("#overview-page").hidden = isVoyages || isFleet || isPayments || isReports;
  document.querySelector("#voyages-page").hidden = !isVoyages;
  document.querySelector("#fleet-page").hidden = !isFleet;
  document.querySelector("#payments-page").hidden = !isPayments;
  document.querySelector("#reports-page").hidden = !isReports;
  document.querySelector(".breadcrumbs strong").textContent =
    isVoyages ? "Voyages" : isFleet ? "Flotte" : isPayments ? "Paiements" : isReports ? "Rapports" : "Vue d'ensemble";
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.hash === hash);
  });
  if (isVoyages) loadVoyages();
  if (isFleet) loadFleet();
  if (isPayments) loadPayments();
  if (isReports) loadReports();
}

window.addEventListener("hashchange", showCurrentView);
showCurrentView();

document.querySelector("#voyages-add-departure").addEventListener("click", () => {
  if (!localStorage.getItem("transora_token")) {
    showToast("Connectez-vous pour enregistrer un départ.");
    setAuthMode(false);
    authDialog.showModal();
    return;
  }
  departureDialog.showModal();
});

document.querySelector("#voyage-refresh").addEventListener("click", loadVoyages);
document.querySelector("#voyage-search").addEventListener("input", renderVoyages);
document.querySelector("#voyage-date").addEventListener("change", renderVoyages);
document.querySelector("#voyage-status").addEventListener("change", renderVoyages);
document.querySelector("#voyage-rows").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-departure-id]");
  if (!button || button.disabled) return;
  selectedDeparture = voyageDepartures.find((departure) => departure.id === button.dataset.departureId);
  if (!selectedDeparture) {
    showToast("Ce départ n'est plus disponible. Actualisez la liste.");
    return;
  }
  document.querySelector("#booking-trip-description").textContent =
    `${selectedDeparture.origin} → ${selectedDeparture.destination} · ${new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(selectedDeparture.departureAt))}`;
  document.querySelector("#booking-dialog").showModal();
});

document.querySelector("#fleet-add-vehicle").addEventListener("click", () => {
  if (!localStorage.getItem("transora_token")) {
    showToast("Connectez-vous pour gérer la flotte.");
    setAuthMode(false);
    authDialog.showModal();
    return;
  }
  openFleetForm();
});
document.querySelector("#fleet-refresh").addEventListener("click", loadFleet);
document.querySelector("#fleet-search").addEventListener("input", renderFleet);
document.querySelector("#fleet-status-filter").addEventListener("change", renderFleet);
document.querySelector("#fleet-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-vehicle-id]");
  if (!button || button.disabled) return;
  const vehicle = fleetVehicles.find((item) => item.id === button.dataset.vehicleId);
  if (!vehicle) {
    showToast("Ce véhicule n'est plus dans la liste. Actualisez la flotte.");
    return;
  }
  if (button.dataset.action === "edit") {
    openFleetForm(vehicle);
    return;
  }
  if (button.dataset.action !== "remove") return;
  if (!window.confirm(`Retirer le véhicule ${vehicle.immatriculation} de la flotte ?`)) return;

  button.disabled = true;
  try {
    const response = await fetch(`/api/v1/flotte/${encodeURIComponent(vehicle.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("transora_token")}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de retirer le véhicule.");
    showToast("Véhicule retiré de la flotte.");
    await loadFleet();
  } catch (error) {
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    button.disabled = false;
  }
});

const bookingDialog = document.querySelector("#booking-dialog");
document.querySelector("#booking-dialog-close").addEventListener("click", () => bookingDialog.close());
document.querySelector("#booking-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedDeparture) return;

  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = document.querySelector("#booking-submit");
  submit.disabled = true;
  try {
    const response = await fetch(`/api/v1/voyages/departures/${encodeURIComponent(selectedDeparture.id)}/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("transora_token")}`
      },
      body: JSON.stringify({
        passengerName: values.passengerName,
        amountTransport: Number(values.amountTransport)
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de créer la réservation.");
    form.reset();
    bookingDialog.close();
    selectedDeparture = undefined;
    showToast("Réservation créée. Ouverture des paiements pour encaisser le billet.");
    await loadDashboard();
    window.location.hash = "#payments";
  } catch (error) {
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    submit.disabled = false;
  }
});

const fleetDialog = document.querySelector("#fleet-dialog");
document.querySelector("#fleet-dialog-close").addEventListener("click", () => fleetDialog.close());
document.querySelector("#fleet-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = document.querySelector("#fleet-submit");
  const token = localStorage.getItem("transora_token");
  submit.disabled = true;
  try {
    const response = await fetch(
      editingVehicleId ? `/api/v1/flotte/${encodeURIComponent(editingVehicleId)}` : "/api/v1/flotte",
      {
        method: editingVehicleId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...values,
          capacite: Number(values.capacite),
          annee: values.annee ? Number(values.annee) : null
        })
      }
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible d'enregistrer le véhicule.");
    form.reset();
    fleetDialog.close();
    editingVehicleId = undefined;
    showToast("Flotte mise à jour.");
    await loadFleet();
  } catch (error) {
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#export-button").addEventListener("click", () => {
  if (window.location.hash === "#reports") {
    exportFinancialReport();
    return;
  }
  const isVoyages = window.location.hash === "#voyages";
  const isFleet = window.location.hash === "#flotte";
  const data = isFleet
    ? [
      ["Immatriculation", "Modèle", "Capacité", "Année", "État"],
      ...fleetVehicles.map((vehicle) => [
        vehicle.immatriculation,
        vehicle.modele,
        `${vehicle.capacite} places`,
        vehicle.annee || "",
        vehicle.statut
      ])
    ]
    : isVoyages
    ? [
      ["Trajet", "Date et heure", "Véhicule", "Places disponibles", "Remplissage", "Statut"],
      ...voyageDepartures.map((departure) => [
        `${departure.origin} → ${departure.destination}`,
        new Date(departure.departureAt).toLocaleString("fr-FR"),
        departure.vehicleCode,
        `${departure.availableSeats} / ${departure.capacity}`,
        `${departure.occupancyRate}%`,
        departure.status
      ])
    ]
    : [
      ["Trajet", "Heure", "Véhicule", "Remplissage", "Statut"],
      ...rows.map((row) => Array.from(row.querySelectorAll("td"))
        .map((cell) => cell.innerText.replace(/\s+/g, " ").trim()))
    ];
  const csv = data.map((record) => record
    .map((value) => `"${value.replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = isFleet
    ? "transora-flotte.csv"
    : isVoyages ? "transora-voyages.csv" : "transora-departs.csv";
  anchor.click();
  URL.revokeObjectURL(url);
  showToast(isFleet ? "Liste de la flotte exportée." : "Rapport des départs exporté.");
});

document.querySelector(".notification-button").addEventListener("click", () => {
  showToast("Vous êtes à jour. Aucune nouvelle notification.");
});

loginButton.addEventListener("click", () => {
  if (localStorage.getItem("transora_token")) {
    localStorage.removeItem("transora_token");
    localStorage.removeItem("transora_user");
    window.location.reload();
    return;
  }
  setAuthMode(false);
  authDialog.showModal();
});

document.querySelector("#payments-refresh").addEventListener("click", loadPayments);
document.querySelector("#report-refresh").addEventListener("click", loadReports);
document.querySelector("#report-apply").addEventListener("click", loadReports);
document.querySelector("#report-type-filter").addEventListener("change", renderReportOperations);
document.querySelector("#report-export").addEventListener("click", exportFinancialReport);
document.querySelector("#payment-search").addEventListener("input", renderPayments);
document.querySelector("#payment-status-filter").addEventListener("change", renderPayments);
document.querySelector("#payment-rows").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-booking-id]");
  if (!button) return;
  const payment = payments.find((item) => item.billetId === button.dataset.bookingId);
  if (!payment) {
    showToast("Cette réservation n'est plus dans la liste. Actualisez les paiements.");
    return;
  }
  openPaymentForm(payment);
});
document.querySelector("#payment-dialog-close").addEventListener("click", () => {
  document.querySelector("#payment-dialog").close();
});
document.querySelector("#payment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedPayment) return;

  const form = event.currentTarget;
  const submit = document.querySelector("#payment-submit");
  const values = Object.fromEntries(new FormData(form).entries());
  const token = localStorage.getItem("transora_token");
  submit.disabled = true;
  try {
    let transactionId = selectedPayment.transactionId;
    if (!transactionId) {
      const initResponse = await fetch("/api/v1/paiements/init", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          billetId: selectedPayment.billetId,
          moyenPaiement: values.moyenPaiement
        })
      });
      const initResult = await initResponse.json();
      if (!initResponse.ok) throw new Error(initResult.message || "Impossible d'initialiser le paiement.");
      transactionId = initResult.data.id;
    }

    const confirmResponse = await fetch("/api/v1/paiements/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        transactionId,
        preuvePaiement: values.preuvePaiement
      })
    });
    const confirmResult = await confirmResponse.json();
    if (!confirmResponse.ok) throw new Error(confirmResult.message || "Impossible de confirmer le paiement.");

    form.reset();
    document.querySelector("#payment-dialog").close();
    selectedPayment = undefined;
    showToast("Paiement confirmé et réservation marquée comme payée.");
    await loadPayments();
    await loadDashboard();
  } catch (error) {
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    submit.disabled = false;
  }
});
document.querySelector("#payment-export").addEventListener("click", () => {
  const headers = ["Passager", "Trajet", "Départ", "Transport FCFA", "Frais TRANSORA FCFA", "Total FCFA", "Moyen", "Statut"];
  const rows = payments.map((payment) => [
    payment.passager,
    `${payment.origine} → ${payment.destination}`,
    new Date(payment.départLe).toLocaleString("fr-FR"),
    payment.montantTransport,
    payment.fraisTransora,
    Number(payment.montantTransport) + Number(payment.fraisTransora),
    payment.moyenPaiement || "",
    payment.statut
  ]);
  const csv = [headers, ...rows].map((record) =>
    record.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")
  ).join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "transora-paiements.csv";
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Liste des paiements exportée.");
});

const departureDialog = document.querySelector("#departure-dialog");
document.querySelector("#add-departure-button").addEventListener("click", () => {
  if (!localStorage.getItem("transora_token")) {
    showToast("Connectez-vous pour enregistrer un départ.");
    setAuthMode(false);
    authDialog.showModal();
    return;
  }
  departureDialog.showModal();
});

document.querySelector("#departure-dialog-close").addEventListener("click", () => departureDialog.close());

document.querySelector("#departure-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const token = localStorage.getItem("transora_token");
  const submit = document.querySelector("#departure-submit");
  submit.disabled = true;

  try {
    const response = await fetch("/api/v1/voyages/departures", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        ...values,
        departureAt: new Date(values.departureAt).toISOString(),
        capacity: Number(values.capacity)
      })
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || "Impossible d'enregistrer le départ.");
    }

    form.reset();
    departureDialog.close();
    showToast("Départ enregistré. Actualisation du tableau de bord...");
    await loadDashboard();
  } catch (error) {
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#dialog-close").addEventListener("click", () => authDialog.close());
authToggle.addEventListener("click", () => setAuthMode(!isRegistration));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(authForm);
  const payload = Object.fromEntries(form.entries());
  const submit = document.querySelector("#auth-submit");
  submit.disabled = true;

  try {
    const endpoint = isRegistration ? "/api/v1/auth/register" : "/api/v1/auth/login";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || "Authentification impossible.");
    }
    localStorage.setItem("transora_token", result.data.token);
    localStorage.setItem("transora_user", JSON.stringify(result.data.user));
    authDialog.close();
    showToast("Connecté. Chargement des données de l'entreprise...");
    await loadDashboard();
    if (window.location.hash === "#flotte") await loadFleet();
    if (window.location.hash === "#payments") await loadPayments();
    if (window.location.hash === "#reports") await loadReports();
  } catch (error) {
    showToast(error.message || "Connexion à l'API impossible.");
  } finally {
    submit.disabled = false;
  }
});

setAuthenticatedState(Boolean(localStorage.getItem("transora_token")));
const now = new Date();
document.querySelector("#today-label").textContent =
  new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(now).toLocaleUpperCase("fr");
loadDashboard();
