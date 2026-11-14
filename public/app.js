let rows = Array.from(document.querySelectorAll("#departure-rows tr"));
const globalSearch = document.querySelector("#global-search");
const globalSearchResults = document.querySelector("#global-search-results");
const toast = document.querySelector("#toast");
const loginButton = document.querySelector("#login-button");
const authDialog = document.querySelector("#auth-dialog");
const authForm = document.querySelector("#auth-form");
const authToggle = document.querySelector("#auth-toggle");
let isRegistration = false;
let toastTimer;
let voyageDepartures = [];
let companyTariffs = [];
let selectedDeparture;
let voyageLoadError = false;
let fleetVehicles = [];
let fleetLoadError = false;
let editingVehicleId;
let payments = [];
let paymentLoadError = false;
let selectedPayment;
let reportOperations = [];
let courierParcels = [];
let courierTariffs = [];
let courierDrivers = [];
let courierDepartures = [];
let personnelEmployees = [];
let reportLoadError = false;
let globalSearchController;
let globalSearchSequence = 0;
let globalSearchTimer;
let scannerStream;
let scannerAnimationFrame;
let scannerDetector;
let scannerLastFrameAt = 0;
let scannerDetecting = false;

localStorage.removeItem("transora_token");
let accessToken = null;
let refreshPromise = null;
let sessionRefreshTimer;
const nativeFetch = window.fetch.bind(window);

// Les jetons d'accès ne quittent jamais la mémoire de cette page.
window.fetch = async (input, init = {}) => {
  const requestUrl = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
  const url = new URL(requestUrl, window.location.origin);
  const isAuthBootstrap = /^\/api\/v1\/auth\/(login|register|refresh)$/.test(url.pathname);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/v1/") || isAuthBootstrap) {
    return nativeFetch(input, init);
  }

  let attemptedRefresh = false;
  if (!accessToken) {
    attemptedRefresh = true;
    await refreshAccessToken();
  }

  const sendAuthorizedRequest = () => {
    const sourceHeaders = init.headers || (input instanceof Request ? input.headers : undefined);
    const headers = new Headers(sourceHeaders);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    else headers.delete("Authorization");
    return nativeFetch(input, { ...init, headers, credentials: init.credentials || "same-origin" });
  };

  let response = await sendAuthorizedRequest();
  if (response.status === 401 && !attemptedRefresh && await refreshAccessToken()) {
    response = await sendAuthorizedRequest();
  }
  return response;
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function setTicketImage(selector, source) {
  if (typeof source !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) {
    throw new Error("Format d'image du billet invalide.");
  }
  document.querySelector(selector).src = source;
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
}

function setAuthenticatedState(authenticated) {
  loginButton.lastChild.textContent = authenticated
    ? " Données en direct · Déconnexion"
    : " Mode démonstration · Connexion";
  loginButton.querySelector("span").style.background = authenticated ? "#55b968" : "#e6ad58";
  if (authenticated && window.location.hash === "#courrier") loadCourier();
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
  const token = accessToken;
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
        accessToken = null;
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
    const route = `${departure.origin} → ${departure.destination} ${departure.vehicleCode} ${departure.id}`.toLocaleLowerCase("fr");
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
    const tariffButton = document.createElement("button");
    tariffButton.className = "voyage-action";
    tariffButton.type = "button";
    tariffButton.dataset.departureId = departure.id;
    tariffButton.dataset.action = "tariff";
    tariffButton.textContent = "Appliquer tarif";
    tariffButton.hidden = Boolean(departure.routeTariffId);
    const statusButton = document.createElement("button");
    statusButton.className = "voyage-action";
    statusButton.type = "button";
    statusButton.dataset.departureId = departure.id;
    statusButton.dataset.action = "status";
    statusButton.dataset.nextStatus = departure.status === "SCHEDULED" ? "BOARDING" : "DEPARTED";
    statusButton.textContent = departure.status === "SCHEDULED" ? "Ouvrir embarquement" : "Clôturer départ";
    statusButton.hidden = !["SCHEDULED", "BOARDING"].includes(departure.status);
    options.append(bookingButton, tariffButton, statusButton);
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
  const authenticated = Boolean(accessToken);
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
  const token = accessToken;
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
        accessToken = null;
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
    const searchable = `${vehicle.id} ${vehicle.immatriculation} ${vehicle.modele} ${vehicle.annee || ""}`.toLocaleLowerCase("fr");
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
  const authenticated = Boolean(accessToken);
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
  const token = accessToken;
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
        accessToken = null;
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
    const searchable = `${payment.billetId} ${payment.transactionId || ""} ${payment.passager} ${payment.origine} ${payment.destination} ${payment.moyenPaiement || ""} ${payment.statut}`
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
    const companyFeesCell = document.createElement("td");
    companyFeesCell.textContent = formatFcfa(payment.fraisCompagnie || 0);
    const platformFeesCell = document.createElement("td");
    platformFeesCell.textContent = formatFcfa(payment.fraisTransora);
    const totalCell = document.createElement("td");
    totalCell.textContent = formatFcfa(Number(payment.montantTransport) + Number(payment.fraisCompagnie || 0) + Number(payment.fraisTransora));
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
      const ticketButton = document.createElement("button");
      ticketButton.className = "payment-action";
      ticketButton.type = "button";
      ticketButton.dataset.action = "ticket";
      ticketButton.dataset.bookingId = payment.billetId;
      ticketButton.textContent = "Billet QR";
      actionCell.append(ticketButton);
    }

    row.append(passengerCell, departureCell, transportCell, companyFeesCell, platformFeesCell, totalCell, methodCell, statusCell, actionCell);
    body.append(row);
  });

  const unpaidCount = payments.filter((payment) =>
    payment.statut === "NOT_INITIATED" || payment.statut === "PENDING"
  ).length;
  document.querySelector("#payment-pending-total").textContent = String(unpaidCount);
  const authenticated = Boolean(accessToken);
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

  const authenticated = Boolean(accessToken);
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
  const token = accessToken;
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
        accessToken = null;
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
  const token = accessToken;
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
        accessToken = null;
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
  const token = accessToken;
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
        accessToken = null;
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
  const total = Number(payment.montantTransport) + Number(payment.fraisCompagnie || 0) + Number(payment.fraisTransora);
  document.querySelector("#payment-dialog-title").textContent = isPending
    ? "Confirmer le règlement"
    : "Encaisser la réservation";
  document.querySelector("#payment-dialog-description").textContent =
    `${payment.passager} · ${payment.origine} → ${payment.destination} · Total : ${formatFcfa(total)} (dont ${formatFcfa(payment.fraisCompagnie || 0)} de frais compagnie et ${formatFcfa(payment.fraisTransora)} de frais TRANSORA).`;
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

