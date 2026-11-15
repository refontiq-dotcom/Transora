import { PoolClient } from "pg";

export interface BookingSegment {
  originStopId: string | null;
  destinationStopId: string | null;
  segmentRange: string;
  origin: string;
  destination: string;
  fareAmount: number;
  companyBookingFee: number;
}

export interface SegmentResolution {
  data?: BookingSegment;
  error?: { status: number; message: string };
}

export async function resolveBookingSegment(
  client: PoolClient,
  tenantId: string,
  routeId: string | null,
  originStopId: string | null,
  destinationStopId: string | null,
  fallback: { origin: string; destination: string; fareAmount: number; companyBookingFee: number }
): Promise<SegmentResolution> {
  if (!routeId) {
    if (originStopId || destinationStopId) return { error: { status: 400, message: "Ce départ ne possède pas de ligne avec arrêts sélectionnables" } };
    return { data: { originStopId: null, destinationStopId: null, segmentRange: "[0,)", ...fallback } };
  }
  if (!originStopId || !destinationStopId) {
    return { error: { status: 400, message: "Choisissez votre gare de départ et votre gare d'arrivée" } };
  }
  const stops = await client.query(
    `SELECT rs.id, rs.stop_order, c.name AS city
     FROM route_stops rs
     JOIN stations s ON s.id=rs.station_id AND s.tenant_id=rs.tenant_id
     JOIN company_cities c ON c.id=s.city_id AND c.tenant_id=s.tenant_id
     WHERE rs.tenant_id=$1 AND rs.route_id=$2 AND rs.id=ANY($3::uuid[])
     ORDER BY rs.stop_order`,
    [tenantId, routeId, [originStopId, destinationStopId]]
  );
  if (stops.rowCount !== 2 || stops.rows[0].id !== originStopId || stops.rows[1].id !== destinationStopId || Number(stops.rows[0].stop_order) >= Number(stops.rows[1].stop_order)) {
    return { error: { status: 400, message: "Le trajet sélectionné ne respecte pas l'ordre des arrêts de la ligne" } };
  }
  const tariff = await client.query(
    `SELECT fare_amount, company_booking_fee
     FROM company_route_tariffs
     WHERE tenant_id=$1 AND is_active=TRUE
       AND lower(regexp_replace(btrim(origin), '[[:space:]]+', ' ', 'g'))=lower(regexp_replace(btrim($2), '[[:space:]]+', ' ', 'g'))
       AND lower(regexp_replace(btrim(destination), '[[:space:]]+', ' ', 'g'))=lower(regexp_replace(btrim($3), '[[:space:]]+', ' ', 'g'))
     LIMIT 1`,
    [tenantId, stops.rows[0].city, stops.rows[1].city]
  );
  if (!tariff.rowCount) return { error: { status: 409, message: "Aucun tarif actif n'est configuré pour ce segment dans votre compagnie" } };
  return { data: {
    originStopId, destinationStopId,
    segmentRange: "[" + Number(stops.rows[0].stop_order) + "," + Number(stops.rows[1].stop_order) + ")",
    origin: String(stops.rows[0].city), destination: String(stops.rows[1].city),
    fareAmount: Number(tariff.rows[0].fare_amount),
    companyBookingFee: Number(tariff.rows[0].company_booking_fee)
  } };
}
