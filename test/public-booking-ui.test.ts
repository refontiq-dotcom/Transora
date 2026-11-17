import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, test } from "vitest";

const html = readFileSync("public/reservation.html", "utf8");
const script = readFileSync("public/reservation.js", "utf8");

describe("public traveller booking journey", () => {
  test("the browser script is valid JavaScript syntax", () => {
    expect(() => new Script(script, { filename: "public/reservation.js" })).not.toThrow();
  });

  test("every fixed DOM id referenced by the script exists in the portal", () => {
    const referencedIds = [...script.matchAll(/document\.querySelector(?:All)?\(["']#([^"']+)["']/g)]
      .map(match => match[1]);
    const declaredIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
    const missingIds = [...new Set(referencedIds)].filter(id => !declaredIds.has(id));

    expect(missingIds).toEqual([]);
  });

  test("the public flow exposes three progressive steps and accessible status feedback", () => {
    expect(html.match(/data-stage="/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Étapes de réservation"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="public-audio"');
    expect(html).toContain('id="public-next-1"');
    expect(html).toContain('id="public-city-origin"');
    expect(html).toContain('id="public-city-destination"');
    expect(html).toContain('id="public-trip-compact"');
    expect(html).toContain('id="public-departure"');
    expect(html).toContain('id="public-next-2"');
    expect(html).toContain('id="public-submit"');
  });

  test("the first step asks for both cities before showing departures", () => {
    const firstStage = html.split('data-stage="1"')[1].split('data-stage="2"')[0];
    expect(firstStage).toContain('id="public-city-origin"');
    expect(firstStage).toContain('id="public-city-destination"');
    expect(firstStage).not.toContain('id="public-departure"');
    expect(script).toContain("function handleCityPairChange");
    expect(script).toContain("function departureSegmentForCities");
  });

  test("the selected trip stays available as a compact editable summary", () => {
    expect(html).toContain('id="public-trip-compact"');
    expect(script).toContain('compact.hidden = stage === 1');
    expect(html).toContain('id="public-edit-trip"');
  });

  test("the portal keeps using the versioned public API", () => {
    expect(script).toContain('const publicApiBase = "/api/v1/public"');
    expect(script).toContain('policyAccepted.checked');
    expect(script).toContain('selectedSeatMode()');
  });
});