function positionGlobalSearchResults() {
  const bounds = globalSearch.getBoundingClientRect();
  const width = Math.min(Math.max(bounds.width, 290), window.innerWidth - 24);
  globalSearchResults.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`;
  globalSearchResults.style.top = `${bounds.bottom + 6}px`;
  globalSearchResults.style.width = `${width}px`;
}

function closeGlobalSearch() {
  globalSearchSequence += 1;
  globalSearchController?.abort();
  globalSearchResults.hidden = true;
  globalSearch.setAttribute("aria-expanded", "false");
}

function showGlobalSearchMessage(message) {
  const paragraph = document.createElement("p");
  paragraph.className = "search-result-empty";
  paragraph.textContent = message;
  globalSearchResults.replaceChildren(paragraph);
  positionGlobalSearchResults();
  globalSearchResults.hidden = false;
  globalSearch.setAttribute("aria-expanded", "true");
}

function renderGlobalSearchResults(results) {
  if (!results.length) {
    showGlobalSearchMessage("Aucun résultat. Essayez un nom, une référence de paiement ou un trajet.");
    return;
  }

  const fragment = document.createDocumentFragment();
  results.forEach((result) => {
    const option = document.createElement("button");
    option.type = "button";
    option.setAttribute("role", "option");
    option.dataset.searchType = result.type;
    option.dataset.searchTitle = result.title;
    const heading = document.createElement("span");
    heading.className = "search-result-heading";
    const title = document.createElement("strong");
    title.textContent = result.title;
    const type = document.createElement("span");
    type.className = "search-result-type";
    type.textContent = result.type;
    heading.append(title, type);
    const subtitle = document.createElement("small");
    subtitle.textContent = result.subtitle || "";
    const detail = document.createElement("small");
    detail.textContent = result.detail || result.status || "";
    option.append(heading, subtitle, detail);
    fragment.append(option);
  });
  globalSearchResults.replaceChildren(fragment);
  positionGlobalSearchResults();
  globalSearchResults.hidden = false;
  globalSearch.setAttribute("aria-expanded", "true");
}

async function searchDashboard(value) {
  const term = value.trim();
  if (term.length < 2) {
    closeGlobalSearch();
    globalSearchResults.replaceChildren();
    return;
  }

  const token = accessToken;
  if (!token) {
    showGlobalSearchMessage("Connectez-vous pour rechercher dans les billets, clients, paiements et opérations.");
    return;
  }

  globalSearchController?.abort();
  globalSearchController = new AbortController();
  const sequence = ++globalSearchSequence;
  showGlobalSearchMessage("Recherche en cours…");
  try {
    const response = await fetch(`/api/v1/recherche?q=${encodeURIComponent(term)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: globalSearchController.signal
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        accessToken = null;
        setAuthenticatedState(false);
      }
      throw new Error(result.message || "Recherche impossible.");
    }
    if (sequence === globalSearchSequence) renderGlobalSearchResults(result.data.résultats);
  } catch (error) {
    if (error.name === "AbortError" || sequence !== globalSearchSequence) return;
    showGlobalSearchMessage(error.message || "La recherche a échoué. Réessayez.");
  }
}

function extractTicketId(value) {
  const text = value.trim();
  try {
    const url = new URL(text, window.location.origin);
    for (const key of ["ticket", "billet", "bookingId", "id"]) {
      const candidate = url.searchParams.get(key);
      if (candidate) return extractTicketId(candidate);
    }
    const pathMatch = url.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    if (pathMatch) return pathMatch[0];
  } catch {
    // The scan may contain a plain UUID rather than a URL.
  }
  const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return match?.[0] || "";
}

function setScannerFeedback(message, state = "") {
  const feedback = document.querySelector("#scanner-feedback");
  feedback.textContent = message;
  feedback.dataset.state = state;
}

function renderTicketCheck(ticket, ticketId) {
  const result = document.querySelector("#scanner-result");
  result.dataset.valid = String(ticket.peutEmbarquer);
  result.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = ticket.peutEmbarquer ? "Billet valide pour l'embarquement" : "Embarquement refusé";
  const details = [
    `Compagnie : ${ticket.compagnie}`,
    `Passager : ${ticket.passager}`,
    `Trajet : ${ticket.origine} → ${ticket.destination}`,
    `Départ : ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ticket.departLe))}`,
    `Véhicule : ${ticket.vehicule}`,
    `Siège : ${ticket.siege || "—"}`,
    `Paiement : ${ticket.statutPaiement === "CONFIRMED" ? "confirmé" : "non confirmé"}`,
    `État du départ : ${ticket.statutDepart}`
  ];
  if (ticket.motif) details.push(ticket.motif);
  const paragraphs = details.map((detail) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = detail;
    return paragraph;
  });
  result.append(heading, ...paragraphs);
  if (ticket.peutEmbarquer) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary-button";
    button.textContent = "Confirmer l'embarquement";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const response = await fetch("/api/v1/embarquement/valider", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ billetId: ticketId })
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "Impossible de valider l'embarquement.");
        setScannerFeedback("Embarquement enregistré avec succès.", "success");
        await lookupScannedTicket(ticketId);
      } catch (error) {
        setScannerFeedback(error.message || "Erreur pendant la validation.", "error");
        button.disabled = false;
      }
    });
    result.append(button);
  }
  result.hidden = false;
}

