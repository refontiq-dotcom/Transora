-- Réseau de transport isolé par compagnie : villes, gares, lignes et arrêts ordonnés.
CREATE TABLE IF NOT EXISTS company_cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 100),
  country_code CHAR(2) NOT NULL DEFAULT 'CI',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_cities_name_unique
  ON company_cities (tenant_id, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')));

CREATE TABLE IF NOT EXISTS stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  city_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  code TEXT CHECK (code IS NULL OR length(btrim(code)) BETWEEN 2 AND 20),
  address TEXT CHECK (address IS NULL OR length(address) <= 300),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  CONSTRAINT stations_city_same_tenant_fk
    FOREIGN KEY (tenant_id, city_id) REFERENCES company_cities(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS stations_name_city_unique
  ON stations (tenant_id, city_id, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')));
CREATE UNIQUE INDEX IF NOT EXISTS stations_code_unique
  ON stations (tenant_id, lower(btrim(code))) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS transport_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 140),
  origin_station_id UUID NOT NULL,
  destination_station_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  CONSTRAINT transport_routes_distinct_endpoints CHECK (origin_station_id <> destination_station_id),
  CONSTRAINT transport_routes_origin_same_tenant_fk
    FOREIGN KEY (tenant_id, origin_station_id) REFERENCES stations(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT transport_routes_destination_same_tenant_fk
    FOREIGN KEY (tenant_id, destination_station_id) REFERENCES stations(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS transport_routes_name_unique
  ON transport_routes (tenant_id, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')));

CREATE TABLE IF NOT EXISTS route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  route_id UUID NOT NULL,
  station_id UUID NOT NULL,
  stop_order INTEGER NOT NULL CHECK (stop_order >= 0),
  distance_from_origin_km NUMERIC(8,2) NOT NULL CHECK (distance_from_origin_km >= 0),
  duration_from_origin_minutes INTEGER NOT NULL CHECK (duration_from_origin_minutes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT route_stops_route_same_tenant_fk
    FOREIGN KEY (tenant_id, route_id) REFERENCES transport_routes(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT route_stops_station_same_tenant_fk
    FOREIGN KEY (tenant_id, station_id) REFERENCES stations(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT route_stops_unique_order UNIQUE (route_id, stop_order),
  CONSTRAINT route_stops_unique_station UNIQUE (route_id, station_id)
);

CREATE INDEX IF NOT EXISTS stations_tenant_city_active_idx ON stations(tenant_id, city_id, is_active);
CREATE INDEX IF NOT EXISTS transport_routes_tenant_active_idx ON transport_routes(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS route_stops_route_order_idx ON route_stops(route_id, stop_order);

ALTER TABLE company_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_stops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE company_cities, stations, transport_routes, route_stops FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE company_cities, stations, transport_routes, route_stops FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE company_cities, stations, transport_routes, route_stops FROM authenticated;
  END IF;
END $$;
