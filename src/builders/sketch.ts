/** Sketch payloads. Derived from onshape-cli (MIT, see NOTICE).
 *
 * All input lengths are inches; Onshape stores metres, so every coordinate goes
 * through toMeters(). Sketches are emitted without constraints: the geometry is
 * fully specified by coordinates, which is what a program wants. */

import { type Feature, parsePoint2, planeId, pQuery, toMeters } from "./params.js";

export type Point2 = [number, number];

export function circleEntity(id: string, center: Point2, radius: number, isConstruction = false): Feature {
  if (radius <= 0) throw new Error("Circle radius must be positive.");
  return {
    btType: "BTMSketchCurve-4",
    entityId: id,
    centerId: `${id}.center`,
    geometry: {
      btType: "BTCurveGeometryCircle-115",
      radius: toMeters(radius),
      xCenter: toMeters(center[0]),
      yCenter: toMeters(center[1]),
      xDir: 1,
      yDir: 0,
      clockwise: false,
    },
    isConstruction,
  };
}

export function lineEntity(id: string, start: Point2, end: Point2, isConstruction = false): Feature {
  const x1 = toMeters(start[0]);
  const y1 = toMeters(start[1]);
  const dx = toMeters(end[0]) - x1;
  const dy = toMeters(end[1]) - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new Error("Line start and end must be different.");
  return {
    btType: "BTMSketchCurveSegment-155",
    entityId: id,
    startPointId: `${id}.start`,
    endPointId: `${id}.end`,
    startParam: 0,
    endParam: length,
    geometry: {
      btType: "BTCurveGeometryLine-117",
      pntX: x1,
      pntY: y1,
      dirX: dx / length,
      dirY: dy / length,
    },
    isConstruction,
  };
}

/** Arc angles are degrees, counter-clockwise from +X. */
export function arcEntity(id: string, center: Point2, radius: number, startAngle: number, endAngle: number): Feature {
  if (radius <= 0) throw new Error("Arc radius must be positive.");
  return {
    btType: "BTMSketchCurveSegment-155",
    entityId: id,
    startPointId: `${id}.start`,
    endPointId: `${id}.end`,
    centerId: `${id}.center`,
    startParam: (startAngle * Math.PI) / 180,
    endParam: (endAngle * Math.PI) / 180,
    geometry: {
      btType: "BTCurveGeometryCircle-115",
      radius: toMeters(radius),
      xCenter: toMeters(center[0]),
      yCenter: toMeters(center[1]),
      xDir: 1,
      yDir: 0,
      clockwise: false,
    },
    isConstruction: false,
  };
}