async function lookupScannedTicket(rawValue) {
  const ticketId = extractTicketId(rawValue);
  const token = accessToken;
  const submit = document.querySelector("#scanner-submit");
  document.querySelector("#scanner-result").hidden = true;
  if (!token) {
    setScannerFeedback("Connectez-vous pour vérifier un billet.", "error");
    return;
  }
  if (!ticketId) {
    setScannerFeedback("Code illisible. Scannez le QR/code-barres d'un billet TRANSORA ou saisissez son identifiant.", "error");
    return;
  }

  submit.disabled = true;
  setScannerFeedback("Vérification du billet…");
  try {
    const response = await fetch(`/api/v1/embarquement/scan/${encodeURIComponent(ticketId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        accessToken = null;
        setAuthenticatedState(false);
      }
      throw new Error(result.message || "Billet introuvable.");
    }
    renderTicketCheck(result.data, ticketId);
    setScannerFeedback(
      result.data.peutEmbarquer
        ? "Billet authentique. Confirmez l'embarquement pour l'enregistrer."
        : result.data.motif || "Billet non valide.",
      result.data.peutEmbarquer ? "success" : "error"
    );
    if (scannerStream) stopTicketScanner();
  } catch (error) {
    setScannerFeedback(error.message || "Impossible de vérifier le billet.", "error");
  } finally {
    submit.disabled = false;
    document.querySelector("#scanner-input").focus();
  }
}

function stopTicketScanner() {
  if (scannerAnimationFrame) window.cancelAnimationFrame(scannerAnimationFrame);
  scannerAnimationFrame = undefined;
  scannerStream?.getTracks().forEach((track) => track.stop());
  scannerStream = undefined;
  const video = document.querySelector("#scanner-video");
  video.pause();
  video.srcObject = null;
  video.hidden = true;
  document.querySelector("#scanner-stop").hidden = true;
  document.querySelector("#scanner-start").hidden = false;
}

async function startTicketScanner() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setScannerFeedback("La caméra nécessite HTTPS (ou localhost). Vous pouvez saisir un code ou utiliser un lecteur USB/Bluetooth.", "error");
    return;
  }
  if (!("BarcodeDetector" in window)) {
    setScannerFeedback("La lecture caméra n'est pas prise en charge par ce navigateur. Utilisez un lecteur USB/Bluetooth ou saisissez le code.", "error");
    return;
  }
  try {
    const supportedFormats = await window.BarcodeDetector.getSupportedFormats();
    const formats = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf"]
      .filter((format) => supportedFormats.includes(format));
    if (!formats.length) {
      setScannerFeedback("Aucun format QR/code-barres compatible. Utilisez un lecteur USB/Bluetooth ou saisissez le code.", "error");
      return;
    }
    scannerDetector = new window.BarcodeDetector({ formats });
    scannerStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } }
    });
    const video = document.querySelector("#scanner-video");
    video.srcObject = scannerStream;
    video.hidden = false;
    await video.play();
    document.querySelector("#scanner-start").hidden = true;
    document.querySelector("#scanner-stop").hidden = false;
    setScannerFeedback("Caméra active. Cadrez un QR code ou un code-barres.");
    const scanFrame = async (now) => {
      if (!scannerStream) return;
      scannerAnimationFrame = window.requestAnimationFrame(scanFrame);
      if (scannerDetecting || now - scannerLastFrameAt < 180 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      scannerLastFrameAt = now;
      scannerDetecting = true;
      try {
        const detected = await scannerDetector.detect(video);
        const code = detected.find((item) => item.rawValue)?.rawValue;
        if (code) {
          document.querySelector("#scanner-input").value = code;
          stopTicketScanner();
          await lookupScannedTicket(code);
        }
      } catch (error) {
        stopTicketScanner();
        setScannerFeedback(error.message || "La caméra n'a pas pu lire ce code.", "error");
      } finally {
        scannerDetecting = false;
      }
    };
    scannerAnimationFrame = window.requestAnimationFrame(scanFrame);
  } catch (error) {
    stopTicketScanner();
    setScannerFeedback(error.message || "Accès caméra refusé ou caméra indisponible.", "error");
  }
}

async function openTicket(bookingId) {
  const token = accessToken;
  if (!token) {
    setAuthMode(false);
    authDialog.showModal();
    return;
  }
  const dialog = document.querySelector("#ticket-dialog");
  const button = Array.from(document.querySelectorAll('#payment-rows button[data-action="ticket"]'))
    .find((candidate) => candidate.dataset.bookingId === bookingId);
  if (button) button.disabled = true;
  try {
    const response = await fetch(`/api/v1/recherche/billet/${encodeURIComponent(bookingId)}?images=true`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        accessToken = null;
        setAuthenticatedState(false);
      }
      throw new Error(result.message || "Impossible de charger le billet.");
    }
    const ticket = result.data;
    if (!ticket.qrCode || !ticket.codeBarres) {
      throw new Error(ticket.motif || "Le billet ne peut pas être généré avant la confirmation du paiement.");
    }
    document.querySelector("#ticket-title").textContent = `${ticket.origine} → ${ticket.destination}`;
    document.querySelector("#ticket-description").textContent =
      `${ticket.compagnie || "Compagnie"} · ${ticket.passager} · Siège ${ticket.siege || "—"} · Départ le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" }).format(new Date(ticket.départLe))} · ${formatFcfa(ticket.montantTotal)} · Paiement : ${ticket.statutPaiement === "CONFIRMED" ? "confirmé" : "en attente"}`;
    setTicketImage("#ticket-qr", ticket.qrCode);
    setTicketImage("#ticket-barcode", ticket.codeBarres);
    const ticketState = ticket.statutPaiement === "CONFIRMED"
      ? (ticket.valide ? "Billet payé" : ticket.motif || "Billet payé mais non utilisable")
      : "Réservation non payée — embarquement interdit";
    document.querySelector("#ticket-id").textContent = `Référence : ${ticket.billetId} · ${ticketState}`;
    dialog.showModal();
  } catch (error) {
    showToast(error.message || "Impossible de charger le billet.");
  } finally {
    if (button) button.disabled = false;
  }
}

globalSearch.addEventListener("focus", () => {
  if (globalSearch.value.trim().length >= 2) searchDashboard(globalSearch.value);
});
globalSearch.addEventListener("input", () => {
  window.clearTimeout(globalSearchTimer);
  globalSearchTimer = window.setTimeout(() => searchDashboard(globalSearch.value), 220);
});
globalSearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeGlobalSearch();
    globalSearch.blur();
  } else if (event.key === "ArrowDown" && !globalSearchResults.hidden) {
    event.preventDefault();
    globalSearchResults.querySelector("button")?.focus();
  }
});
globalSearchResults.addEventListener("click", (event) => {
  const option = event.target.closest("button[role='option']");
  if (!option || !globalSearchResults.contains(option)) return;
  const type = option.dataset.searchType;
  const title = option.dataset.searchTitle;
  const destinations = {
    billet: "#payments",
    "départ": "#voyages",
    "véhicule": "#flotte",
    opération: "#reports"
  };
  const href = destinations[type];
  if (!href) return;
  closeGlobalSearch();
  window.location.hash = href;
  window.setTimeout(() => {
    const localSearch = type === "billet"
      ? document.querySelector("#payment-search")
      : type === "départ" ? document.querySelector("#voyage-search")
      : type === "véhicule" ? document.querySelector("#fleet-search")
      : null;
    if (localSearch) {
      localSearch.value = title;
      localSearch.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, 0);
});
globalSearchResults.addEventListener("keydown", (event) => {
  const options = Array.from(globalSearchResults.querySelectorAll("button[role='option']"));
  const index = options.indexOf(event.target);
  if (event.key === "ArrowDown" && index < options.length - 1) {
    event.preventDefault();
    options[index + 1].focus();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (index > 0) options[index - 1].focus();
    else globalSearch.focus();
  } else if (event.key === "Escape") {
    closeGlobalSearch();
    globalSearch.focus();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!globalSearch.contains(event.target) && !globalSearchResults.contains(event.target)) closeGlobalSearch();
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    globalSearch.focus();
  }
  if (event.key === "Escape") closeGlobalSearch();
});
window.addEventListener("resize", () => {
  if (!globalSearchResults.hidden) positionGlobalSearchResults();
});
window.addEventListener("scroll", () => {
  if (!globalSearchResults.hidden) positionGlobalSearchResults();
}, true);
document.querySelector(".sidebar-search kbd").textContent =
  /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";

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

function resetTariffForm() {
  const form = document.querySelector("#tariff-form");
  form.reset();
  document.querySelector("#tariff-id").value = "";
  document.querySelector("#tariff-form-title").textContent = "Ajouter un tarif";
  document.querySelector("#tariff-submit").textContent = "Enregistrer le tarif";
  document.querySelector("#tariff-cancel-edit").hidden = true;
}

function renderTariffs() {
  const rows = document.querySelector("#tariff-rows");
  rows.replaceChildren();
  companyTariffs.forEach((tariff) => {
    const row = document.createElement("tr");
    const route = document.createElement("td");
    route.textContent = `${tariff.origin} → ${tariff.destination}`;
    const fare = document.createElement("td");
    fare.textContent = formatFcfa(tariff.fareAmount);
    const fee = document.createElement("td");
    fee.textContent = formatFcfa(tariff.companyBookingFee);
    const state = document.createElement("td");
    state.textContent = tariff.active ? "Actif" : "Désactivé";
    const actions = document.createElement("td");
    actions.className = "tariff-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary-button";
    edit.dataset.tariffAction = "edit";
    edit.dataset.tariffId = tariff.id;
    edit.textContent = "Modifier";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary-button";
    toggle.dataset.tariffAction = "toggle";
    toggle.dataset.tariffId = tariff.id;
    toggle.textContent = tariff.active ? "Désactiver" : "Activer";
    actions.append(edit, toggle);
    row.append(route, fare, fee, state, actions);
    rows.append(row);
  });
  document.querySelector("#tariff-empty").hidden = companyTariffs.length > 0;
  document.querySelector("#tariff-list-caption").textContent =
    `${companyTariffs.length} tarif${companyTariffs.length === 1 ? "" : "s"} configuré${companyTariffs.length === 1 ? "" : "s"}`;
}

async function loadTariffs() {
  const loginMessage = document.querySelector("#tariff-login-message");
  const form = document.querySelector("#tariff-form");
  if (!accessToken) {
    companyTariffs = [];
    renderTariffs();
    form.hidden = true;
    loginMessage.hidden = false;
    return;
  }
  form.hidden = false;
  loginMessage.hidden = true;
  try {
    const response = await fetch("/api/v1/tarifs", { headers: { Authorization: `Bearer ${accessToken}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de charger les tarifs.");
    companyTariffs = result.data.tariffs || [];
    renderTariffs();
  } catch (error) {
    document.querySelector("#tariff-list-caption").textContent = error.message || "Erreur de chargement des tarifs.";
  }
}

document.querySelector("#tariff-refresh").addEventListener("click", loadTariffs);
document.querySelector("#tariff-cancel-edit").addEventListener("click", resetTariffForm);
document.querySelector("#tariff-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const id = String(values.tariffId || "");
  const submit = document.querySelector("#tariff-submit");
  submit.disabled = true;
  try {
    const response = await fetch(id ? `/api/v1/tarifs/${encodeURIComponent(id)}` : "/api/v1/tarifs", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        origin: values.origin,
        destination: values.destination,
        fareAmount: Number(values.fareAmount),
        companyBookingFee: Number(values.companyBookingFee)
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible d'enregistrer ce tarif.");
    resetTariffForm();
    showToast(result.message || "Tarif enregistré.");
    await loadTariffs();
  } catch (error) {
    showToast(error.message || "Connexion à l'API impossible.");
  } finally { submit.disabled = false; }
});

document.querySelector("#tariff-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-tariff-action]");
  if (!button || button.disabled) return;
  const tariff = companyTariffs.find(item => item.id === button.dataset.tariffId);
  if (!tariff) return;
  if (button.dataset.tariffAction === "edit") {
    document.querySelector("#tariff-id").value = tariff.id;
    document.querySelector("#tariff-form").elements.origin.value = tariff.origin;
    document.querySelector("#tariff-form").elements.destination.value = tariff.destination;
    document.querySelector("#tariff-form").elements.fareAmount.value = tariff.fareAmount;
    document.querySelector("#tariff-form").elements.companyBookingFee.value = tariff.companyBookingFee;
    document.querySelector("#tariff-form-title").textContent = "Modifier le tarif";
    document.querySelector("#tariff-submit").textContent = "Enregistrer les modifications";
    document.querySelector("#tariff-cancel-edit").hidden = false;
    document.querySelector("#tariff-form").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  button.disabled = true;
  try {
    const response = await fetch(`/api/v1/tarifs/${encodeURIComponent(tariff.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ active: !tariff.active })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de modifier ce tarif.");
    showToast(result.message || "Statut du tarif mis à jour.");
    await loadTariffs();
  } catch (error) {
    showToast(error.message || "Connexion à l'API impossible.");
  } finally { button.disabled = false; }
});

async function loadGuichet() {
  const token = accessToken;
  if (!token) {
    document.querySelector("#guichet-session-state").textContent = "Connectez-vous pour accéder au guichet.";
    document.querySelector("#guichet-open-form").hidden = true;
    document.querySelector("#guichet-sale-form").hidden = true;
    document.querySelector("#guichet-close-form").hidden = true;
    return;
  }
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const [sessionResponse, departuresResponse] = await Promise.all([
      fetch("/api/v1/guichet/session/current", { headers }),
      fetch("/api/v1/voyages/departures", { headers })
    ]);
    const [sessionResult, departuresResult] = await Promise.all([sessionResponse.json(), departuresResponse.json()]);
    if (!sessionResponse.ok) throw new Error(sessionResult.message || "Impossible de charger la caisse.");
    if (!departuresResponse.ok) throw new Error(departuresResult.message || "Impossible de charger les départs.");
    const session = sessionResult.data;
    const openForm = document.querySelector("#guichet-open-form");
    const saleForm = document.querySelector("#guichet-sale-form");
    const closeForm = document.querySelector("#guichet-close-form");
    const state = document.querySelector("#guichet-session-state");
    const expected = document.querySelector("#guichet-expected-cash");
    if (!session) {
      state.textContent = "Aucune session ouverte. Saisissez le fond de caisse pour commencer.";
      expected.textContent = "";
      openForm.hidden = false;
      saleForm.hidden = true;
      closeForm.hidden = true;
      return;
    }
    state.textContent = `Caisse ouverte depuis le ${new Date(session.openedAt).toLocaleString("fr-FR")}`;
    expected.textContent = `Solde théorique : ${formatFcfa(session.expectedCash)}`;
    openForm.hidden = true;
    saleForm.hidden = false;
    closeForm.hidden = false;
    const select = document.querySelector("#guichet-departure");
    const departures = departuresResult.data.departures || [];
    select.replaceChildren();
    departures.filter(item => item.status === "SCHEDULED" && item.availableSeats > 0).forEach(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.dataset.fare = String(item.fareAmount || 0);
      option.dataset.companyFee = String(item.companyBookingFee || 0);
      option.textContent = `${item.origin} → ${item.destination} · ${new Date(item.departureAt).toLocaleString("fr-FR")} · ${formatFcfa(item.fareAmount + (item.companyBookingFee || 0) + 100)}`;
      select.append(option);
    });
    document.querySelector("#guichet-fare").textContent = select.selectedOptions[0]
      ? `Transport : ${formatFcfa(select.selectedOptions[0].dataset.fare)} · Frais compagnie : ${formatFcfa(select.selectedOptions[0].dataset.companyFee)} · Frais TRANSORA : 100 FCFA`
      : "Aucun départ disponible pour la vente.";
  } catch (error) {
    document.querySelector("#guichet-session-state").textContent = error.message || "Erreur de chargement du guichet.";
  }
}

document.querySelector("#guichet-departure").addEventListener("change", () => {
  const selected = document.querySelector("#guichet-departure").selectedOptions[0];
  document.querySelector("#guichet-fare").textContent = selected
    ? `Transport : ${formatFcfa(selected.dataset.fare)} · Frais compagnie : ${formatFcfa(selected.dataset.companyFee)} · Frais TRANSORA : 100 FCFA`
    : "Aucun départ disponible pour la vente.";
});

document.querySelector("#guichet-open-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = document.querySelector("#guichet-open-submit");
  submit.disabled = true;
  try {
    const response = await fetch("/api/v1/guichet/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ openingAmount: Number(new FormData(form).get("openingAmount")) })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible d'ouvrir la caisse.");
    form.reset();
    await loadGuichet();
  } catch (error) { showToast(error.message || "Erreur d'ouverture de caisse."); }
  finally { submit.disabled = false; }
});

document.querySelector("#guichet-sale-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = document.querySelector("#guichet-sale-submit");
  submit.disabled = true;
  try {
    const response = await fetch("/api/v1/guichet/vente", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ departureId: values.departureId, passengerName: values.passengerName })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible d'enregistrer la vente.");
    form.reset();
    await openTicket(result.data.id);
    await loadGuichet();
  } catch (error) { showToast(error.message || "Erreur pendant la vente."); }
  finally { submit.disabled = false; }
});

document.querySelector("#guichet-close-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = Number(new FormData(event.currentTarget).get("closingAmount"));
  const sessionResponse = await fetch("/api/v1/guichet/session/current", { headers: { Authorization: `Bearer ${accessToken}` } });
  const sessionResult = await sessionResponse.json();
  if (!sessionResponse.ok || !sessionResult.data) { showToast(sessionResult.message || "Aucune caisse ouverte."); return; }
  const submit = document.querySelector("#guichet-close-submit");
  submit.disabled = true;
  try {
    const response = await fetch(`/api/v1/guichet/session/${encodeURIComponent(sessionResult.data.id)}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ closingAmount: amount })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de clôturer la caisse.");
    document.querySelector("#guichet-session-state").textContent =
      `Caisse clôturée. Écart constaté : ${formatFcfa(result.data.discrepancy)}`;
    await loadGuichet();
  } catch (error) { showToast(error.message || "Erreur de clôture."); }
  finally { submit.disabled = false; }
});



const personnelRoles = [
  ["administrateur", "Administrateur"],
  ["responsable_exploitation", "Responsable exploitation"],
  ["agent_guichet", "Agent guichet"],
  ["caissier", "Caissier"],
  ["responsable_financier", "Responsable financier"],
  ["responsable_logistique", "Responsable logistique"],
  ["chauffeur", "Chauffeur"],
  ["controleur", "Contrôleur"],
  ["mécanicien", "Mécanicien"],
  ["agent_accueil", "Agent accueil"],
  ["responsable_courrier", "Responsable courrier"],
  ["agent_courrier", "Agent courrier"]
];
function personnelRoleLabel(role) {
  return (personnelRoles.find((item) => item[0] === role) || [role, role])[1];
}
function renderPersonnel() {
  const body = document.querySelector("#personnel-rows");
  body.replaceChildren();
  const canManage = courierHasRole("administrateur");
  personnelEmployees.forEach((employee) => {
    const row = document.createElement("tr");
    const identity = document.createElement("td");
    const name = document.createElement("strong");
    name.textContent = employee.nom;
    const email = document.createElement("small");
    email.textContent = employee.email || "Aucun e-mail";
    identity.append(name, document.createElement("br"), email);
    const position = document.createElement("td");
    position.textContent = employee.poste;
    const role = document.createElement("td");
    if (canManage) {
      const select = document.createElement("select");
      select.className = "personnel-role-select";
      select.dataset.employeeId = employee.id;
      personnelRoles.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = value === employee.role;
        select.append(option);
      });
      role.append(select);
    } else {
      role.textContent = personnelRoleLabel(employee.role);
    }
    const status = document.createElement("td");
    status.textContent = employee.statut === "actif" ? "Actif" : "Inactif";
    const actions = document.createElement("td");
    actions.className = "personnel-actions";
    if (canManage) {
      const saveRole = courierButton("Enregistrer rôle", "save-role", employee.id);
      actions.append(saveRole);
      if (!employee.compteId && employee.email) {
        actions.append(courierButton("Créer accès", "create-account", employee.id));
      } else if (employee.compteId) {
        const account = document.createElement("small");
        account.textContent = "Compte lié";
        actions.append(account);
      }
      actions.append(courierButton(employee.statut === "actif" ? "Désactiver" : "Réactiver", "toggle-status", employee.id));
      actions.append(courierButton("Supprimer", "delete", employee.id));
    } else {
      actions.textContent = employee.compteId ? "Compte lié" : "Aucun accès";
    }
    row.append(identity, position, role, status, actions);
    body.append(row);
  });
  document.querySelector("#personnel-empty").hidden = personnelEmployees.length > 0;
  document.querySelector("#personnel-list-caption").textContent =
    personnelEmployees.length + " employé" + (personnelEmployees.length === 1 ? "" : "s") + " enregistré" + (personnelEmployees.length === 1 ? "" : "s");
}
async function loadPersonnel() {
  const message = document.querySelector("#personnel-login-message");
  if (!accessToken) {
    message.hidden = false;
    document.querySelector("#personnel-create-panel").hidden = true;
    document.querySelector("#personnel-list-caption").textContent = "Connectez-vous pour consulter le personnel.";
    return;
  }
  const canManage = courierHasRole("administrateur");
  document.querySelector("#personnel-create-panel").hidden = !canManage;
  try {
    const response = await fetch("/api/v1/personnel", { headers: { Authorization: "Bearer " + accessToken } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Votre rôle ne permet pas de consulter le personnel.");
    personnelEmployees = result.data.employés || [];
    message.hidden = true;
    renderPersonnel();
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message || "Impossible de charger le personnel.";
    document.querySelector("#personnel-list-caption").textContent = "Accès au personnel indisponible.";
  }
}
document.querySelector("#personnel-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = document.querySelector("#personnel-submit");
  submit.disabled = true;
  try {
    const response = await fetch("/api/v1/personnel", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify({
        nom: values.nom, poste: values.poste, role: values.role,
        telephone: values.telephone || null, email: values.email || null,
        dateEmbauche: values.dateEmbauche || null
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible d'ajouter cet employé.");
    form.reset();
    showToast("Employé ajouté à l'équipe.");
    await loadPersonnel();
  } catch (error) { showToast(error.message || "Erreur d'enregistrement du personnel."); }
  finally { submit.disabled = false; }
});
document.querySelector("#personnel-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-courier-action]");
  if (!button) return;
  const employee = personnelEmployees.find((item) => item.id === button.dataset.parcelId);
  if (!employee) return;
  const action = button.dataset.courierAction;
  button.disabled = true;
  try {
    if (action === "save-role") {
      const select = document.querySelector('.personnel-role-select[data-employee-id="' + employee.id + '"]');
      const response = await fetch("/api/v1/personnel/" + encodeURIComponent(employee.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({ role: select.value })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Impossible de modifier ce rôle.");
      showToast("Rôle mis à jour. L'employé devra se reconnecter.");
    } else if (action === "create-account") {
      const password = window.prompt("Définissez un mot de passe initial d'au moins 12 caractères. Communiquez-le en privé à l'employé :");
      if (!password) return;
      if (password.length < 12) throw new Error("Le mot de passe doit contenir au moins 12 caractères.");
      const response = await fetch("/api/v1/personnel/" + encodeURIComponent(employee.id) + "/compte", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({ motDePasse: password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Impossible de créer le compte.");
      showToast("Compte créé pour " + employee.nom + ". Transmettez le mot de passe par un canal privé.");
    } else if (action === "toggle-status") {
      const nextStatus = employee.statut === "actif" ? "inactif" : "actif";
      const response = await fetch("/api/v1/personnel/" + encodeURIComponent(employee.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({ statut: nextStatus })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Impossible de modifier le statut.");
      showToast(nextStatus === "actif" ? "Compte employé réactivé." : "Accès employé désactivé.");
    } else if (action === "delete") {
      if (!window.confirm("Supprimer la fiche de " + employee.nom + " ? Son compte de connexion sera désactivé.")) return;
      const response = await fetch("/api/v1/personnel/" + encodeURIComponent(employee.id), {
        method: "DELETE", headers: { Authorization: "Bearer " + accessToken }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Impossible de supprimer cet employé.");
      showToast("Fiche supprimée et accès désactivé.");
    }
    await loadPersonnel();
  } catch (error) { showToast(error.message || "Opération sur le personnel impossible."); }
  finally { button.disabled = false; }
});
document.querySelector("#personnel-refresh").addEventListener("click", loadPersonnel);

function courierCurrentRole() {
  try { return JSON.parse(localStorage.getItem("transora_user") || "{}").role || ""; }
  catch { return ""; }
}
function courierNormalizeRole(role) {
  return ({ superviseur: "responsable_exploitation", conducteur: "chauffeur", agent_acceuil: "agent_accueil" })[role] || role;
}
function courierHasRole() {
  const role = courierNormalizeRole(courierCurrentRole());
  return Array.from(arguments).some((allowed) => courierNormalizeRole(allowed) === role);
}
const courierStatusLabels = {
  EN_ATTENTE_PAIEMENT: "À payer",
  EN_ATTENTE_AFFECTATION: "À affecter",
  AFFECTE: "Affecté",
  CONFIE_CHAUFFEUR: "Confié au chauffeur",
  EN_TRANSIT: "En transit",
  ARRIVE: "Arrivé",
  REMIS: "Remis",
  ANNULE: "Annulé"
};
function courierButton(label, action, parcelId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button courier-action";
  button.dataset.courierAction = action;
  button.dataset.parcelId = parcelId;
  button.textContent = label;
  return button;
}
function renderCourierTariffs() {
  const body = document.querySelector("#courier-tariff-rows");
  body.replaceChildren();
  courierTariffs.forEach((tariff) => {
    const row = document.createElement("tr");
    const route = document.createElement("td");
    route.textContent = tariff.origin + " → " + tariff.destination;
    const amount = document.createElement("td");
    amount.textContent = formatFcfa(tariff.amountFcfa);
    const status = document.createElement("td");
    status.textContent = tariff.isActive ? "Actif" : "Désactivé";
    const actions = document.createElement("td");
    if (courierHasRole("administrateur", "responsable_courrier")) {
      const toggle = courierButton(tariff.isActive ? "Désactiver" : "Activer", "toggle-tariff", tariff.id);
      actions.append(toggle);
    } else {
      actions.textContent = "—";
    }
    row.append(route, amount, status, actions);
    body.append(row);
  });
  document.querySelector("#courier-tariff-empty").hidden = courierTariffs.length > 0;
}
async function loadCourierTariffs() {
  const response = await fetch("/api/v1/courrier/tarifs", { headers: { Authorization: "Bearer " + accessToken } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Impossible de charger les tarifs courrier.");
  courierTariffs = result.data || [];
  renderCourierTariffs();
}
function renderCourier() {
  const body = document.querySelector("#courier-rows");
  const statusFilter = document.querySelector("#courier-status-filter").value;
  const rows = statusFilter ? courierParcels.filter((parcel) => parcel.status === statusFilter) : courierParcels;
  body.replaceChildren();
  rows.forEach((parcel) => {
    const row = document.createElement("tr");
    const identity = document.createElement("td");
    const tracking = document.createElement("strong");
    tracking.textContent = parcel.trackingCode;
    const recipient = document.createElement("small");
    recipient.textContent = parcel.recipientName;
    identity.append(tracking, document.createElement("br"), recipient);
    const route = document.createElement("td");
    route.textContent = parcel.origin + " → " + parcel.destination;
    const amount = document.createElement("td");
    amount.textContent = formatFcfa(parcel.amountFcfa);
    const status = document.createElement("td");
    status.textContent = courierStatusLabels[parcel.status] || parcel.status;
    const actions = document.createElement("td");
    actions.className = "courier-actions";
    if (parcel.status === "EN_ATTENTE_PAIEMENT" && courierHasRole("administrateur", "caissier")) {
      actions.append(courierButton("Encaisser", "pay", parcel.id));
    }
    if (parcel.paymentStatus === "PAID" && ["EN_ATTENTE_AFFECTATION", "AFFECTE"].includes(parcel.status)
        && courierHasRole("administrateur", "responsable_exploitation", "responsable_courrier")) {
      actions.append(courierButton("Affecter", "assign", parcel.id));
    }
    if (parcel.status === "AFFECTE" && courierHasRole("chauffeur", "conducteur")) {
      actions.append(courierButton("Prise en charge", "handoff", parcel.id));
    }
    if (parcel.status === "CONFIE_CHAUFFEUR" && courierHasRole("chauffeur", "conducteur")) {
      actions.append(courierButton("Départ en transit", "transit", parcel.id));
    }
    if (parcel.status === "EN_TRANSIT" && courierHasRole("administrateur", "responsable_courrier", "agent_courrier")) {
      actions.append(courierButton("Confirmer l'arrivée", "arrival", parcel.id));
    }
    if (parcel.status === "ARRIVE" && courierHasRole("administrateur", "responsable_courrier", "agent_courrier")) {
      actions.append(courierButton("Remettre", "deliver", parcel.id));
    }
    if (parcel.paymentStatus === "PAID" && courierHasRole("administrateur", "caissier", "responsable_courrier", "agent_courrier")) {
      actions.append(courierButton("Reçu", "receipt", parcel.id));
    }
    if (!actions.childElementCount) actions.textContent = "—";
    row.append(identity, route, amount, status, actions);
    body.append(row);
  });
  document.querySelector("#courier-empty").hidden = rows.length > 0;
  document.querySelector("#courier-list-caption").textContent =
    rows.length + " courrier" + (rows.length === 1 ? "" : "s") + " affiché" + (rows.length === 1 ? "" : "s");
}
async function loadCourierAssignmentOptions(parcel) {
  const [driverResponse, departureResponse] = await Promise.all([
    fetch("/api/v1/courrier/chauffeurs", { headers: { Authorization: "Bearer " + accessToken } }),
    fetch("/api/v1/voyages/departures", { headers: { Authorization: "Bearer " + accessToken } })
  ]);
  const [driverResult, departureResult] = await Promise.all([driverResponse.json(), departureResponse.json()]);
  if (!driverResponse.ok) throw new Error(driverResult.message || "Impossible de charger les chauffeurs.");
  if (!departureResponse.ok) throw new Error(departureResult.message || "Impossible de charger les départs.");
  courierDrivers = driverResult.data || [];
  courierDepartures = departureResult.data.departures || [];
  const driverSelect = document.querySelector("#courier-driver-select");
  driverSelect.replaceChildren();
  courierDrivers.forEach((driver) => {
    const option = document.createElement("option");
    option.value = driver.id;
    option.textContent = driver.name + (driver.email ? " · " + driver.email : "");
    driverSelect.append(option);
  });
  const departureSelect = document.querySelector("#courier-departure-select");
  departureSelect.replaceChildren();
  courierDepartures.filter((departure) => {
    const sameOrigin = departure.origin.trim().toLocaleLowerCase("fr") === parcel.origin.trim().toLocaleLowerCase("fr");
    const sameDestination = departure.destination.trim().toLocaleLowerCase("fr") === parcel.destination.trim().toLocaleLowerCase("fr");
    return sameOrigin && sameDestination && ["SCHEDULED", "BOARDING"].includes(departure.status);
  }).forEach((departure) => {
    const option = document.createElement("option");
    option.value = departure.id;
    option.textContent = new Date(departure.departureAt).toLocaleString("fr-FR") + " · " + departure.vehicleCode;
    departureSelect.append(option);
  });
  if (!courierDrivers.length || !departureSelect.options.length) {
    throw new Error("Aucun chauffeur actif ou départ correspondant à ce trajet.");
  }
}
async function loadCourier() {
  const token = accessToken;
  const loginMessage = document.querySelector("#courier-login-message");
  if (!token) {
    loginMessage.hidden = false;
    document.querySelector("#courier-tariff-panel").hidden = true;
    document.querySelector("#courier-register-panel").hidden = true;
    document.querySelector("#courier-assign-panel").hidden = true;
    document.querySelector("#courier-list-caption").textContent = "Connectez-vous pour consulter les courriers.";
    return;
  }
  const isDriver = courierHasRole("chauffeur", "conducteur");
  const canRead = courierHasRole("administrateur", "responsable_exploitation", "caissier", "responsable_courrier", "agent_courrier");
  document.querySelector("#courier-tariff-panel").hidden = isDriver;
  document.querySelector("#courier-tariff-form").hidden = !courierHasRole("administrateur", "responsable_courrier");
  document.querySelector("#courier-register-panel").hidden = !courierHasRole("administrateur", "responsable_courrier", "agent_courrier");
  document.querySelector("#courier-assign-panel").hidden = true;
  if (!canRead && !isDriver) {
    loginMessage.hidden = false;
    loginMessage.textContent = "Votre rôle ne dispose pas d'un accès au service courrier.";
    return;
  }
  loginMessage.hidden = true;
  try {
    const endpoint = isDriver ? "/api/v1/courrier/chauffeur/affectations" : "/api/v1/courrier/colis";
    const response = await fetch(endpoint, { headers: { Authorization: "Bearer " + token } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de charger les courriers.");
    courierParcels = result.data || [];
    if (!isDriver) await loadCourierTariffs();
    renderCourier();
  } catch (error) {
    document.querySelector("#courier-list-caption").textContent = error.message || "Erreur de chargement du service courrier.";
    showToast(error.message || "Impossible de charger le service courrier.");
  }
}
async function printCourierReceipt(parcelId) {
  const printWindow = window.open("about:blank", "_blank");
  if (!printWindow) { showToast("Autorisez l'ouverture de la fenêtre d'impression."); return; }
  try {
    const response = await fetch("/api/v1/courrier/colis/" + encodeURIComponent(parcelId) + "/recu", {
      headers: { Authorization: "Bearer " + accessToken }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de charger le reçu.");
    const receipt = result.data;
    const doc = printWindow.document;
    doc.title = "Reçu courrier " + receipt.trackingCode;
    doc.body.replaceChildren();
    const style = doc.createElement("style");
    style.textContent = "body{font:14px Arial,sans-serif;color:#17241d;max-width:720px;margin:36px auto;padding:24px}h1{font-size:24px}h2{font-size:16px;margin-top:28px}.code{font-size:20px;font-weight:700;letter-spacing:1px;padding:14px;background:#f1f5f1}p{line-height:1.6}.total{font-size:22px;font-weight:700;border-top:1px solid #ccc;padding-top:16px}@media print{body{margin:0}}";
    doc.head.append(style);
    const title = doc.createElement("h1");
    title.textContent = receipt.companyName || "Reçu de courrier";
    const subtitle = doc.createElement("p");
    subtitle.textContent = "REÇU DE PRISE EN CHARGE · " + new Date(receipt.paidAt).toLocaleString("fr-FR");
    const code = doc.createElement("div");
    code.className = "code";
    code.textContent = receipt.trackingCode;
    const sender = doc.createElement("p");
    sender.textContent = "Expéditeur : " + receipt.senderName + " · " + receipt.senderPhone;
    const recipient = doc.createElement("p");
    recipient.textContent = "Destinataire : " + receipt.recipientName + " · " + receipt.recipientPhone;
    const route = doc.createElement("p");
    route.textContent = "Trajet : " + receipt.origin + " → " + receipt.destination;
    const description = doc.createElement("p");
    description.textContent = "Contenu : " + receipt.description + (receipt.weightKg ? " · " + receipt.weightKg + " kg" : "");
    const total = doc.createElement("p");
    total.className = "total";
    total.textContent = "Montant payé : " + formatFcfa(receipt.amountFcfa);
    const method = doc.createElement("p");
    method.textContent = "Mode de paiement : " + receipt.paymentMethod + " · Reçu par : " + receipt.receivedBy;
    const note = doc.createElement("p");
    note.textContent = "Conservez ce reçu pour suivre le courrier jusqu'à sa remise au destinataire.";
    doc.body.append(title, subtitle, code, sender, recipient, route, description, total, method, note);
    printWindow.focus();
    printWindow.print();
  } catch (error) {
    printWindow.close();
    showToast(error.message || "Impossible d'imprimer le reçu.");
  }
}
async function runCourierAction(action, parcel) {
  const base = "/api/v1/courrier/colis/" + encodeURIComponent(parcel.id);
  if (action === "assign") {
    try {
      await loadCourierAssignmentOptions(parcel);
      document.querySelector("#courier-assign-form").elements.parcelId.value = parcel.id;
      document.querySelector("#courier-assign-panel").hidden = false;
      document.querySelector("#courier-assign-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) { showToast(error.message || "Impossible de préparer l'affectation."); }
    return;
  }
  if (action === "receipt") { await printCourierReceipt(parcel.id); return; }
  let method = "PATCH";
  let endpoint = "";
  let body = {};
  if (action === "pay") { method = "POST"; endpoint = "/paiement"; body = { paymentMethod: "cash" }; }
  if (action === "handoff") endpoint = "/prise-en-charge";
  if (action === "transit") endpoint = "/en-transit";
  if (action === "arrival") endpoint = "/arrivee";
  if (action === "deliver") {
    endpoint = "/remise";
    const receiverName = window.prompt("Nom de la personne qui récupère le courrier :");
    if (!receiverName || receiverName.trim().length < 2) return;
    const receiverReference = window.prompt("Référence de remise (facultatif) :") || "";
    body = { receiverName: receiverName.trim(), receiverReference: receiverReference.trim() };
  }
  try {
    const response = await fetch(base + endpoint, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Opération courrier impossible.");
    showToast(result.message || "Opération courrier enregistrée.");
    await loadCourier();
  } catch (error) { showToast(error.message || "Connexion à l'API impossible."); }
}
document.querySelector("#courier-tariff-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = document.querySelector("#courier-tariff-submit");
  submit.disabled = true;
  try {
    const response = await fetch("/api/v1/courrier/tarifs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify({ origin: values.origin, destination: values.destination, amountFcfa: Number(values.amountFcfa) })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible d'enregistrer le tarif courrier.");
    form.reset();
    showToast("Tarif courrier enregistré.");
    await loadCourier();
  } catch (error) { showToast(error.message || "Erreur d'enregistrement du tarif."); }
  finally { submit.disabled = false; }
});
document.querySelector("#courier-tariff-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-courier-action='toggle-tariff']");
  if (!button) return;
  const tariff = courierTariffs.find((item) => item.id === button.dataset.parcelId);
  if (!tariff) return;
  button.disabled = true;
  try {
    const response = await fetch("/api/v1/courrier/tarifs/" + encodeURIComponent(tariff.id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify({ isActive: !tariff.isActive })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de modifier le tarif.");
    await loadCourierTariffs();
  } catch (error) { showToast(error.message || "Erreur de modification du tarif."); }
  finally { button.disabled = false; }
});
document.querySelector("#courier-parcel-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = document.querySelector("#courier-parcel-submit");
  submit.disabled = true;
  try {
    const response = await fetch("/api/v1/courrier/colis", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify({
        origin: values.origin, destination: values.destination,
        senderName: values.senderName, senderPhone: values.senderPhone,
        recipientName: values.recipientName, recipientPhone: values.recipientPhone,
        description: values.description, weightKg: values.weightKg ? Number(values.weightKg) : null,
        declaredValue: Number(values.declaredValue || 0)
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible d'enregistrer le courrier.");
    form.reset();
    showToast("Courrier enregistré. Code de suivi : " + result.data.trackingCode);
    await loadCourier();
  } catch (error) { showToast(error.message || "Erreur d'enregistrement du courrier."); }
  finally { submit.disabled = false; }
});
document.querySelector("#courier-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-courier-action]");
  if (!button) return;
  const parcel = courierParcels.find((item) => item.id === button.dataset.parcelId);
  if (!parcel) return;
  button.disabled = true;
  await runCourierAction(button.dataset.courierAction, parcel);
  button.disabled = false;
});
document.querySelector("#courier-assign-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = document.querySelector("#courier-assign-submit");
  submit.disabled = true;
  try {
    const response = await fetch("/api/v1/courrier/colis/" + encodeURIComponent(values.parcelId) + "/affectation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify({ departureId: values.departureId, driverUserId: values.driverUserId })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible d'affecter ce courrier.");
    document.querySelector("#courier-assign-panel").hidden = true;
    showToast("Courrier affecté au voyage.");
    await loadCourier();
  } catch (error) { showToast(error.message || "Erreur d'affectation."); }
  finally { submit.disabled = false; }
});
document.querySelector("#courier-assign-cancel").addEventListener("click", () => {
  document.querySelector("#courier-assign-panel").hidden = true;
});
document.querySelector("#courier-status-filter").addEventListener("change", renderCourier);
document.querySelector("#courier-refresh").addEventListener("click", loadCourier);
document.querySelector("#courier-tracking-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = String(new FormData(event.currentTarget).get("trackingCode") || "").trim().toUpperCase();
  const target = document.querySelector("#courier-tracking-result");
  target.hidden = false;
  target.textContent = "Recherche du courrier…";
  try {
    const response = await fetch("/api/public/courrier/" + encodeURIComponent(code));
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Courrier introuvable.");
    target.replaceChildren();
    const parcel = result.data.parcel;
    const heading = document.createElement("strong");
    heading.textContent = parcel.trackingCode + " · " + (courierStatusLabels[parcel.status] || parcel.status);
    const route = document.createElement("p");
    route.textContent = parcel.origin + " → " + parcel.destination;
    const history = document.createElement("ol");
    result.data.history.forEach((item) => {
      const entry = document.createElement("li");
      entry.textContent = (courierStatusLabels[item.eventType] || item.eventType) + " · " + new Date(item.createdAt).toLocaleString("fr-FR");
      history.append(entry);
    });
    target.append(heading, route, history);
  } catch (error) { target.textContent = error.message || "Erreur de suivi."; }
});

function showCurrentView() {
  const hash = window.location.hash || "#overview";
  const isVoyages = hash === "#voyages";
  const isTariffs = hash === "#tarifs";
  const isFleet = hash === "#flotte";
  const isPayments = hash === "#payments";
  const isReports = hash === "#reports";
  const isGuichet = hash === "#guichet";
  const isCourier = hash === "#courrier";
  document.querySelector("#overview-page").hidden = isVoyages || isTariffs || isFleet || isPayments || isReports || isGuichet || isCourier;
  document.querySelector("#voyages-page").hidden = !isVoyages;
  document.querySelector("#tariffs-page").hidden = !isTariffs;
  document.querySelector("#fleet-page").hidden = !isFleet;
  document.querySelector("#payments-page").hidden = !isPayments;
  document.querySelector("#reports-page").hidden = !isReports;
  document.querySelector("#guichet-page").hidden = !isGuichet;
  document.querySelector("#courier-page").hidden = !isCourier;
  document.querySelector(".breadcrumbs strong").textContent =
    isVoyages ? "Voyages" : isTariffs ? "Gestion des tarifs" : isFleet ? "Flotte" : isPayments ? "Paiements" : isReports ? "Rapports" : isGuichet ? "Guichet" : isCourier ? "Service courrier" : "Vue d'ensemble";
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.hash === hash);
  });
  if (isVoyages) loadVoyages();
  if (isTariffs) loadTariffs();
  if (isFleet) loadFleet();
  if (isPayments) loadPayments();
  if (isReports) loadReports();
  if (isGuichet) loadGuichet();
  if (isCourier) loadCourier();
}

window.addEventListener("hashchange", showCurrentView);
showCurrentView();

document.querySelector("#voyages-add-departure").addEventListener("click", () => {
  if (!accessToken) {
    showToast("Connectez-vous pour enregistrer un départ.");
    setAuthMode(false);
    authDialog.showModal();
    return;
  }
  departureDialog.showModal();
});

document.querySelector("#voyage-copy-link").addEventListener("click", async () => {
  if (!accessToken) { showToast("Connectez-vous pour partager votre lien de réservation."); return; }
  const button = document.querySelector("#voyage-copy-link");
  button.disabled = true;
  try {
    const response = await fetch("/api/v1/tenant", { headers: { Authorization: `Bearer ${accessToken}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de récupérer le lien.");
    const url = new URL(result.data.publicBookingUrl, window.location.origin).toString();
    await navigator.clipboard.writeText(url);
    showToast("Lien de réservation copié. Vous pouvez le partager à vos clients.");
  } catch (error) { showToast(error.message || "Copie du lien impossible."); }
  finally { button.disabled = false; }
});