export function rectangleEntities(prefix: string, corner1: Point2, corner2: Point2): Feature[] {
  const [x1, y1] = corner1;
  const [x2, y2] = corner2;
  if (x1 === x2 || y1 === y2) throw new Error("Rectangle corners must differ in both x and y.");
  const corners: Point2[] = [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
  return corners.map((corner, index) => lineEntity(`${prefix}.${index}`, corner, corners[(index + 1) % 4]));
}

/** A sketch is planted on a named default plane, or on a face created by an
 *  earlier feature when planeFeatureId is given. */
function sketchPlaneParameter(plane: string, planeFeatureId?: string): Feature {
  if (planeFeatureId) {
    return pQuery("sketchPlane", {
      queryString: `query = qCreatedBy(makeId("${planeFeatureId}"), EntityType.FACE);`,
      featureId: planeFeatureId,
    });
  }
  return {
    btType: "BTMParameterQueryList-148",
    queries: [{ btType: "BTMIndividualQuery-138", deterministicIds: [planeId(plane)] }],
    parameterId: "sketchPlane",
  };
}

export function sketchFeature(input: {
  name: string;
  plane: string;
  entities: Feature[];
  planeFeatureId?: string;
}): Feature {
  if (!input.entities.length) throw new Error("A sketch needs at least one entity.");
  return {
    feature: {
      btType: "BTMSketch-151",
      featureType: "newSketch",
      name: input.name,
      suppressed: false,
      parameters: [sketchPlaneParameter(input.plane, input.planeFeatureId)],
      entities: input.entities,
      constraints: [],
    },
  };
}

export function buildRectangleSketch(input: {
  name: string;
  plane: string;
  corner1: Point2;
  corner2: Point2;
  planeFeatureId?: string;
}): Feature {
  return sketchFeature({ ...input, entities: rectangleEntities("rect", input.corner1, input.corner2) });
}

export function buildCircleSketch(input: {
  name: string;
  plane: string;
  center: Point2;
  radius: number;
  planeFeatureId?: string;
}): Feature {
  return sketchFeature({ ...input, entities: [circleEntity("circle.1", input.center, input.radius)] });
}

export function buildLineSketch(input: {
  name: string;
  plane: string;
  start: Point2;
  end: Point2;
  planeFeatureId?: string;
}): Feature {
  return sketchFeature({ ...input, entities: [lineEntity("line.1", input.start, input.end)] });
}

/** A profile circle plus a construction line to revolve it around. */
export function buildCircleAxisSketch(input: {
  name: string;
  plane: string;
  center: Point2;
  radius: number;
  axisStart: Point2;
  axisEnd: Point2;
}): Feature {
  return sketchFeature({
    ...input,
    entities: [
      circleEntity("profile.circle", input.center, input.radius),
      lineEntity("axis.1", input.axisStart, input.axisEnd, true),
    ],
  });
}

export interface SketchEntitySpec {
  type: "line" | "circle" | "rectangle" | "arc";
  construction?: boolean;
  start?: unknown;
  end?: unknown;
  center?: unknown;
  radius?: number;
  corner1?: unknown;
  corner2?: unknown;
  startAngle?: number;
  endAngle?: number;
}

/** Free-form sketch from a list of entity specs. */
export function buildSketchFromEntities(input: {
  name: string;
  plane: string;
  entities: SketchEntitySpec[];
  planeFeatureId?: string;
}): Feature {
  const out: Feature[] = [];
  input.entities.forEach((entity, index) => {
    const id = `e${index}`;
    const construction = Boolean(entity.construction);
    switch (entity.type) {
      case "line":
        out.push(lineEntity(id, parsePoint2(entity.start), parsePoint2(entity.end), construction));
        break;
      case "circle":
        out.push(circleEntity(id, parsePoint2(entity.center), Number(entity.radius), construction));
        break;
      case "rectangle":
        out.push(...rectangleEntities(id, parsePoint2(entity.corner1), parsePoint2(entity.corner2)));
        break;
      case "arc":
        out.push(
          arcEntity(
            id,
            parsePoint2(entity.center),
            Number(entity.radius),
            Number(entity.startAngle ?? 0),
            Number(entity.endAngle ?? 90),
          ),
        );
        break;
      default:
        throw new Error(`Unknown sketch entity type '${String(entity.type)}'. Use line, circle, rectangle, or arc.`);
    }
  });
  return sketchFeature({ ...input, entities: out });
}

/** A straight stem joined to a hooked arc — the classic swept-path test case. */
export function buildCandyCanePathSketch(input: {
  name: string;
  plane: string;
  x: number;
  bottom: number;
  straightHeight: number;
  hookRadius: number;
  hookAngle: number;
  segments: number;
}): Feature {
  const top = input.bottom + input.straightHeight;
  const center: Point2 = [input.x - input.hookRadius, top];
  const totalSegments = Math.max(2, Math.floor(input.segments));
  const arcLength = input.hookRadius * Math.abs((input.hookAngle * Math.PI) / 180);
  const straightShare = input.straightHeight / (input.straightHeight + arcLength);
  const straightSegments = Math.max(1, Math.round(totalSegments * straightShare));
  const arcSegments = Math.max(1, totalSegments - straightSegments);
  const entities: Feature[] = [];

  for (let index = 0; index < straightSegments; index += 1) {
    const y1 = input.bottom + (input.straightHeight * index) / straightSegments;
    const y2 = input.bottom + (input.straightHeight * (index + 1)) / straightSegments;
    entities.push(lineEntity(`path.stem.${index + 1}`, [input.x, y1], [input.x, y2]));
  }
  for (let index = 0; index < arcSegments; index += 1) {
    const start = (input.hookAngle * index) / arcSegments;
    const end = (input.hookAngle * (index + 1)) / arcSegments;
    entities.push(arcEntity(`path.hook.${index + 1}`, center, input.hookRadius, start, end));
  }
  return sketchFeature({ name: input.name, plane: input.plane, entities });
}