document.querySelector("#voyage-refresh").addEventListener("click", loadVoyages);
document.querySelector("#voyage-search").addEventListener("input", renderVoyages);
document.querySelector("#voyage-date").addEventListener("change", renderVoyages);
document.querySelector("#voyage-status").addEventListener("change", renderVoyages);
async function updateDepartureStatus(departureId, nextStatus) {
  try {
    const response = await fetch(`/api/v1/voyages/departures/${encodeURIComponent(departureId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ status: nextStatus })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de modifier le statut du départ.");
    showToast(nextStatus === "BOARDING" ? "Embarquement ouvert pour ce départ." : "Départ clôturé.");
    await loadVoyages();
    await loadDashboard();
  } catch (error) { showToast(error.message || "Erreur de mise à jour du départ."); }
}

document.querySelector("#voyage-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-departure-id]");
  if (!button || button.disabled) return;
  if (button.dataset.action === "tariff") {
    button.disabled = true;
    try {
      const response = await fetch(`/api/v1/voyages/departures/${encodeURIComponent(button.dataset.departureId)}/tarif`, {
        method: "PATCH", headers: { Authorization: `Bearer ${accessToken}` }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Impossible d'appliquer le tarif.");
      showToast(result.message || "Tarif appliqué.");
      await loadVoyages();
    } catch (error) {
      showToast(error.message || "Aucun tarif actif ne correspond à ce trajet.");
    } finally { button.disabled = false; }
    return;
  }
  if (button.dataset.action === "status") {
    await updateDepartureStatus(button.dataset.departureId, button.dataset.nextStatus);
    return;
  }
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
  document.querySelector("#booking-fare").textContent = `Transport : ${formatFcfa(selectedDeparture.fareAmount || 0)} · Frais compagnie : ${formatFcfa(selectedDeparture.companyBookingFee || 0)} · Frais TRANSORA : 100 FCFA · Siège attribué automatiquement`;
  document.querySelector("#booking-dialog").showModal();
});

document.querySelector("#fleet-add-vehicle").addEventListener("click", () => {
  if (!accessToken) {
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
      headers: { Authorization: `Bearer ${accessToken}` }
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
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        passengerName: values.passengerName
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impossible de créer la réservation.");
    form.reset();
    bookingDialog.close();
    selectedDeparture = undefined;
    showToast("Réservation créée. Votre billet est prêt.");
    await loadDashboard();
    await loadPayments();
    await openTicket(result.data.id);
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
  const token = accessToken;
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

loginButton.addEventListener("click", async () => {
  if (accessToken) {
    const token = accessToken;
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST", headers: { Authorization: `Bearer ${token}` }
      });
    } finally {
      accessToken = null;
      localStorage.removeItem("transora_user");
      window.location.reload();
    }
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
  if (button.dataset.action === "ticket") {
    openTicket(button.dataset.bookingId);
    return;
  }
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
function openScannerDialog() {
  if (!accessToken) {
    setAuthMode(false);
    authDialog.showModal();
    return;
  }
  document.querySelector("#scanner-input").value = "";
  document.querySelector("#scanner-result").hidden = true;
  setScannerFeedback("Scannez un billet ou saisissez son code.");
  document.querySelector("#scanner-dialog").showModal();
  document.querySelector("#scanner-input").focus();
}
document.querySelector("#scanner-open").addEventListener("click", openScannerDialog);
document.querySelector("#scanner-open-mobile").addEventListener("click", openScannerDialog);
document.querySelector("#scanner-dialog-close").addEventListener("click", () => {
  stopTicketScanner();
  document.querySelector("#scanner-dialog").close();
});
document.querySelector("#scanner-dialog").addEventListener("close", stopTicketScanner);
document.querySelector("#scanner-form").addEventListener("submit", (event) => {
  event.preventDefault();
  lookupScannedTicket(document.querySelector("#scanner-input").value);
});
document.querySelector("#scanner-start").addEventListener("click", startTicketScanner);
document.querySelector("#scanner-stop").addEventListener("click", () => {
  stopTicketScanner();
  setScannerFeedback("Caméra arrêtée. Vous pouvez saisir un code ou scanner avec un lecteur externe.");
});
document.querySelector("#ticket-dialog-close").addEventListener("click", () => {
  document.querySelector("#ticket-dialog").close();
});
document.querySelector("#ticket-print").addEventListener("click", () => window.print());
document.querySelector("#payment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedPayment) return;

  const form = event.currentTarget;
  const submit = document.querySelector("#payment-submit");
  const values = Object.fromEntries(new FormData(form).entries());
  const token = accessToken;
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
  const headers = ["Passager", "Trajet", "Départ", "Transport FCFA", "Frais compagnie FCFA", "Frais TRANSORA FCFA", "Total FCFA", "Moyen", "Statut"];
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
  if (!accessToken) {
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
  const token = accessToken;
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
        capacity: Number(values.capacity),
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
    accessToken = result.data.token;
    localStorage.setItem("transora_user", JSON.stringify(result.data.user));
    startSessionRefresh();
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


// Le cookie HttpOnly restaure la session au chargement et renouvelle les jetons en mémoire.
async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const response = await nativeFetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error("Session expirée");
      const result = await response.json();
      if (!result.data?.token) throw new Error("Réponse de renouvellement invalide");
      accessToken = result.data.token;
      if (result.data.user) localStorage.setItem("transora_user", JSON.stringify(result.data.user));
      setAuthenticatedState(true);
      return true;
    } catch {
      accessToken = null;
      localStorage.removeItem("transora_user");
      setAuthenticatedState(false);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}
function startSessionRefresh() {
  if (sessionRefreshTimer) return;
  sessionRefreshTimer = window.setInterval(refreshAccessToken, 10 * 60 * 1000);
  window.addEventListener("focus", refreshAccessToken);
}
setAuthenticatedState(false);
refreshAccessToken().then((restored) => {
  if (restored) startSessionRefresh();
  setAuthenticatedState(restored);
  loadDashboard();
});
const now = new Date();
document.querySelector("#today-label").textContent =
  new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(now).toLocaleUpperCase("fr");
